# Intent: src/index.ts modifications

## What changed
Added tool event routing in the processGroupMessages streaming callback.

## Key sections

### processGroupMessages() — streaming output callback
- Added: tool event routing — `result.eventType === 'tool'` calls `channel.sendProgress?.()`
- Added: result event routing — `result.eventType === 'result'` calls `channel.sendResult?.()`
- Changed: text output falls through to `channel.sendMessage()` when no eventType
- Both sendProgress and sendResult use optional chaining (no-op on channels that don't implement them)

## Invariants
- All existing message processing logic is preserved
- The `runAgent` function is completely unchanged
- State management (loadState/saveState) is unchanged
- Recovery logic is unchanged
- Container runtime check is unchanged
- The `main()` function is completely unchanged
- No import changes

## Must-keep
- The `escapeXml` and `formatMessages` re-exports
- The `_setRegisteredGroups` test helper
- The `isDirectRun` guard at bottom
- All error handling and cursor rollback logic in processGroupMessages
- The shared `channelOpts` object pattern
