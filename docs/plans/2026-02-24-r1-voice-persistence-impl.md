# R1 Voice Persistence & Creation Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make voice sessions survive R1 reconnects, fix creation message delivery, and convert the creation from a prompting UI to an agent activity dashboard.

**Architecture:** All changes are to skill template files under `.claude/skills/add-rabbit-r1/`. The skill engine applies these deterministically when users run the skill. DB changes go in the http-channel skill's db.ts (since R1 depends on it). Voice handler gets session persistence + unknown frame acknowledgment. Creation frontend gets renamed, restructured, and converted to a polling-based dashboard.

**Tech Stack:** TypeScript (Node.js/Fastify), SQLite (better-sqlite3), vanilla HTML/CSS/JS (240x282 R1 WebView)

**Design doc:** `docs/plans/2026-02-24-r1-voice-persistence-design.md`

---

### Task 1: Add voice_sessions table and DB helpers

**Files:**
- Modify: `.claude/skills/add-http-channel/modify/src/db.ts` (add table to schema + helpers after http_device_tokens section)

**Step 1: Add voice_sessions table to createSchema**

In `.claude/skills/add-http-channel/modify/src/db.ts`, add to the `createSchema` function's `database.exec(...)` block, after the `http_device_tokens` table:

```sql
CREATE TABLE IF NOT EXISTS voice_sessions (
  device_id       TEXT PRIMARY KEY,
  token_hash      TEXT NOT NULL,
  group_jid       TEXT NOT NULL,
  last_ip         TEXT,
  connected_at    TEXT,
  disconnected_at TEXT,
  drop_count      INTEGER DEFAULT 0
);
```

**Step 2: Add voice session DB helper functions**

Add these exports after the `getHttpGroupMessages` function at the end of the file:

```typescript
// --- Voice session persistence ---

export interface VoiceSession {
  device_id: string;
  token_hash: string;
  group_jid: string;
  last_ip: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  drop_count: number;
}

export function upsertVoiceSession(
  deviceId: string,
  tokenHash: string,
  groupJid: string,
  ip: string,
): void {
  db.prepare(`
    INSERT INTO voice_sessions (device_id, token_hash, group_jid, last_ip, connected_at, disconnected_at, drop_count)
    VALUES (?, ?, ?, ?, ?, NULL, 0)
    ON CONFLICT(device_id) DO UPDATE SET
      token_hash = excluded.token_hash,
      group_jid = excluded.group_jid,
      last_ip = excluded.last_ip,
      connected_at = excluded.connected_at,
      disconnected_at = NULL
  `).run(deviceId, tokenHash, groupJid, ip, new Date().toISOString());
}

export function disconnectVoiceSession(deviceId: string): void {
  db.prepare(`
    UPDATE voice_sessions
    SET disconnected_at = ?
    WHERE device_id = ?
  `).run(new Date().toISOString(), deviceId);
}

export function findRecentVoiceSession(
  ip: string,
  graceMs: number,
): VoiceSession | undefined {
  const cutoff = new Date(Date.now() - graceMs).toISOString();
  return db.prepare(`
    SELECT * FROM voice_sessions
    WHERE last_ip = ? AND disconnected_at IS NOT NULL AND disconnected_at > ?
    ORDER BY disconnected_at DESC
    LIMIT 1
  `).get(ip, cutoff) as VoiceSession | undefined;
}

export function incrementVoiceDropCount(deviceId: string): void {
  db.prepare(`
    UPDATE voice_sessions
    SET drop_count = drop_count + 1, connected_at = ?, disconnected_at = NULL
    WHERE device_id = ?
  `).run(new Date().toISOString(), deviceId);
}

export function getVoiceStatus(): VoiceSession | undefined {
  return db.prepare(`
    SELECT * FROM voice_sessions
    ORDER BY COALESCE(connected_at, disconnected_at) DESC
    LIMIT 1
  `).get() as VoiceSession | undefined;
}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Clean compile, no type errors.

**Step 4: Commit**

```
git add .claude/skills/add-http-channel/modify/src/db.ts
git commit -m "feat(r1): add voice_sessions table and DB helpers"
```

---

### Task 2: Voice handler — session persistence and IP-based reconnection

**Files:**
- Modify: `.claude/skills/add-rabbit-r1/add/src/channels/http/voice.ts`

**Step 1: Add imports for new DB functions**

Add `createHash` alongside the existing crypto import at line 9:

```typescript
import { createHash, randomBytes, randomUUID } from 'crypto';
```

Update the db import to include the new functions:

```typescript
import {
  storeMessageDirect,
  validateHttpToken,
  upsertVoiceSession,
  disconnectVoiceSession,
  findRecentVoiceSession,
  incrementVoiceDropCount,
} from '../../db.js';
```

**Step 2: Add RECONNECT_GRACE_MS constant and reduce TICK_INTERVAL**

Replace:

```typescript
const TICK_INTERVAL = 15_000;
```

With:

```typescript
const TICK_INTERVAL = 10_000;
const RECONNECT_GRACE_MS = 10 * 60 * 1000; // 10 minutes
```

**Step 3: Accept client IP as parameter**

Change the `voiceHandler` signature to accept the client IP (extracted by Fastify from the request):

```typescript
export async function voiceHandler(
  socket: WebSocket,
  channel: HttpChannel,
  clientIp: string,
): Promise<void> {
```

Update the call sites in `http.ts` to pass the IP.

**Step 4: Add IP-based reconnection in the handshake**

Replace the empty-token rejection block (the section from `if (!validateHttpToken(token))` through `socket.close(); return;`) with logic that:

1. Checks if this is an empty-token connection
2. Looks up `findRecentVoiceSession(clientIp, RECONNECT_GRACE_MS)`
3. If match found: calls `incrementVoiceDropCount`, sends hello-ok, and proceeds to session setup with the resumed group JID
4. If no match: rejects as before

On successful normal auth:
1. Compute `tokenHash = createHash('sha256').update(token).digest('hex')`
2. Call `upsertVoiceSession(deviceId, tokenHash, '', clientIp)` (group JID filled in later when findOrCreateGroup runs)

**Step 5: Refactor session setup into a reusable function**

Extract everything after the handshake (from `// Session state` through the cleanup handlers) into a `setupSession` function that can be called from both the normal auth path and the IP-resume path.

The function receives `resumeJid: string | null` — if non-null, use it as the initial `activeJid` (for reconnection). Otherwise, use `deviceGroups.get(deviceId)` as before.

**Step 6: Update disconnect handler to persist to DB**

Record connection start time and log duration on close:

```typescript
const connectTime = Date.now();

socket.on('close', () => {
  const duration = Math.round((Date.now() - connectTime) / 1000);
  logger.info({ deviceId, duration }, 'Voice client disconnected');
  disconnectVoiceSession(deviceId);
  // ... existing cleanup ...
});
```

**Step 7: Update upsert after group resolution**

After `findOrCreateGroup()` is called for the first time (in the chat.send handler), update the DB with the resolved group JID:

```typescript
const jid = findOrCreateGroup();
upsertVoiceSession(deviceId, '', jid, clientIp);
```

**Step 8: Commit**

```
git add .claude/skills/add-rabbit-r1/add/src/channels/http/voice.ts
git commit -m "feat(r1): IP-based voice session resume on empty-token reconnect"
```

---

### Task 3: Voice handler — unknown frame acknowledgment and diagnostics

**Files:**
- Modify: `.claude/skills/add-rabbit-r1/add/src/channels/http/voice.ts`

**Step 1: Add frame logging and catch-all req handler**

In the `socket.on('message')` handler, after the `chat.send` block, add an `else if` for unknown requests:

```typescript
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
      // Log client-originated events for diagnostics
      logger.debug(
        { deviceId, event: parsed.event },
        'Voice: client event received',
      );
    }
```

**Step 2: Commit**

```
git add .claude/skills/add-rabbit-r1/add/src/channels/http/voice.ts
git commit -m "feat(r1): acknowledge unknown OpenClaw requests, log all frames"
```

---

### Task 4: HTTP channel — /voice/status endpoint and SSE logging

**Files:**
- Modify: `.claude/skills/add-rabbit-r1/modify/src/channels/http.ts`

**Step 1: Add getVoiceStatus import**

Add `getVoiceStatus` to the imports from `../db.js`.

**Step 2: Update voiceHandler call sites to pass client IP**

In the WebSocket route handlers, extract the IP from the request and pass it:

```typescript
server.get('/', { websocket: true }, (socket, request) => {
  const ip = request.ip || request.headers['x-forwarded-for']?.toString() || 'unknown';
  voiceHandler(socket, this, ip);
});
```

Same for the `/ws/voice` route.

**Step 3: Add /voice/status endpoint**

In `setupRoutes()`, after the `/health` endpoint:

```typescript
    server.get('/voice/status', { preHandler: requireAuth }, async () => {
      const session = getVoiceStatus();
      if (!session) return { connected: false };
      const isConnected = session.disconnected_at === null;
      let durationSec = 0;
      if (session.connected_at) {
        const ref = isConnected ? Date.now() : new Date(session.disconnected_at!).getTime();
        durationSec = Math.round((ref - new Date(session.connected_at).getTime()) / 1000);
      }
      return {
        connected: isConnected,
        device_id: session.device_id,
        group_jid: session.group_jid,
        duration_sec: durationSec,
        drop_count: session.drop_count,
        connected_at: session.connected_at,
        disconnected_at: session.disconnected_at,
      };
    });
```

**Step 4: Add SSE connection logging**

In the SSE stream route handler (`GET /groups/:jid/stream`), add:

After registering the SSE client:
```typescript
logger.info({ jid, clientCount: this.sseClients.get(jid)!.size }, 'SSE client connected');
```

In the close handler:
```typescript
logger.info({ jid, remaining: set?.size ?? 0 }, 'SSE client disconnected');
```

**Step 5: Commit**

```
git add .claude/skills/add-rabbit-r1/modify/src/channels/http.ts
git commit -m "feat(r1): add /voice/status endpoint, SSE connection logging"
```

---

### Task 5: Rename Warren to NanoClaw across all frontend files

**Files:**
- Modify: `.claude/skills/add-rabbit-r1/add/static/creation/index.html`
- Modify: `.claude/skills/add-rabbit-r1/add/static/creation/js/api.js`
- Modify: `.claude/skills/add-rabbit-r1/add/static/creation/js/app.js`

**Step 1: Rename in index.html**

- Line 6: `<title>Warren</title>` to `<title>NanoClaw</title>`
- Line 13: `WARREN://` to `NANOCLAW://`

**Step 2: Rename in api.js**

- Line 1 comment: `Warren API client` to `NanoClaw API client`
- Line 9 comment: `Warren's /sessions/*` to `NanoClaw's /sessions/*`
- Line 11: `const Warren = (() => {` to `const NanoClaw = (() => {`

**Step 3: Rename in app.js**

- Line 2 comment: `Warren R1 Creation` to `NanoClaw R1 Creation`
- All references: `Warren.` to `NanoClaw.` (approximately 12 occurrences)

**Step 4: Commit**

```
git add .claude/skills/add-rabbit-r1/add/static/creation/
git commit -m "feat(r1): rename Warren to NanoClaw throughout creation frontend"
```

---

### Task 6: Creation API — add fetchVoiceStatus and polling fallback

**Files:**
- Modify: `.claude/skills/add-rabbit-r1/add/static/creation/js/api.js`

**Step 1: Add fetchVoiceStatus method**

```javascript
  async function fetchVoiceStatus() {
    return _fetch("/voice/status");
  }
```

**Step 2: Add fetchGroupActivity for polling fallback**

```javascript
  async function fetchGroupActivity(sessionId, since) {
    const params = since ? "?since=" + encodeURIComponent(since) : "";
    const msgs = await _fetch("/groups/" + _enc(sessionId) + "/messages" + params);
    return msgs.map(function(m) {
      return {
        type: m.is_bot_message ? "text" : "user",
        content: m.content,
        timestamp: m.timestamp,
        sender: m.sender_name,
      };
    });
  }
```

**Step 3: Export the new methods**

Add `fetchVoiceStatus` and `fetchGroupActivity` to the return object.

**Step 4: Commit**

```
git add .claude/skills/add-rabbit-r1/add/static/creation/js/api.js
git commit -m "feat(r1): add voice status and activity polling to creation API"
```

---

### Task 7: Creation HTML — restructure for dashboard-first layout

**Files:**
- Modify: `.claude/skills/add-rabbit-r1/add/static/creation/index.html`

**Step 1: Replace the sessions list view with a dashboard view**

Replace the entire `view-sessions` div with:

```html
  <!-- Dashboard View (default) -->
  <div id="view-dashboard" class="view active">
    <div class="header">
      <span class="title">NANOCLAW://</span>
      <span id="connection-dot" class="dot dot-gray"></span>
    </div>
    <div id="voice-banner" class="voice-banner">
      <span id="voice-state" class="voice-state">VOICE: --</span>
      <span id="voice-duration" class="voice-duration"></span>
      <span id="voice-drops" class="voice-drops"></span>
    </div>
    <div id="activity-feed" class="scroll-area"></div>
    <div class="footer">
      <div class="session-footer-row">
        <button id="btn-chat" class="btn-primary">[ CHAT ]</button>
        <button id="btn-monitor" class="btn-cmd-lg">[ MON ]</button>
      </div>
    </div>
  </div>
```

**Step 2: Remove the "New Session" view entirely**

Delete the `view-new` div. Voice handler auto-creates groups.

**Step 3: Commit**

```
git add .claude/skills/add-rabbit-r1/add/static/creation/index.html
git commit -m "feat(r1): restructure creation HTML for dashboard-first layout"
```

---

### Task 8: Creation app.js — dashboard with activity feed and polling

**Files:**
- Modify: `.claude/skills/add-rabbit-r1/add/static/creation/js/app.js`

This is the largest change. Rewrite app.js to be dashboard-centric.

**Key changes from current app.js:**

1. Default view is `dashboard` (not sessions list)
2. Activity feed renders all event types (user messages, text, tool, result) in a unified feed
3. Voice status banner polls `/voice/status` every 5 seconds
4. Activity polling fetches the active group's messages every 3 seconds as SSE fallback
5. Chat view still exists, navigated to via [ CHAT ] button
6. Remove new-session flow (voice handler auto-creates groups)
7. Auto-detect active group from groups list or voice status
8. Hardware bindings adapted: scroll up/down scrolls the activity feed on dashboard

**Preserve from current app.js:**
- Chat view and message sending
- PTT/SpeechRecognition
- Hardware bindings (scrollUp/Down, sideClick, longPress)
- Notification system
- Monitor view
- handleEvent, appendUserMsg, etc. (for chat view)

**Remove from current app.js:**
- Sessions list rendering (renderSessionList, refreshSessions)
- New session flow (startSession, view-new handling)
- Session creation from command palette
- selectedIndex for session list navigation

**Step 1: Rewrite app.js with dashboard as default view**

Full rewrite needed. Core structure:

- State: `currentView = "dashboard"`, `activeGroupJid`, `pollTimer`, `voicePollTimer`, `lastPollTimestamp`
- Views object: `{ dashboard, chat, monitor }`
- `refreshVoiceStatus()`: polls `/voice/status`, updates banner, auto-detects group JID
- `pollActivity()`: polls messages for active group, appends new items to feed
- `appendActivityItem(ev)`: renders a single activity item in the feed
- `showView(name)`: updated for dashboard/chat/monitor
- Chat view logic preserved from current app.js (openSession, sendMsg, handleEvent, etc.)
- Hardware bindings: dashboard scrolls activity feed, chat scrolls messages
- Initialize: init from URL, show dashboard, start voice poll, auto-detect group

**Step 2: Commit**

```
git add .claude/skills/add-rabbit-r1/add/static/creation/js/app.js
git commit -m "feat(r1): rewrite creation as dashboard-first with activity feed"
```

---

### Task 9: Creation CSS — dashboard and activity feed styles

**Files:**
- Modify: `.claude/skills/add-rabbit-r1/add/static/creation/css/styles.css`

**Step 1: Add voice banner styles**

```css
.voice-banner {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  gap: 6px;
  font-size: 10px;
  border-bottom: 1px solid #0a6e0a;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.voice-connected { color: #33ff33; text-shadow: 0 0 4px rgba(51, 255, 51, 0.3); }
.voice-disconnected { color: #ff3333; text-shadow: 0 0 4px rgba(255, 51, 51, 0.3); }
.voice-state { flex: 1; font-weight: 700; }
.voice-duration { font-variant-numeric: tabular-nums; }
.voice-drops { color: #0a6e0a; }
```

**Step 2: Add activity feed styles**

```css
.activity-user {
  padding: 4px 8px;
  margin-top: 6px;
  font-size: 11px;
  color: #33ff33;
  background: #0a1a0a;
  text-shadow: 0 0 4px rgba(51, 255, 51, 0.3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.activity-tool {
  padding: 2px 8px 2px 10px;
  font-size: 10px;
  color: #0a6e0a;
  border-left: 2px solid #0a6e0a;
  margin-left: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.activity-tool::before { content: "# "; color: #33ff33; }

.activity-text {
  padding: 3px 8px;
  font-size: 11px;
  color: #33ff33;
  text-shadow: 0 0 4px rgba(51, 255, 51, 0.3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.activity-result {
  padding: 3px 8px;
  font-size: 11px;
  color: #33ff33;
  font-weight: 700;
  text-shadow: 0 0 6px rgba(51, 255, 51, 0.5);
}

.activity-result::before { content: "* "; }
```

**Step 3: Commit**

```
git add .claude/skills/add-rabbit-r1/add/static/creation/css/styles.css
git commit -m "feat(r1): add dashboard and activity feed CSS styles"
```

---

### Task 10: Update skill documentation

**Files:**
- Modify: `.claude/skills/add-rabbit-r1/SKILL.md`

**Step 1: Update troubleshooting section**

Replace the "Voice reconnect" entry with:

> **Voice reconnect "invalid token":** The voice handler now persists sessions in SQLite
> and supports IP-based reconnection. If the R1 disconnects and reconnects from the same
> IP within 10 minutes, it will auto-resume without re-scanning the QR code. Check
> `/voice/status` for session health.

Add new entry:

> **Creation shows no responses:** The creation uses polling-based activity fetching.
> If the activity feed is empty, check that the voice session is connected (green banner).
> The creation polls `/groups/:jid/messages` every 3 seconds.

**Step 2: Commit**

```
git add .claude/skills/add-rabbit-r1/SKILL.md
git commit -m "docs(r1): update troubleshooting for voice persistence and dashboard"
```

---

### Task 11: Manual integration test

**Step 1: Build the project**

Run: `npm run build`
Expected: Clean compile.

**Step 2: Manual test checklist**

- [ ] Start nanoclaw with `npm run dev`
- [ ] Open `/pair?token=...` — QR codes generate
- [ ] Scan Creation QR on R1 — WebView loads with "NANOCLAW://" header
- [ ] Dashboard shows voice status banner (disconnected initially)
- [ ] Scan Voice QR on R1 — voice connects
- [ ] Dashboard updates to "VOICE: CONNECTED" with timer
- [ ] Speak via PTT — agent processes, activity feed shows tool + text events
- [ ] Wait for voice disconnect (~3 min) — R1 auto-reconnects via IP match
- [ ] Check logs for "Voice session resumed via IP match"
- [ ] Check logs for any "Voice: unknown req acknowledged" entries
- [ ] Navigate to chat view, send text message, verify response renders
- [ ] Check `/voice/status` endpoint returns correct data
