# Intent: src/container-runner.ts modifications

## What changed
Added targeted env var passthrough for keys registered by `update_config` runtime updates. Only explicitly opted-in keys are forwarded — no blanket passthrough that could leak secrets.

### buildContainerArgs function
- Added passthrough block after TZ env var, before the user/gid logic:
  ```typescript
  const passthroughPath = path.join(DATA_DIR, 'container-env-passthrough.json');
  try {
    const keys: string[] = JSON.parse(fs.readFileSync(passthroughPath, 'utf-8'));
    const values = readEnvFile(keys);
    for (const [key, value] of Object.entries(values)) {
      args.push('-e', `${key}=${value}`);
    }
  } catch { /* no passthrough file yet */ }
  ```
- Reads `data/container-env-passthrough.json` (written by update_config in runtime-update-executor.ts)
- Uses existing `readEnvFile()` to fetch only the registered keys from `.env`
- Silently no-ops if the passthrough file doesn't exist yet

## Invariants
- All existing env var passes unchanged (TZ, NTFY_TOPIC if present, HOME)
- readSecrets() unchanged — secrets still go via stdin only
- All volume mount logic unchanged
- All other functions unchanged

## Must-keep
- The secrets mechanism (readSecrets/stdin) — secrets NEVER go as -e env vars
- The TZ env var pass
- Existing skill-added env var conditionals (NTFY_TOPIC, ALPACA_*, etc.)
- The full buildContainerArgs function structure
