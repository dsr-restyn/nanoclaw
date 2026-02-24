/**
 * Voice WebSocket handler -- OpenClaw protocol for R1 PTT.
 *
 * Handles the OpenClaw gateway protocol handshake, routes chat.send
 * requests to a group via the HTTP channel, and streams responses
 * back as chat events for TTS.
 */

import { createHash, randomBytes, randomUUID } from 'crypto';
import type { WebSocket, RawData } from 'ws';

import { logger } from '../../logger.js';
import {
  storeMessageDirect,
  validateHttpToken,
  upsertVoiceSession,
  disconnectVoiceSession,
  findRecentVoiceSession,
  incrementVoiceDropCount,
} from '../../db.js';
import type { HttpChannel, GroupEvent } from '../http.js';
import {
  buildChallenge,
  buildHelloOk,
  buildHelloError,
  buildChatEvent,
  buildChatAck,
  buildTick,
  parseFrame,
} from './voice-protocol.js';


const TICK_INTERVAL = 10_000;
const IDLE_FINAL_TIMEOUT = 5_000;
const WS_PING_INTERVAL = 30_000;
const RECONNECT_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// In-memory map: device token prefix → group JID.
// Survives across WS reconnects within the same process.
const deviceGroups = new Map<string, string>();

// ── Handler ──────────────────────────────────────────────────────────

export async function voiceHandler(
  socket: WebSocket,
  channel: HttpChannel,
  clientIp: string,
): Promise<void> {
  const opts = channel.opts;

  // ── Handshake ────────────────────────────────────────────────────

  const nonce = randomBytes(16).toString('hex');
  socket.send(JSON.stringify(buildChallenge(nonce)));

  const connectRaw = await waitForMessage(socket, 10_000);
  if (!connectRaw) return;

  let msg: Record<string, unknown>;
  try {
    msg = parseFrame(connectRaw);
  } catch {
    socket.close();
    return;
  }

  if (msg.type !== 'req' || msg.method !== 'connect') {
    socket.close();
    return;
  }

  const requestId = (msg.id as string) || '';
  const params = (msg.params as Record<string, unknown>) || {};
  const auth = (params.auth as Record<string, unknown>) || {};
  const token =
    (auth.token as string) || (auth.deviceToken as string) || '';

  if (!token) {
    // Empty token — attempt IP-based session resume
    const recent = findRecentVoiceSession(clientIp, RECONNECT_GRACE_MS);
    if (recent) {
      const deviceId = recent.device_id;
      incrementVoiceDropCount(deviceId);
      socket.send(
        JSON.stringify(buildHelloOk(requestId, `resumed:${deviceId}`)),
      );
      logger.info(
        { deviceId, clientIp, dropCount: recent.drop_count + 1 },
        'Voice session resumed via IP match',
      );
      setupSession(socket, channel, deviceId, recent.group_jid || null, clientIp);
      return;
    }

    // No IP match — reject
    logger.warn(
      { tokenLength: 0, clientIp },
      'Voice handshake: empty token and no recent session for IP',
    );
    socket.send(
      JSON.stringify(buildHelloError(requestId, 'invalid token')),
    );
    socket.close();
    return;
  }

  if (!validateHttpToken(token)) {
    const preview = token.slice(0, 8) || '(empty)';
    logger.warn(
      { preview, tokenLength: token.length },
      'Voice handshake: invalid token (token not found in http_device_tokens table)',
    );
    socket.send(
      JSON.stringify(buildHelloError(requestId, 'invalid token')),
    );
    socket.close();
    return;
  }

  const deviceId = token.slice(0, 8);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  socket.send(JSON.stringify(buildHelloOk(requestId, token)));
  logger.info({ deviceId }, 'Voice authenticated');

  upsertVoiceSession(deviceId, tokenHash, '', clientIp);
  setupSession(socket, channel, deviceId, null, clientIp);
}

// ── Session setup ─────────────────────────────────────────────────────

function setupSession(
  socket: WebSocket,
  channel: HttpChannel,
  deviceId: string,
  resumeJid: string | null,
  clientIp: string,
): void {
  const opts = channel.opts;
  const connectTime = Date.now();

  // ── Session state ────────────────────────────────────────────────

  let activeJid: string | null =
    resumeJid || deviceGroups.get(deviceId) || null;
  let runId = randomUUID().slice(0, 12);
  let chatSeq = 0;
  let clientSessionKey = 'main';

  function findOrCreateGroup(): string {
    // Reuse persisted group from previous connection
    if (activeJid) {
      const groups = opts.registeredGroups();
      if (groups[activeJid]) {
        deviceGroups.set(deviceId, activeJid);
        return activeJid;
      }
      // Group was deleted, clear stale mapping
      activeJid = null;
    }

    // Find the most recent http group
    const groups = opts.registeredGroups();
    const httpGroups = Object.entries(groups)
      .filter(([jid]) => jid.startsWith('http:'))
      .sort(([, a], [, b]) => b.added_at.localeCompare(a.added_at));

    if (httpGroups.length > 0) {
      activeJid = httpGroups[0][0];
      deviceGroups.set(deviceId, activeJid);
      upsertVoiceSession(deviceId, '', activeJid, clientIp);
      return activeJid;
    }

    // Create a new group — use 'main' folder if no main group exists yet
    const id = randomUUID();
    const jid = `http:${id}`;
    const hasMain = Object.values(groups).some(g => g.folder === 'main');
    const folder = hasMain ? `http-${id.slice(0, 8)}` : 'main';
    opts.registerGroup(jid, {
      name: 'Voice',
      folder,
      trigger: '',
      added_at: new Date().toISOString(),
      requiresTrigger: false,
    });
    opts.onChatMetadata(
      jid,
      new Date().toISOString(),
      'Voice',
      'http',
      false,
    );
    activeJid = jid;
    deviceGroups.set(deviceId, jid);
    upsertVoiceSession(deviceId, '', jid, clientIp);
    return jid;
  }

  // ── Event relay ──────────────────────────────────────────────────

  let accumulatedText = '';
  let idleSince: number | null = null;
  let idleTimer: NodeJS.Timeout | null = null;

  function checkIdle(): void {
    if (!accumulatedText || idleSince === null) return;
    const elapsed = Date.now() - idleSince;
    if (elapsed >= IDLE_FINAL_TIMEOUT) {
      chatSeq++;
      const chatMsg = buildChatEvent(
        clientSessionKey,
        runId,
        chatSeq,
        'final',
        accumulatedText,
        'end_turn',
      );
      try {
        socket.send(JSON.stringify(chatMsg));
      } catch {
        /* disconnected */
      }
      accumulatedText = '';
      idleSince = null;
    }
  }

  function resetIdleTimer(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleSince = Date.now();
    idleTimer = setTimeout(checkIdle, IDLE_FINAL_TIMEOUT + 500);
  }

  const eventListener = (jid: string, event: GroupEvent) => {
    if (jid !== activeJid) return;
    resetIdleTimer();

    if (event.type === 'text') {
      const content = (event.content as string) || '';
      if (content) {
        accumulatedText += content;
        chatSeq++;
        const chatMsg = buildChatEvent(
          clientSessionKey,
          runId,
          chatSeq,
          'delta',
          content,
        );
        try {
          socket.send(JSON.stringify(chatMsg));
        } catch {
          /* disconnected */
        }
      }
    } else if (event.type === 'result') {
      const summary = (event.summary as string) || accumulatedText;
      chatSeq++;
      const chatMsg = buildChatEvent(
        clientSessionKey,
        runId,
        chatSeq,
        'final',
        summary,
        'end_turn',
      );
      try {
        socket.send(JSON.stringify(chatMsg));
      } catch {
        /* disconnected */
      }
      accumulatedText = '';
      idleSince = null;
    }
    // Tool events are not relayed to voice (not useful for TTS)
  };

  channel.onEvent(eventListener);

  // ── Tick keepalive ─────────────────────────────────────────────

  const tickInterval = setInterval(() => {
    try {
      socket.send(JSON.stringify(buildTick()));
    } catch {
      /* disconnected */
    }
  }, TICK_INTERVAL);

  // ── WebSocket-level ping/pong ──────────────────────────────────

  const pingInterval = setInterval(() => {
    try {
      if (socket.readyState === 1 /* WebSocket.OPEN */) {
        socket.ping();
      }
    } catch {
      /* disconnected */
    }
  }, WS_PING_INTERVAL);

  // ── Message loop ───────────────────────────────────────────────

  socket.on('message', (data: RawData) => {
    const raw = data.toString();
    let parsed: Record<string, unknown>;
    try {
      parsed = parseFrame(raw);
    } catch {
      return;
    }

    if (parsed.type === 'req' && parsed.method === 'chat.send') {
      const reqId = (parsed.id as string) || '';
      const reqParams =
        (parsed.params as Record<string, unknown>) || {};
      const message = (reqParams.message as string) || '';
      if (!message) return;

      logger.info(
        { deviceId, message: message.slice(0, 100) },
        'Voice chat.send',
      );

      runId = randomUUID().slice(0, 12);
      chatSeq = 0;
      accumulatedText = '';
      clientSessionKey =
        (reqParams.sessionKey as string) || 'main';

      const jid = findOrCreateGroup();

      // Acknowledge
      socket.send(
        JSON.stringify(
          buildChatAck(reqId, runId, clientSessionKey),
        ),
      );

      // Store and process
      storeMessageDirect({
        id: randomUUID(),
        chat_jid: jid,
        sender: 'voice-user',
        sender_name: 'Voice',
        content: message,
        timestamp: new Date().toISOString(),
        is_from_me: false,
        is_bot_message: false,
      });
      opts.enqueueCheck(jid);
    } else if (parsed.type === 'req') {
      // Acknowledge unknown requests so R1 doesn't consider session dead
      const reqId = (parsed.id as string) || '';
      logger.info(
        { deviceId, method: parsed.method, id: reqId },
        'Voice: unknown req acknowledged',
      );
      try {
        socket.send(JSON.stringify({
          type: 'res',
          id: reqId,
          ok: true,
          payload: {},
        }));
      } catch { /* disconnected */ }
    } else if (parsed.type === 'event') {
      logger.debug(
        { deviceId, event: parsed.event },
        'Voice: client event received',
      );
    }
  });

  // ── Cleanup ────────────────────────────────────────────────────

  socket.on('close', () => {
    const duration = Math.round((Date.now() - connectTime) / 1000);
    logger.info({ deviceId, duration }, 'Voice client disconnected');
    disconnectVoiceSession(deviceId);
    clearInterval(tickInterval);
    clearInterval(pingInterval);
    if (idleTimer) clearTimeout(idleTimer);
    channel.offEvent(eventListener);
  });

  socket.on('error', (err: Error) => {
    logger.warn(
      { deviceId, err: err.message },
      'Voice socket error',
    );
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

function waitForMessage(
  socket: WebSocket,
  timeoutMs: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.removeListener('message', handler);
      resolve(null);
    }, timeoutMs);

    function handler(data: Buffer | string) {
      clearTimeout(timer);
      resolve(data.toString());
    }

    socket.once('message', handler);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}
