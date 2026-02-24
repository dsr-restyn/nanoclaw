/**
 * HTTP/SSE channel — exposes NanoClaw groups via REST + Server-Sent Events.
 *
 * Any web client can create groups, send messages, and stream agent responses.
 * Auth: Bearer token or ?token= query param (SHA-256 hashed in DB).
 *
 * JID format: http:{uuid}
 *
 * Endpoints:
 *   GET  /health                  — health probe (no auth)
 *   GET  /groups                  — list http groups
 *   POST /groups                  — create group + send first message
 *   GET  /groups/:jid/messages    — message history
 *   POST /groups/:jid/messages    — send message
 *   GET  /groups/:jid/stream      — SSE event stream
 */

import { randomUUID } from 'crypto';
import { ServerResponse } from 'http';
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify';
import cors from '@fastify/cors';
import { EventEmitter } from 'events';

import { logger } from '../logger.js';
import { ASSISTANT_NAME } from '../config.js';
import {
  storeMessageDirect,
  getHttpGroupMessages,
  validateHttpToken,
} from '../db.js';
import type {
  Channel,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredGroup,
} from '../types.js';

// ── Types ────────────────────────────────────────────────────────────

export interface HttpChannelOpts {
  port: number;
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
  enqueueCheck: (jid: string) => void;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
}

export interface GroupEvent {
  type: 'text' | 'tool' | 'result' | 'status';
  [key: string]: unknown;
}

// ── Auth ─────────────────────────────────────────────────────────────

function extractToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return (request.query as Record<string, string>).token ?? null;
}

async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = extractToken(request);
  if (!token || !validateHttpToken(token)) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}

// ── Channel ──────────────────────────────────────────────────────────

export class HttpChannel implements Channel {
  name = 'http';
  readonly server: FastifyInstance;
  readonly opts: HttpChannelOpts;
  private connected = false;
  private keepaliveTimer: NodeJS.Timeout | null = null;

  // SSE client tracking: jid → set of raw responses
  private sseClients = new Map<string, Set<ServerResponse>>();

  // Event bus for extensibility (voice handler subscribes here)
  private bus = new EventEmitter();

  constructor(opts: HttpChannelOpts) {
    this.opts = opts;
    this.server = Fastify({ logger: false });
  }

  // ── Channel interface ────────────────────────────────────────────

  async connect(): Promise<void> {
    await this.server.register(cors, { origin: true });
    this.setupRoutes();
    await this.server.listen({ port: this.opts.port, host: '0.0.0.0' });
    this.connected = true;

    // SSE keepalive every 15s (aggressive for tunnel/proxy compatibility)
    this.keepaliveTimer = setInterval(() => {
      for (const clients of this.sseClients.values()) {
        for (const res of clients) {
          try {
            res.write('event: ping\ndata: \n\n');
          } catch {
            /* client gone */
          }
        }
      }
    }, 15_000);

    logger.info({ port: this.opts.port }, 'HTTP channel listening');
  }

  async disconnect(): Promise<void> {
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    for (const clients of this.sseClients.values()) {
      for (const res of clients) {
        try {
          res.end();
        } catch {
          /* already closed */
        }
      }
    }
    this.sseClients.clear();
    await this.server.close();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('http:');
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const event: GroupEvent = { type: 'text', content: text };
    this.ssePush(jid, 'text', event);
    this.bus.emit('event', jid, event);
  }

  async sendProgress(
    jid: string,
    tool: string,
    summary: string,
  ): Promise<void> {
    const event: GroupEvent = { type: 'tool', tool, summary };
    this.ssePush(jid, 'tool', event);
    this.bus.emit('event', jid, event);
  }

  async sendResult(jid: string, summary: string): Promise<void> {
    const event: GroupEvent = { type: 'result', summary };
    this.ssePush(jid, 'result', event);
    this.bus.emit('event', jid, event);
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    const state = isTyping ? 'working' : 'waiting';
    const event: GroupEvent = { type: 'status', state };
    this.ssePush(jid, 'status', event);
    this.bus.emit('event', jid, event);
  }

  // ── Event subscription (for voice, etc.) ─────────────────────────

  onEvent(listener: (jid: string, event: GroupEvent) => void): void {
    this.bus.on('event', listener);
  }

  offEvent(listener: (jid: string, event: GroupEvent) => void): void {
    this.bus.off('event', listener);
  }

  // ── SSE helpers ──────────────────────────────────────────────────

  private ssePush(
    jid: string,
    eventName: string,
    data: Record<string, unknown>,
  ): void {
    const clients = this.sseClients.get(jid);
    if (!clients?.size) return;
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    }
  }

  // ── Routes ───────────────────────────────────────────────────────

  private setupRoutes(): void {
    const { server, opts } = this;

    // GET /health — no auth
    server.get('/health', async () => ({ status: 'ok' }));

    // GET /groups
    server.get('/groups', { preHandler: requireAuth }, async () => {
      const all = opts.registeredGroups();
      return Object.entries(all)
        .filter(([jid]) => jid.startsWith('http:'))
        .map(([jid, g]) => ({
          jid,
          name: g.name,
          folder: g.folder,
          added_at: g.added_at,
        }));
    });

    // POST /groups — create group + send first message
    server.post<{ Body: { name?: string; message: string } }>(
      '/groups',
      { preHandler: requireAuth },
      async (request, reply) => {
        const { name, message } = request.body;
        if (!message)
          return reply.code(400).send({ error: 'message required' });

        const id = randomUUID();
        const jid = `http:${id}`;
        const folder = `http-${id.slice(0, 8)}`;
        const groupName = name || `HTTP ${id.slice(0, 8)}`;
        const now = new Date().toISOString();

        opts.registerGroup(jid, {
          name: groupName,
          folder,
          trigger: '',
          added_at: now,
          requiresTrigger: false,
        });
        opts.onChatMetadata(jid, now, groupName, 'http', false);

        storeMessageDirect({
          id: randomUUID(),
          chat_jid: jid,
          sender: 'http-user',
          sender_name: 'User',
          content: message,
          timestamp: now,
          is_from_me: false,
          is_bot_message: false,
        });
        opts.enqueueCheck(jid);

        return { jid, name: groupName, folder };
      },
    );

    // GET /groups/:jid/messages — message history
    server.get<{
      Params: { jid: string };
      Querystring: { since?: string; limit?: string };
    }>('/groups/:jid/messages', { preHandler: requireAuth }, async (request, reply) => {
      const { jid } = request.params;
      if (!jid.startsWith('http:'))
        return reply.code(404).send({ error: 'Not found' });

      const since = request.query.since || '';
      const limit = Math.min(
        parseInt(request.query.limit || '200', 10) || 200,
        1000,
      );
      return getHttpGroupMessages(jid, since, limit);
    });

    // POST /groups/:jid/messages — send message
    server.post<{ Params: { jid: string }; Body: { message: string } }>(
      '/groups/:jid/messages',
      { preHandler: requireAuth },
      async (request, reply) => {
        const { jid } = request.params;
        const { message } = request.body;
        if (!message)
          return reply.code(400).send({ error: 'message required' });

        const group = opts.registeredGroups()[jid];
        if (!group)
          return reply.code(404).send({ error: 'Group not found' });

        storeMessageDirect({
          id: randomUUID(),
          chat_jid: jid,
          sender: 'http-user',
          sender_name: 'User',
          content: message,
          timestamp: new Date().toISOString(),
          is_from_me: false,
          is_bot_message: false,
        });
        opts.enqueueCheck(jid);

        return { status: 'queued', jid };
      },
    );

    // GET /groups/:jid/stream — SSE event stream
    server.get<{ Params: { jid: string } }>(
      '/groups/:jid/stream',
      { preHandler: requireAuth },
      (request, reply) => {
        const { jid } = request.params;

        reply.hijack();
        const res = reply.raw;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        if (!this.sseClients.has(jid))
          this.sseClients.set(jid, new Set());
        this.sseClients.get(jid)!.add(res);

        request.raw.on('close', () => {
          const set = this.sseClients.get(jid);
          if (set) {
            set.delete(res);
            if (set.size === 0) this.sseClients.delete(jid);
          }
        });

        // Initial ping so the client knows the stream is live
        res.write('event: ping\ndata: \n\n');
      },
    );
  }
}
