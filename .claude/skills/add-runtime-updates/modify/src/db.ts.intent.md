# Intent: src/db.ts modifications

## What changed
Added runtime_updates table and CRUD functions for the runtime update approval workflow.

## Key sections

### Import block
- Added `RuntimeUpdate` to the import from `./types.js`

### createSchema function
- Added `runtime_updates` table after `voice_sessions` table with columns: id, group_folder, action, params, reason, status, result, created_at, resolved_at
- Added indexes: `idx_runtime_updates_status` and `idx_runtime_updates_group`

### New functions (appended after getVoiceStatus)
- `createRuntimeUpdate` — inserts a new pending request, returns null if group already has a pending request
- `getRuntimeUpdate` — fetch by id
- `getPendingRuntimeUpdate` — fetch pending request for a group folder
- `resolveRuntimeUpdate` — update status to approved/denied/expired/failed with result and timestamp
- `getExpiredRuntimeUpdates` — find pending requests older than maxAgeMs

## Invariants
- All existing tables remain unchanged (chats, messages, scheduled_tasks, task_run_logs, router_state, sessions, registered_groups, http_device_tokens, voice_sessions)
- All existing migrations remain unchanged (context_mode, is_bot_message, channel/is_group)
- All existing functions remain unchanged
- The migrateJsonState function is untouched

## Must-keep
- All existing CREATE TABLE statements exactly as-is
- All existing ALTER TABLE migrations in createSchema
- All existing exported functions (storeChatMetadata, storeMessage, getNewMessages, createTask, getRegisteredGroup, etc.)
- The VoiceSession interface and all voice session functions
- The HTTP token management functions
