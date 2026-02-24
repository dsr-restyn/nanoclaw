# Intent: src/container-runner.ts modifications

## What changed
Extended ContainerOutput interface with tool event fields.

## Key sections

### ContainerOutput interface
- Added: `eventType?: 'text' | 'tool' | 'result'` — distinguishes tool events from text/result
- Added: `tool?: string` — name of the tool being used (e.g. "Bash", "Read")
- Added: `toolSummary?: string` — truncated summary of tool input

## Invariants
- All existing ContainerOutput fields are unchanged
- New fields are optional (backward compatible with existing agent runners)
- All other interfaces, functions, and logic are completely unchanged
- The streaming output parser already handles arbitrary JSON fields in ContainerOutput

## Must-keep
- ContainerInput interface
- All volume mount logic
- The OUTPUT_START_MARKER / OUTPUT_END_MARKER protocol
- The streaming stdout parser
- Timeout and kill logic
