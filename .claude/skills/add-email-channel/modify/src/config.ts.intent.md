# Intent: src/config.ts modifications

## What changed
Added email channel configuration exports.

## Key sections

### New exports (after TIMEZONE, at end of file)
- `EMAIL_ENABLED` — boolean, defaults false, read from .env
- `EMAIL_POLL_INTERVAL` — number in ms (env value is in seconds), defaults 60s
- `EMAIL_INBOX_ADDRESS` — string, defaults empty

### New readEnvFile call
- Reads: `EMAIL_ENABLED`, `EMAIL_POLL_INTERVAL`, `EMAIL_INBOX_ADDRESS`

## Invariants
- All existing exports unchanged
- Uses same `readEnvFile` pattern as existing config
- Email config added after TIMEZONE export, at end of file
