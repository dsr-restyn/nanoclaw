---
name: add-rabbit-r1
description: Add Rabbit R1 support to the HTTP channel. Adds R1 Creation frontend (240x282 WebView), OpenClaw voice WebSocket for PTT, and QR pairing endpoint.
---

# Add Rabbit R1 Support

This skill adds R1-specific features on top of the HTTP channel using the skills engine for deterministic code changes.

- **Creation frontend** — 240x282px vanilla HTML/CSS/JS WebView (CRT terminal theme)
- **Voice WebSocket** — OpenClaw protocol for push-to-talk
- **QR pairing** — admin endpoint generates install + voice pairing QR codes

## Phase 1: Pre-flight

### Check dependency

Read `.nanoclaw/state.yaml`. If `http-channel` is NOT in `applied_skills`, tell the user to run `/add-http-channel` first and stop.

### Check if already applied

If `rabbit-r1` is in `applied_skills`, skip to Phase 4 (Done).

## Phase 2: Apply Code Changes

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-rabbit-r1
```

This deterministically:
- Adds `src/channels/http/voice.ts` (OpenClaw voice handler with reconnect resilience)
- Adds `src/channels/http/voice-protocol.ts` (protocol message builders/parsers)
- Adds `static/creation/` (R1 WebView frontend — HTML, JS, CSS)
- Three-way merges voice/static/pairing support into `src/channels/http.ts`
- Three-way merges voice config into `src/config.ts` (VOICE_ENABLED, VOICE_PORT)
- Installs `@fastify/static`, `@fastify/websocket`, `qrcode` npm dependencies
- Updates `.env.example` with `VOICE_ENABLED`, `VOICE_PORT`
- Records the application in `.nanoclaw/state.yaml`

If the apply reports merge conflicts, read the intent files:
- `modify/src/channels/http.ts.intent.md` — voice routes, static serving, QR endpoints
- `modify/src/config.ts.intent.md` — voice config exports

### Update build script

The Creation frontend is static HTML/CSS/JS and needs to be copied to `dist/` alongside compiled TypeScript. In `package.json`, update the `build` script:

```json
"build": "tsc && cp -r static dist/"
```

If the build script already has additional steps, append `&& cp -r static dist/` to the end.

### Validate

```bash
npm run build
ls dist/static/creation/index.html
```

Build must be clean and static files must exist in `dist/`.

## Phase 3: Configure

Add to `.env`:

```
VOICE_ENABLED=true          # optional — enables PTT voice
VOICE_PORT=443              # optional — defaults to 443 (standard WSS)
```

## Phase 4: Done

Tell the user:

> R1 support installed.
>
> **Pair your R1:**
> Open the admin pairing page on your computer or phone:
> `http://YOUR_HOST:4080/pair?token=YOUR_TOKEN`
>
> It shows two QR codes — scan them with your R1:
> - **Creation QR** — installs the WebView UI on the R1
> - **Voice QR** — pairs push-to-talk (if VOICE_ENABLED=true)
>
> **Health check:** `curl http://YOUR_HOST:4080/health`

## Troubleshooting

**Creation shows "no ?token= in URL":** The R1 must load the Creation via the
QR-generated URL that includes `?token=`. If loading manually, append the token.

**Voice handshake fails:** Check that `VOICE_ENABLED=true` is set. The R1's OpenClaw
client expects the connect/challenge handshake — ensure the WebSocket is reachable.

**Static files 404:** Verify `dist/static/creation/` exists after build. The `cp -r static dist/`
step in the build script must run after `tsc`.

**QR codes not generating:** Ensure `qrcode` package is installed. The `/pair` endpoint
requires a valid auth token.

**Voice audio delayed:** The voice handler accumulates text events and sends a "final"
message after 5 seconds of idle time. This is intentional — it batches tokens for TTS.

**Voice reconnect "invalid token":** The voice handler persists device-to-group
mappings in memory. Reconnects reuse the same group. If the token is truly invalid,
create a new one via the `/pair` page.
