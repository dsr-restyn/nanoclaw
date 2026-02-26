# Intent: src/env.ts modifications

## What changed
Added `readAllEnvVars()` function that returns all key-value pairs from `.env` without filtering by key. Used by container-runner.ts to forward non-secret env vars to containers.

### New function: readAllEnvVars (before readEnvFile)
- Same parsing logic as readEnvFile but without the `wanted` key filter
- Returns all key-value pairs from `.env`
- Skips comments and empty lines, handles quoted values

## Invariants
- `readEnvFile()` is completely unchanged
- No changes to imports or module structure

## Must-keep
- The existing `readEnvFile` function exactly as-is
- The quote-stripping logic for values
