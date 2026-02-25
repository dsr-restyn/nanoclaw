# Intent: src/config.ts modifications

## What changed
Added LOGSEQ_GRAPH_PATH configuration for Logseq knowledge graph integration.

## Key sections

### readEnvFile call
- Added key: `LOGSEQ_GRAPH_PATH` (after `NTFY_TOPIC`)

### New export (appended at end of file)
- `LOGSEQ_GRAPH_PATH` — string, path to user's Logseq graph folder, defaults to empty string (disabled when empty)

## Invariants
- All existing config exports remain unchanged
- New key is added to the `readEnvFile` call alongside existing keys
- Both `process.env` and `envConfig` are checked (same pattern as other config vars)

## Must-keep
- All existing exports
- The `readEnvFile` pattern — ALL config read from `.env` must go through this function
