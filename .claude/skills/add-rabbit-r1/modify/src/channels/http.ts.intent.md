# Intent: src/channels/http.ts modifications

## What changed
Added R1-specific features on top of the base HTTP channel: voice WebSocket, static file serving, and QR pairing endpoints.

## Key sections

### Imports (top of file)
- Added: `fastifyWebSocket` from `@fastify/websocket`
- Added: `fastifyStatic` from `@fastify/static`
- Added: `toBuffer as qrToBuffer` from `qrcode`
- Added: `resolve` from `path`, `fileURLToPath` from `url`
- Added: `voiceHandler` from `./http/voice.js`
- Added: `VOICE_ENABLED`, `VOICE_PORT`, `HTTP_PORT` to `../config.js` import
- Added: `createHttpToken` to `../db.js` import

### connect() — plugin registration
- Added: conditional `fastifyWebSocket` registration (when `VOICE_ENABLED`)
- Added: `fastifyStatic` registration for Creation frontend at `/creation/`
- Both registered BEFORE `this.setupRoutes()` and AFTER cors

### setupRoutes() — new routes (after SSE stream route)
- Added: `GET /creation` redirect to `/creation/` (trailing slash needed by @fastify/static)
- Added: `WS /` and `WS /ws/voice` voice WebSocket handlers (conditional on VOICE_ENABLED)
- Added: `GET /pair/install/qr` — Creation install QR code as PNG image
- Added: `GET /pair/voice/qr` — Voice gateway QR code as PNG image (conditional on VOICE_ENABLED)
- Added: `GET /pair` — admin HTML page showing both QR images

### QR code formats
- Creation QR: `{title, url, description, iconUrl, themeColor}` — all fields required by R1
- Voice QR: `{type: "clawdbot-gateway", version: 1, ips, port, token, protocol: "wss"}` — version field required

## Invariants
- All existing routes (health, groups, messages, stream) are preserved
- The `extractToken` and `requireAuth` functions are unchanged
- The `HttpChannel` class structure and Channel interface implementation are unchanged
- SSE client tracking and keepalive are unchanged
- The event bus (`onEvent`/`offEvent`) is unchanged

## Must-keep
- All existing REST endpoints and their auth requirements
- The SSE stream implementation with keepalive
- The `GroupEvent` type and event bus pattern
- The `HttpChannelOpts` interface
