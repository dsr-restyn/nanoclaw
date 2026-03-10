# Intent: src/config.ts modifications

## What changed
Added AUTOINTEL_PATH config export for the autoIntel context repo mount.

## Key sections

### New export (after email config, at end of file)
- `AUTOINTEL_PATH` — string, defaults empty, read from .env
- When set and path exists, container-runner mounts it read-only into agent containers

### New readEnvFile call
- Reads: `AUTOINTEL_PATH`

## Invariants
- All existing exports unchanged (including email config from add-email-channel)
- Uses same `readEnvFile` pattern as existing config
- Depends on add-email-channel being applied first (builds on that config version)
