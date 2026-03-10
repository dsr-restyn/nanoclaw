# Intent: src/config.ts modifications

## What changed
Added EMAIL_ENABLED, EMAIL_POLL_INTERVAL, EMAIL_INBOX_ADDRESS config exports.

## Key sections
- Added: `readEnvFile` call for email config keys
- Added: `EMAIL_ENABLED` boolean export (defaults false)
- Added: `EMAIL_POLL_INTERVAL` number export in ms (defaults 60000, reads seconds from env)
- Added: `EMAIL_INBOX_ADDRESS` string export (defaults empty)

## Invariants
- All existing config exports unchanged
- readEnvFile pattern matches existing usage (ASSISTANT_NAME, ANYTYPE_API_KEY, etc.)
