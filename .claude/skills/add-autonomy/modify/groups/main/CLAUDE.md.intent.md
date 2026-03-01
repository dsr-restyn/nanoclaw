# Intent: groups/main/CLAUDE.md modifications

## What changed
Added an "Autonomous Work" section teaching the main agent how to propose work, request resources, and request container host access via the IPC system.

## Key sections

### Autonomous Work section
- Placed after "Scheduling for Other Groups" (before end of file)
- Documents the propose_work IPC action with pipeline DOT syntax
- Documents the request_resource IPC action for API keys and services
- Documents the request_host_access IPC action for container networking
- Explains the approval flow (user approves/denies via messaging)
- Includes guidelines on when to propose vs. just do

## Invariants
- All existing sections remain unchanged
- The admin context and group management sections are untouched
- The global memory and scheduling sections stay in their current positions

## Must-keep
- All existing group management documentation
- Container mounts table
- Scheduling for Other Groups section
