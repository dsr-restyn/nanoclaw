/**
 * OpenClaw gateway protocol message builders and parsers.
 *
 * Implements the minimal subset of the OpenClaw WebSocket protocol (v3)
 * needed for R1 PTT voice input/output. Pure functions, no I/O.
 *
 * Frame types (per OpenClaw spec):
 *   req:   {type:"req",   id, method, params?}
 *   res:   {type:"res",   id, ok, payload?, error?}
 *   event: {type:"event", event, payload?, seq?}
 *
 * Protocol flow:
 *   S->C: event  connect.challenge {nonce, ts}
 *   C->S: req    connect           {auth:{token}, client:{...}, ...}
 *   S->C: res    hello-ok          {protocol, policy, auth}
 *   C->S: req    chat.send         {sessionKey, message, idempotencyKey}
 *   S->C: event  chat              {sessionKey, state:"delta"|"final", message}
 *   S->C: event  tick              {ts}
 */

import { randomUUID } from 'crypto';

// ── Event builders (server -> client) ────────────────────────────────

export function buildChallenge(nonce: string): object {
  return {
    type: 'event',
    event: 'connect.challenge',
    payload: {
      nonce,
      ts: Date.now(),
    },
  };
}

export function buildHelloOk(
  requestId: string,
  deviceToken: string,
): object {
  return {
    type: 'res',
    id: requestId,
    ok: true,
    payload: {
      type: 'hello-ok',
      protocol: 3,
      server: {
        version: 'nanoclaw/0.1.0',
        connId: randomUUID().slice(0, 12),
      },
      features: {
        methods: ['chat.send', 'chat.history', 'chat.abort'],
        events: ['chat', 'tick', 'connect.challenge'],
      },
      snapshot: {},
      auth: {
        deviceToken,
        role: 'node',
        scopes: [],
      },
      policy: {
        maxPayload: 1048576,
        maxBufferedBytes: 4194304,
        tickIntervalMs: 15000,
      },
    },
  };
}

export function buildHelloError(
  requestId: string,
  reason: string,
): object {
  return {
    type: 'res',
    id: requestId,
    ok: false,
    error: { code: 'AUTH_FAILED', message: reason },
  };
}

export function buildChatEvent(
  sessionKey: string,
  runId: string,
  seq: number,
  state: 'delta' | 'final',
  text: string,
  stopReason?: string,
): object {
  const payload: Record<string, unknown> = {
    runId,
    sessionKey,
    seq,
    state,
  };
  if (text) {
    payload.message = {
      role: 'assistant',
      content: [{ type: 'text', text }],
      timestamp: Date.now(),
    };
  }
  if (stopReason) payload.stopReason = stopReason;
  return {
    type: 'event',
    event: 'chat',
    payload,
  };
}

export function buildChatAck(
  requestId: string,
  runId: string,
  sessionKey: string,
): object {
  return {
    type: 'res',
    id: requestId,
    ok: true,
    payload: { runId, sessionKey },
  };
}

export function buildTick(): object {
  return {
    type: 'event',
    event: 'tick',
    payload: { ts: Date.now() },
  };
}

// ── Parser ───────────────────────────────────────────────────────────

export function parseFrame(raw: string): Record<string, unknown> {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e}`);
  }
  if (typeof msg !== 'object' || msg === null || !('type' in msg)) {
    throw new Error("Missing 'type' field");
  }
  return msg as Record<string, unknown>;
}
