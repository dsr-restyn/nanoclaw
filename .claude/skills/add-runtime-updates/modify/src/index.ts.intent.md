# Intent: src/index.ts modifications

## What changed
Added approval command interception in message loop and runtime update expiry sweep in main().

## Key sections

### Import block
- Added `import { matchApprovalCommand, processApproval } from './runtime-update-executor.js'`
- Added `getExpiredRuntimeUpdates` and `resolveRuntimeUpdate` to the existing `./db.js` import

### startMessageLoop — approval command interception
- Added block inside `for (const [chatJid, groupMessages] of messagesByGroup)` loop
- Placed AFTER the trigger check and BEFORE the pipe/enqueue logic
- Iterates groupMessages looking for `approve <id>` or `deny <id>` commands
- Calls processApproval and sends result message back to channel
- If restart is needed (approved update), gracefully shuts down queue and channels then exits
- If any approval command found, `continue` skips agent processing for that group

### main() — expiry sweep
- Added `setInterval` after `startMessageLoop()` call
- Every 5 minutes, finds pending runtime updates older than 1 hour
- Marks them as expired via `resolveRuntimeUpdate`

## Invariants
- All existing message processing logic unchanged (trigger check, dedup, pipe/enqueue)
- State management (loadState, saveState, lastTimestamp, sessions, registeredGroups) unchanged
- Recovery logic (recoverPendingMessages) unchanged
- Channel setup and connection logic unchanged
- Graceful shutdown handlers unchanged
- All existing imports preserved

## Must-keep
- The entire processGroupMessages function
- The runAgent function
- The message dedup and trigger check logic in startMessageLoop
- The pipe/enqueue branching logic
- The recoverPendingMessages function
- All channel setup in main()
- The startSchedulerLoop and startIpcWatcher calls
- The isDirectRun guard
