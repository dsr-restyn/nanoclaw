# Add OAuth Token Refresh

Auto-refresh Claude OAuth tokens for container authentication, plus credential proxy for API key isolation. Replaces stdin-based secret passing with a credential proxy (API key mode) or direct token injection (OAuth mode).

Fixes the overnight token expiry problem where NanoClaw stops working because the OAuth token in `.env` goes stale.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `oauth-refresh` is in `applied_skills`, skip to Phase 3.

### When you need this

If your NanoClaw deployment uses OAuth authentication (not API key), tokens expire ~7 hours after issue. Without this skill, the orchestrator reads a stale token from `.env` and containers fail to authenticate after the token expires.

With this skill, the orchestrator reads from `~/.claude/.credentials.json` (which Claude Code auto-refreshes) and proactively refreshes tokens before they expire.

## Phase 2: Apply Code Changes

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-oauth-refresh
```

This:
- Adds `src/credential-proxy.ts` — HTTP proxy that injects real credentials so containers never see them
- Modifies `src/config.ts` — adds `CREDENTIAL_PROXY_PORT` export
- Modifies `src/container-runtime.ts` — adds `CONTAINER_HOST_GATEWAY`, `PROXY_BIND_HOST`, `hostGatewayArgs()` for container→host networking
- Modifies `src/container-runner.ts`:
  - Adds `readFreshOAuthToken()` — reads from credentials file, auto-refreshes near expiry
  - Adds `refreshOAuthToken()` — calls Claude platform OAuth endpoint with refresh token
  - Replaces stdin secret passing with credential proxy (API key) or direct token (OAuth)
  - Adds `.env` shadow mount to prevent secret leakage
  - Makes `buildContainerArgs()` async

If merge conflicts occur, read the intent files:
- `modify/src/container-runner.ts.intent.md`
- `modify/src/config.ts.intent.md`
- `modify/src/container-runtime.ts.intent.md`

### Validate

```bash
npm run build
npm test
```

## Phase 3: Verify

1. Check that `~/.claude/.credentials.json` exists and has `claudeAiOauth` with `accessToken`, `refreshToken`, and `expiresAt`
2. Run with debug logging: `LOG_LEVEL=debug npm run dev`
3. Look for "OAuth token near expiry, refreshing" log when token is within 10 minutes of expiry
4. After refresh: "OAuth token refreshed successfully" with new expiry time

## How It Works

### Auth Modes

**API Key mode** (`ANTHROPIC_API_KEY` set in `.env`):
1. Credential proxy starts on `CREDENTIAL_PROXY_PORT` (default 3001)
2. Containers get `ANTHROPIC_BASE_URL=http://host.docker.internal:3001` and a placeholder API key
3. Proxy intercepts requests and injects the real API key
4. Containers never see the actual key

**OAuth mode** (no API key, using Claude Code OAuth):
1. On each container spawn, `readFreshOAuthToken()` reads `~/.claude/.credentials.json`
2. If `expiresAt - now < 10 minutes`, calls `refreshOAuthToken()` with the refresh token
3. Refresh hits `https://platform.claude.com/v1/oauth/token` with `grant_type: refresh_token`
4. New tokens written back atomically (temp file + rename) so Claude Code stays in sync
5. If refresh fails, falls back to existing token, then to `.env` values
6. Fresh token passed to container via `CLAUDE_CODE_OAUTH_TOKEN` env var

### Security

- `.env` is shadow-mounted with `/dev/null` for main group (prevents agents reading secrets from project root)
- Credential proxy binds to docker0 bridge IP on Linux (not 0.0.0.0) so only containers can reach it
- `secrets` field removed from `ContainerInput` — credentials never pass through stdin

## Troubleshooting

### Token refresh fails

- Check `~/.claude/.credentials.json` has a valid `refreshToken`
- Check network connectivity to `platform.claude.com`
- The skill falls back gracefully — old token or `.env` value is used

### Credentials file not found

- Claude Code creates this automatically when you authenticate
- Run `claude` once to generate it
- The skill falls back to reading `CLAUDE_CODE_OAUTH_TOKEN` from `.env`

### Credential proxy not reachable from containers

- Check `CREDENTIAL_PROXY_PORT` is not in use by another service
- On Linux: verify docker0 bridge IP with `ip addr show docker0`
- Override with `CREDENTIAL_PROXY_HOST=0.0.0.0` in `.env` (less secure)
