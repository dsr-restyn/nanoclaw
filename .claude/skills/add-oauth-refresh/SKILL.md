# Add OAuth Token Refresh

Auto-refresh Claude OAuth tokens for container authentication. Reads from `~/.claude/.credentials.json` (auto-maintained by Claude Code), refreshes tokens 10 minutes before expiry, and writes updated tokens back atomically.

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

This modifies `src/container-runner.ts` to:
- Add `readFreshOAuthToken()` — reads from credentials file, auto-refreshes near expiry
- Add `refreshOAuthToken()` — calls Claude platform OAuth endpoint with refresh token
- Use `readFreshOAuthToken()` in `buildContainerArgs()` instead of reading from `.env`

If merge conflicts occur, read `modify/src/container-runner.ts.intent.md`.

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

1. On each container spawn, `readFreshOAuthToken()` reads `~/.claude/.credentials.json`
2. If `expiresAt - now < 10 minutes`, calls `refreshOAuthToken()` with the refresh token
3. Refresh hits `https://platform.claude.com/v1/oauth/token` with `grant_type: refresh_token`
4. New tokens written back atomically (temp file + rename) so Claude Code stays in sync
5. If refresh fails, falls back to existing token, then to `.env` values
6. Fresh token passed to container via `CLAUDE_CODE_OAUTH_TOKEN` env var

## Troubleshooting

### Token refresh fails

- Check `~/.claude/.credentials.json` has a valid `refreshToken`
- Check network connectivity to `platform.claude.com`
- The skill falls back gracefully — old token or `.env` value is used

### Credentials file not found

- Claude Code creates this automatically when you authenticate
- Run `claude` once to generate it
- The skill falls back to reading `CLAUDE_CODE_OAUTH_TOKEN` from `.env`
