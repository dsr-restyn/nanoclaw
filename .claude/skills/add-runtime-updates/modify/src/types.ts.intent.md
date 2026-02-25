# Intent: src/types.ts modifications

## What changed
Added RuntimeUpdate interface for tracking runtime update requests (git_pull, apply_skill, update_config, rebuild_container) with approval workflow status.

## Key sections

### New interface (after TaskRunLog)
- `RuntimeUpdate` — tracks id, group_folder, action, params, reason, status lifecycle, result, and timestamps

## Invariants
- All existing interfaces remain unchanged (AdditionalMount, MountAllowlist, AllowedRoot, ContainerConfig, RegisteredGroup, NewMessage, ScheduledTask, TaskRunLog, Channel, etc.)
- All existing type aliases remain unchanged (OnInboundMessage, OnChatMetadata)

## Must-keep
- All existing interfaces in their exact current form
- The Channel abstraction section and all callback types
