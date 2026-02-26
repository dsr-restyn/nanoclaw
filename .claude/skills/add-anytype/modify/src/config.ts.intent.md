# Intent: src/config.ts modifications

## What changed
Added ANYTYPE_API_KEY configuration for Anytype knowledge management integration.

## Key sections

### readEnvFile call
- Added key: `ANYTYPE_API_KEY` (after `TELEGRAM_ONLY`)

### New export (appended at end of file)
- `ANYTYPE_API_KEY` — string, API key for authenticating with the Anytype headless server, defaults to empty string (disabled when empty)

## Invariants
- All existing config exports remain unchanged
- New key is added to the `readEnvFile` call alongside existing keys
- Both `process.env` and `envConfig` are checked (same pattern as other config vars)

## Must-keep
- All existing exports
- The `readEnvFile` pattern — ALL config read from `.env` must go through this function
