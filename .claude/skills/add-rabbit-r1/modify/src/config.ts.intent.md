# Intent: src/config.ts modifications

## What changed
Added voice channel configuration for R1 PTT support.

## Key sections

### readEnvFile call
- Added keys: `VOICE_ENABLED`, `VOICE_PORT`
- These are added alongside the http-channel keys (`HTTP_CHANNEL_ENABLED`, `HTTP_PORT`, `WHATSAPP_ENABLED`)

### New exports (appended at end of file)
- `VOICE_ENABLED` — boolean, defaults to `false` (disabled unless explicitly set to `'true'`)
- `VOICE_PORT` — integer, defaults to `443` (standard WSS port; behind a tunnel or reverse proxy this is correct)

## Invariants
- All existing config exports remain unchanged (including http-channel additions)
- New keys are added to the `readEnvFile` call alongside existing keys
- Both `process.env` and `envConfig` are checked (same pattern as other config values)

## Must-keep
- All existing exports including http-channel additions (`WHATSAPP_ENABLED`, `HTTP_CHANNEL_ENABLED`, `HTTP_PORT`)
- The `readEnvFile` pattern — ALL config read from `.env` must go through this function
