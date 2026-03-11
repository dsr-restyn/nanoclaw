# Intent: src/container-runner.ts modifications

## What changed
Replaced stdin-based secret passing with credential proxy + OAuth token auto-refresh. Containers no longer receive secrets directly — API key mode uses a credential proxy, OAuth mode reads fresh tokens from `~/.claude/.credentials.json`.

## Key sections

### New imports (top of file)
- Added: `import os from 'os'`
- Added: `detectAuthMode` from `./credential-proxy.js`
- Added: `CREDENTIAL_PROXY_PORT` from `./config.js`
- Added: `CONTAINER_HOST_GATEWAY`, `hostGatewayArgs` from `./container-runtime.js`
- Added: `readEnvFile` from `./env.js`

### New constants and types (after imports)
- `OAUTH_TOKEN_URL` — Claude platform token endpoint
- `OAUTH_CLIENT_ID` — Claude Code's OAuth client ID
- `REFRESH_BUFFER_MS` — 10 minute refresh buffer
- `OAuthCredentials` interface

### New functions (before buildVolumeMounts)
- `refreshOAuthToken(credPath, creds, oauth)` — calls platform endpoint with refresh token, writes new tokens back atomically
- `readFreshOAuthToken()` — reads credentials file, checks expiry, calls refresh if needed, falls back to `.env`

### ContainerInput changes
- Removed: `secrets?: Record<string, string>` field

### buildVolumeMounts() changes
- Added: `.env` shadow mount (`/dev/null` → `/workspace/project/.env`) so agents can't read secrets from mounted project root

### buildContainerArgs() changes
- Changed: now `async` (returns `Promise<string[]>`)
- Added: `detectAuthMode()` check — API key mode uses credential proxy, OAuth mode uses `readFreshOAuthToken()`
- Added: `hostGatewayArgs()` for runtime-specific gateway resolution
- Removed: `readSecrets()` function (no longer needed)

### runContainerAgent() changes
- Changed: `await buildContainerArgs(mounts, containerName)` (was sync)
- Removed: `input.secrets = readSecrets()` and `delete input.secrets`
- Input is written directly to stdin without secrets

## Prior skills included
- autointel: `AUTOINTEL_PATH` import from config.js, autoIntel mount block in buildVolumeMounts()

## Invariants
- All existing mount logic unchanged (including autointel mount)
- Falls back gracefully: fresh token → stale token → .env value
- Atomic credential writes (temp + rename) prevent corruption
- Credentials file is never mounted into containers
- `buildContainerArgs` callers must await it (async change)
