# Intent: src/ipc-auth.test.ts modifications

## What changed
Added runtime_update authorization tests covering validation, queuing, rejection, and deduplication.

## Key sections

### Import block
- Added `getPendingRuntimeUpdate` to the existing `./db.js` import

### New describe block: `runtime_update IPC` (appended at end of file)
- `queues a valid git_pull request` — verifies pending row created, approval message sent with approve/deny instructions
- `rejects unknown action` — verifies `rm_rf` action is rejected, no pending row created
- `rejects apply_skill with path traversal` — verifies `../../etc/passwd` skill path is blocked
- `queues valid update_config request` — verifies update_config with valid key/value is accepted
- `blocks duplicate pending request from same group` — verifies second request while first is pending is rejected, first action preserved

## Invariants
- All existing test describe blocks unchanged (schedule_task, pause_task, resume_task, cancel_task, register_group, refresh_groups, IPC message, schedule types, context_mode)
- The beforeEach setup unchanged (test database, groups, deps)
- All existing test assertions unchanged

## Must-keep
- All existing describe blocks and their tests
- The MAIN_GROUP, OTHER_GROUP, THIRD_GROUP constants
- The beforeEach setup with _initTestDatabase and group registration
- The deps mock object structure
