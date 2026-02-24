# Intent: container/agent-runner/src/index.ts modifications

## What changed
Added tool use event streaming so the host process can relay tool progress to HTTP clients.

## Key sections

### ContainerOutput interface
- Added: `eventType?: 'text' | 'tool' | 'result'` — distinguishes event types
- Added: `tool?: string` — tool name (e.g. "Bash", "Read")
- Added: `toolSummary?: string` — truncated summary of tool input

### runQuery() — assistant message handler
- Added: detection of `tool_use` content blocks in assistant messages
- For each tool_use block, emits a `writeOutput()` with `eventType: 'tool'`
- Tool input is JSON-stringified and truncated to 200 chars for the summary

### runQuery() — result handler
- Added: `eventType: 'result'` to the writeOutput call for result messages

## Invariants
- All existing message handling logic is preserved
- The IPC polling loop is unchanged
- The query loop (main) is unchanged
- Session management is unchanged
- Hook registration is unchanged
- MessageStream class is unchanged

## Must-keep
- The OUTPUT_START_MARKER / OUTPUT_END_MARKER protocol
- The MessageStream async iterable pattern
- IPC polling during queries
- Pre-compact hook for conversation archiving
- Bash sanitization hook
- Session index reading
