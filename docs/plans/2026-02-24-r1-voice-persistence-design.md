# R1 Voice Session Persistence & Creation Overhaul

**Date:** 2026-02-24
**Status:** Approved

## Problem Statement

Four issues with the R1 integration:

1. **Voice session drops after ~3 minutes.** The R1's native OpenClaw client doesn't persist its auth token. On reconnect it sends an empty token, which the server rejects, forcing the user to re-scan the QR code.
2. **Creation header says "Warren".** Should say "NanoClaw" throughout.
3. **Creation WebView doesn't receive agent responses.** SSE event delivery is broken — voice (WebSocket) gets responses fine, but the creation's EventSource never receives them.
4. **Creation purpose is wrong.** Currently a prompting interface (sessions, new session, chat). Should be a monitoring dashboard showing voice session health and agent activity.

## Root Cause Analysis

### Voice Drops

From logs:
```
02:08:00 — Auth succeeds (token: nBPdZrWW...)
02:11:01 — Voice client disconnected (~3 min later)
02:11:11 — R1 reconnects with empty token (tokenLength: 0) → rejected
```

The R1 forgets its token on disconnect. The drop itself may be caused by the server silently ignoring protocol-level requests from the R1 — the current message handler only processes `chat.send` and drops all other `req` frames without responding.

### Creation SSE

The `sendMessage()` method calls both `ssePush()` (SSE) and `bus.emit()` (voice). Voice works, SSE doesn't. Likely causes: R1 WebView doesn't fully support EventSource, or the SSE connection isn't establishing through the tunnel. Solution: add polling fallback.

## Design

### 1. Voice Session Persistence

#### Database Schema

New table `voice_sessions`:

```sql
CREATE TABLE voice_sessions (
  device_id       TEXT PRIMARY KEY,
  token_hash      TEXT NOT NULL,
  group_jid       TEXT NOT NULL,
  last_ip         TEXT,
  connected_at    TEXT,
  disconnected_at TEXT,
  drop_count      INTEGER DEFAULT 0
);
```

#### Reconnection Flow

On empty-token connection:
1. Look up `voice_sessions` for a recent disconnect from the same IP (within 10-minute grace window)
2. If match: accept connection, send hello-ok, resume group mapping, increment drop_count
3. If no match: reject as before

On valid-token connection:
1. Validate token as before
2. Upsert `voice_sessions` with device_id, token_hash, group_jid, IP

On disconnect:
1. Update `voice_sessions`: set disconnected_at, preserve all other fields

### 2. Root Cause Investigation & Keepalive Hardening

#### Unknown Frame Handling

The R1 likely sends protocol-level keepalive requests that we silently ignore. Add a catch-all handler:

```typescript
if (parsed.type === 'req') {
  socket.send(JSON.stringify({
    type: 'res', id: parsed.id, ok: true, payload: {}
  }));
}
```

#### Additional Hardening

- Log all frames received from R1 (not just chat.send) for diagnostics
- Log connection duration on disconnect
- Reduce tick interval from 15s to 10s
- Acknowledge all unknown `req` frames with a generic success response

### 3. Creation Overhaul

#### 3a. Warren to NanoClaw Rename

Text replacements across index.html, api.js, app.js:
- `WARREN://` -> `NANOCLAW://`
- `const Warren` -> `const NanoClaw`
- All `Warren.` references -> `NanoClaw.`

#### 3b. SSE Debug + Polling Fallback

- Add SSE connection logging on the server (log when clients register/disconnect for a JID)
- Add polling fallback in the creation: use `fetchSessionMessages()` on a short interval if EventSource fails
- New endpoint: `GET /voice/status` returns voice session state from `voice_sessions` table

#### 3c. Dashboard-First UI

Replace sessions list as default view with a live activity feed:

```
NANOCLAW://                          [dot]
---------------------------------------------
VOICE: CONNECTED  03:42  drops: 0
---------------------------------------------
> "Check the weather in Portland"
  [lightning] web_search: portland weather
  [lightning] read_result: parsing response
  [check] "It's 52F and cloudy in..."
---------------------------------------------
> "Remind me at 5pm to call mom"
  [lightning] task_scheduler: creating task
  [check] "Reminder set for 5:00 PM"
```

Event types rendered:
- `text` events: agent's spoken response (abbreviated)
- `tool` events: tool name + summary, shown as activity lines
- `result` events: final outcome marker
- `status` events: working/waiting indicator
- Voice metadata: connection state, duration, drop count

View restructure:
- **Dashboard (default)**: activity feed + voice health
- **Chat (secondary)**: still accessible for text fallback
- **Remove "New Session"**: voice handler auto-creates groups
- **Merge Monitor into Dashboard**: separate monitor view becomes redundant

## Files Changed

All changes in `.claude/skills/add-rabbit-r1/`:

| File | Change |
|------|--------|
| `add/src/channels/http/voice.ts` | Session persistence, unknown frame handling, connection logging |
| `modify/src/channels/http.ts` | `/voice/status` endpoint, SSE debug logging |
| `modify/src/db.ts` | `voice_sessions` table + helpers |
| `add/static/creation/index.html` | Rename, restructure to dashboard-first |
| `add/static/creation/js/api.js` | Rename, `fetchVoiceStatus()`, polling fallback |
| `add/static/creation/js/app.js` | Rename, dashboard view, activity feed rendering |
