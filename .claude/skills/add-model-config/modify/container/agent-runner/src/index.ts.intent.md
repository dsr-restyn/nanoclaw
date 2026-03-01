# Intent: container/agent-runner/src/index.ts modifications

## What changed
Added CLAUDE_MODEL env var reading so the SDK uses the configured model inside the container.

## Key sections

### runQuery function — model option
- Before the `query()` call, reads `process.env.CLAUDE_MODEL` (passed by the host via `-e` flag)
- Logs the model being used for debugging
- Passes `model` to the SDK's `query()` options

## Invariants
- All existing query options remain unchanged
- Model is only set when CLAUDE_MODEL env var is present (falls back to SDK default)
- The log line helps diagnose model configuration issues

## Must-keep
- All existing `query()` options (cwd, allowedTools, env, permissionMode, etc.)
- The MessageStream and IPC polling setup
- The globalClaudeMd system prompt logic
