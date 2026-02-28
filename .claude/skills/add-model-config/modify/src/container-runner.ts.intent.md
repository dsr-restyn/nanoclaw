# Intent: src/container-runner.ts modifications

## What changed
Added CLAUDE_MODEL env var forwarding so containers use the configured model.

## Key sections

### buildContainerArgs function — CLAUDE_MODEL passthrough
- Added conditional block after the `TZ` timezone env push
- If `process.env.CLAUDE_MODEL` is set, passes it as a container env var
- The Claude Agent SDK reads this automatically from the environment

## Invariants
- All existing container args remain unchanged
- CLAUDE_MODEL is only passed when set (no empty env var)
- The env var is passed via `-e` flag (public, not a secret)

## Must-keep
- All existing `-e` env var passes (TZ, runtime passthrough, ANYTYPE_API_KEY)
- The buildContainerArgs function structure
