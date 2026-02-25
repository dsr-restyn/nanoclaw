# Intent: src/container-runner.ts modifications

## What changed
Pass NTFY_TOPIC as a container environment variable so agents can send push notifications.

## Key sections

### Import block
- Added `NTFY_TOPIC` to the config import

### buildContainerArgs function
- Added conditional `-e NTFY_TOPIC=${NTFY_TOPIC}` after the TZ env var
- Only passes the env var when NTFY_TOPIC is non-empty

## Invariants
- All existing container args remain unchanged
- NTFY_TOPIC is NOT a secret — it's passed as a regular env var via `-e`, not via stdin
- The env var is only added when the topic is configured (non-empty)

## Must-keep
- All existing `-e` env var passes (TZ, HOME)
- The secrets mechanism (readSecrets/stdin) — NTFY_TOPIC does NOT go through this
- The full buildContainerArgs function structure
