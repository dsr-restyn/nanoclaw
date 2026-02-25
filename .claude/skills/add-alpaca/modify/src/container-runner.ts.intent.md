# Intent: src/container-runner.ts modifications

## What changed
Pass Alpaca trading API credentials as container environment variables so agents can trade.

## Key sections

### Import block
- Added `ALPACA_API_KEY`, `ALPACA_PAPER`, `ALPACA_SECRET_KEY` to the config import (alphabetical order)

### buildContainerArgs function
- Added conditional block after the NTFY_TOPIC env var:
  ```typescript
  if (ALPACA_API_KEY) {
    args.push('-e', `ALPACA_API_KEY=${ALPACA_API_KEY}`);
    args.push('-e', `ALPACA_SECRET_KEY=${ALPACA_SECRET_KEY}`);
    args.push('-e', `ALPACA_PAPER=${ALPACA_PAPER}`);
  }
  ```
- Only passes all three env vars when ALPACA_API_KEY is non-empty
- All three vars are gated on ALPACA_API_KEY — no point passing secret/paper without the key

### redactArgs helper function
- Added before `buildContainerArgs` to redact `ALPACA_API_KEY` and `ALPACA_SECRET_KEY` values from logged container args
- Used in both the debug log and error log file sections (replaces raw `containerArgs.join(' ')`)

### Logseq mount existence check
- The Logseq mount block now checks `fs.existsSync(LOGSEQ_GRAPH_PATH)` before mounting
- Logs a warning if the configured path doesn't exist

## Invariants
- All existing container args remain unchanged
- Alpaca credentials are NOT secrets in the SDK sense — they're passed as regular env vars via `-e`, not via stdin
- The env vars are only added when ALPACA_API_KEY is configured (non-empty)
- ALPACA_PAPER is always passed alongside the keys so the agent knows which environment it's targeting
- Alpaca API key and secret key values are never written to log files (redacted to `***`)

## Must-keep
- All existing `-e` env var passes (TZ, HOME, NTFY_TOPIC)
- The secrets mechanism (readSecrets/stdin) — Alpaca vars do NOT go through this
- The full buildContainerArgs function structure
- The `redactArgs` function — prevents credential leakage in container logs
