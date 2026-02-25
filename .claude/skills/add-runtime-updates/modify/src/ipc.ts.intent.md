# Intent: src/ipc.ts modifications

## What changed
Added runtime_update IPC handler with input validation and approval message dispatch.

## Key sections

### Import block
- Added `createRuntimeUpdate` to the import from `./db.js`

### processTaskIpc data parameter type
- Added `action?: string`, `params?: string`, `reason?: string` fields for runtime_update payloads

### New case: `runtime_update` (before `default:`)
- Validates action against allowlist: git_pull, apply_skill, update_config, rebuild_container
- Validates apply_skill params: requires `.claude/skills/` prefix, rejects path traversal (`..`)
- Validates update_config params: requires key/value, key must match `^[A-Z][A-Z0-9_]*$`
- Looks up chat JID from source group folder to send approval message
- Calls createRuntimeUpdate (blocked if group already has pending request)
- Sends formatted approval prompt to the group chat with approve/deny instructions

## Invariants
- All existing IPC handlers unchanged (schedule_task, pause_task, resume_task, cancel_task, refresh_groups, register_group)
- The IpcDeps interface unchanged
- The startIpcWatcher function unchanged
- All authorization patterns for existing handlers preserved

## Must-keep
- All existing case handlers in the switch statement
- The source group identity verification pattern
- The isMain authorization checks on existing handlers
- The IPC file processing loop in startIpcWatcher
