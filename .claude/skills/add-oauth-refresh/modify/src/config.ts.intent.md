# Intent: src/config.ts modifications

## What changed
Added CREDENTIAL_PROXY_PORT config export and updated secrets comment.

## Key sections

### Comment change (line 8)
- Changed: "where needed (container-runner.ts)" → "by the credential proxy (credential-proxy.ts)"
- Reflects that secrets are now handled by the credential proxy, not container-runner

### New export (after CONTAINER_MAX_OUTPUT_SIZE)
- `CREDENTIAL_PROXY_PORT` — number, defaults 3001, read from env
- Port the credential proxy listens on for container→host API requests

## Invariants
- All existing exports unchanged
- CREDENTIAL_PROXY_PORT inserted between CONTAINER_MAX_OUTPUT_SIZE and IPC_POLL_INTERVAL
