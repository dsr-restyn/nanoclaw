# Intent: src/container-runner.ts modifications

## What changed
Added generic .env passthrough so container agents receive all non-secret environment variables. This ensures keys added via `update_config` runtime updates reach containers after restart.

### Import block
- Added `readAllEnvVars` to the import from `./env.js`
- Removed `NTFY_TOPIC` from the config import (now covered by generic passthrough)

### buildContainerArgs function
- Removed the explicit `NTFY_TOPIC` conditional block (redundant with generic passthrough)
- Added generic env var forwarding after the TZ env var:
  ```typescript
  const SECRET_KEYS = new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']);
  const alreadySet = new Set(['TZ']);
  for (const [key, value] of Object.entries(readAllEnvVars())) {
    if (!SECRET_KEYS.has(key) && !alreadySet.has(key)) {
      args.push('-e', `${key}=${value}`);
    }
  }
  ```
- SECRET_KEYS matches the keys in readSecrets() — these go via stdin, never as env vars
- alreadySet prevents double-setting TZ (already set explicitly from config)

## Invariants
- All existing volume mounts unchanged
- readSecrets() unchanged — secrets still go via stdin
- The user/gid logic unchanged
- All other functions (runContainerAgent, buildVolumeMounts, writeTasksSnapshot, writeGroupsSnapshot) unchanged

## Must-keep
- The TZ env var pass (before the generic passthrough)
- The secrets mechanism (readSecrets/stdin) — secrets do NOT go through env passthrough
- The full buildContainerArgs function structure
- All existing volume mount logic
