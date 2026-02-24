# Intent: src/index.ts modifications

## What changed
Added tool event routing in the processGroupMessages streaming callback.

**Note:** This template is based on the post-http-channel state (depends: http-channel).
It includes all HTTP channel changes (conditional channels, dynamic imports, etc.)
plus the tool event routing additions below.

## Key sections

### processGroupMessages() — streaming output callback
- Added: tool event routing — `result.eventType === 'tool'` calls `channel.sendProgress?.()`
- Added: result event routing — `result.eventType === 'result'` calls `channel.sendResult?.()`
- Changed: text output falls through to `channel.sendMessage()` when no eventType
- Both sendProgress and sendResult use optional chaining (no-op on channels that don't implement them)

## Invariants
- All HTTP channel changes from add-http-channel are preserved
- The `runAgent` function is completely unchanged
- State management (loadState/saveState) is unchanged
- Recovery logic is unchanged
- Container runtime check is unchanged
- The `main()` function matches add-http-channel (conditional channels, guard)
- Dynamic WhatsApp import (no static import)
- Channel lookup for syncGroupMetadata (no whatsapp variable)

## Must-keep
- The `escapeXml` and `formatMessages` re-exports
- The `_setRegisteredGroups` test helper
- The `isDirectRun` guard at bottom
- All error handling and cursor rollback logic in processGroupMessages
- The shared `channelOpts` object pattern
- The `channels.length === 0` fatal guard
