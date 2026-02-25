# Intent: src/channels/http.ts modifications for custom Creations

## Summary

Adds automatic discovery, static-file mounting, group registration, and pairing QR codes for custom Creations placed under `static/`. Each subdirectory containing a `creation.json` manifest is treated as an independent Creation with its own route prefix, HTTP group, and QR install code.

## Key changes

### New import
- `readFileSync`, `readdirSync`, `existsSync` from `fs` — used by the discovery function.

### New interface: `CreationManifest`
- Added after `GroupEvent` interface, before the Auth section.
- Defines the shape of `creation.json` files: `name`, `slug`, `group`, `description`, `themeColor`.

### New function: `discoverCreations`
- Added after `requireAuth`, before the Channel class.
- Scans `static/` for subdirectories (skipping `_`-prefixed and `creation`) that contain a valid `creation.json`.
- Returns an array of `CreationManifest` objects.

### New class field: `creations`
- `private creations: CreationManifest[]` on `HttpChannel`, initialized to `[]`.

### `connect()` changes
1. **Static mount loop** — after the main `/creation/` static registration and before `this.setupRoutes()`, discovers custom Creations and registers a `@fastify/static` instance for each at `/{slug}/`.
2. **Auto-register groups** — after the "HTTP channel listening" log, iterates discovered Creations and calls `registerGroup` + `onChatMetadata` for any that don't already have an HTTP group (JID format: `http:creation:{slug}`).

### `setupRoutes()` changes
1. **Slug redirects** — after the `/creation` redirect route, registers a `GET /{slug}` redirect to `/{slug}/` for each custom Creation.
2. **Per-Creation QR route** — `GET /pair/creation/:slug/qr` added before the existing `/pair` route. Generates an install QR PNG containing the Creation's URL, name, description, and theme color. Uses the caller's existing token (via `extractToken`).
3. **Pair page HTML** — the `/pair` handler now renders a section for each custom Creation (between the main Creation section and the voice section), each with its own QR image and description. The voice section heading number is dynamically offset by `this.creations.length`.

## Invariants (must remain true)

- All existing routes (`/health`, `/groups`, `/groups/:jid/messages`, `/groups/:jid/stream`, `/creation`, `/pair/install/qr`, `/pair/voice/qr`, `/pair`, voice WebSocket endpoints) are unchanged.
- The main `creation/` static mount at `/creation/` is unchanged.
- The `HttpChannelOpts` interface is unchanged.
- The `GroupEvent` interface is unchanged.
- SSE, voice, keepalive, disconnect logic are all unchanged.
- `extractToken` and `requireAuth` functions are unchanged.

## Must-keep list

- `extractToken` function — used by the new per-Creation QR route.
- `requireAuth` preHandler — used on the new QR route.
- `createHttpToken` import — still used by `/pair/install/qr` and `/pair/voice/qr`.
- `qrToBuffer` import — used by the new QR route.
- `resolve` import — used by discovery and mount logic.
- Main `@fastify/static` registration for `/creation/` — must remain as the first static plugin so `decorateReply` works correctly.
- `/creation` redirect route — custom Creation redirects are added after it, not replacing it.
- Voice section in `/pair` HTML — still rendered, just with a dynamic heading number.
