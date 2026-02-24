# Intent: src/config.ts modifications

## What changed
Added channel configuration flags for HTTP/SSE channel and WhatsApp enable control.

## Key sections

### readEnvFile call
- Added keys: `HTTP_CHANNEL_ENABLED`, `HTTP_PORT`, `WHATSAPP_ENABLED`
- NanoClaw does NOT load `.env` into `process.env` — all `.env` values must be explicitly requested via `readEnvFile()`

### New exports (appended at end of file)
- `WHATSAPP_ENABLED` — boolean, defaults to `true` (enabled unless explicitly set to `'false'`)
- `HTTP_CHANNEL_ENABLED` — boolean, defaults to `false` (disabled unless explicitly set to `'true'`)
- `HTTP_PORT` — integer, defaults to `4080`

## Invariants
- All existing config exports remain unchanged
- New keys are added to the `readEnvFile` call alongside existing keys
- Both `process.env` and `envConfig` are checked (same pattern as `ASSISTANT_NAME`)

## Must-keep
- All existing exports (`ASSISTANT_NAME`, `POLL_INTERVAL`, `TRIGGER_PATTERN`, etc.)
- The `readEnvFile` pattern — ALL config read from `.env` must go through this function
- The `escapeRegex` helper and `TRIGGER_PATTERN` construction
