# Intent: src/container-runner.ts modifications

## What changed
Added OAuth token auto-refresh for container authentication. Instead of reading a stale token from `.env`, the orchestrator reads from `~/.claude/.credentials.json` and refreshes tokens before they expire.

## Key sections

### New imports (top of file)
- Added: `import os from 'os'`
- Added: `detectAuthMode` from `./credential-proxy.js`
- Added: `CREDENTIAL_PROXY_PORT` from `./config.js`
- Added: `CONTAINER_HOST_GATEWAY`, `hostGatewayArgs` from `./container-runtime.js`

### New constants and types (after imports)
- `OAUTH_TOKEN_URL` — Claude platform token endpoint
- `OAUTH_CLIENT_ID` — Claude Code's OAuth client ID
- `REFRESH_BUFFER_MS` — 10 minute refresh buffer
- `OAuthCredentials` interface

### New functions (before buildVolumeMounts)
- `refreshOAuthToken(credPath, creds, oauth)` — calls platform endpoint with refresh token, writes new tokens back atomically
- `readFreshOAuthToken()` — reads credentials file, checks expiry, calls refresh if needed, falls back to `.env`

### buildContainerArgs() changes
- Added: `--add-host=host.docker.internal:host-gateway` for container→host networking
- Added: `detectAuthMode()` check — API key mode uses credential proxy, OAuth mode uses `readFreshOAuthToken()`
- Added: `hostGatewayArgs()` for runtime-specific gateway resolution
- Added: Integration key forwarding (ANYTYPE_API_KEY, LOGSEQ_GRAPH_PATH, NTFY_TOPIC)
- Changed: `buildContainerArgs` is now `async` (returns `Promise<string[]>`)
- Removed: `secrets` field from `ContainerInput` (credentials no longer passed via stdin)

### buildVolumeMounts() changes
- Added: `.env` shadow mount (`/dev/null` → `/workspace/project/.env`) so agents can't read secrets from mounted project root

## Invariants
- All existing mount logic unchanged
- Falls back gracefully: fresh token → stale token → .env value
- Atomic credential writes (temp + rename) prevent corruption
- Credentials file is never mounted into containers
- `buildContainerArgs` callers must await it (async change)
