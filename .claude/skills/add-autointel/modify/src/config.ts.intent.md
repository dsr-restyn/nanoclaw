# Intent: src/config.ts modifications

## What changed
Added AUTOINTEL_PATH config export.

## Key sections
- Added: `readEnvFile` call for `AUTOINTEL_PATH`
- Added: `export const AUTOINTEL_PATH` — string, defaults to empty

## Invariants
- All existing config exports unchanged
- Defaults to empty string when not set (mount is skipped in container-runner)
