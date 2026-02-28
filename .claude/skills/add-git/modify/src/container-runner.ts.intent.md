# Intent: src/container-runner.ts modifications

## What changed
Added GITHUB_TOKEN to stdin secrets and restricted it to main group containers only.

## Key sections

### readSecrets function
- Added `'GITHUB_TOKEN'` to the allowed secrets array in `readEnvFile()` call
- This makes the token available for stdin injection alongside API keys

### Secret injection block (runContainerAgent)
- Added a main-only filter before writing secrets to stdin
- If `!input.isMain`, deletes `GITHUB_TOKEN` from `input.secrets`
- Non-main containers never receive the token

## Invariants
- All existing secrets (CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY) remain unchanged
- The stdin secret injection mechanism is unchanged
- Non-main groups must NOT receive GITHUB_TOKEN
- The token is never written to disk or passed as an env var

## Must-keep
- The full readSecrets → stdin → delete pattern
- The `readEnvFile` call with all existing keys
- The `delete input.secrets` cleanup after stdin write
