# Intent: src/config.ts modifications

## What changed
Added NTFY_TOPIC configuration for ntfy.sh push notifications.

## Key sections

### readEnvFile call
- Added key: `NTFY_TOPIC`

### New export (appended at end of file)
- `NTFY_TOPIC` — string, defaults to empty string (disabled when empty)

## Invariants
- All existing config exports remain unchanged
- New key is added to the `readEnvFile` call alongside existing keys
- Both `process.env` and `envConfig` are checked (same pattern as other config vars)

## Must-keep
- All existing exports
- The `readEnvFile` pattern — ALL config read from `.env` must go through this function
