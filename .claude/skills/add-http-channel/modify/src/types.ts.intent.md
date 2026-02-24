# Intent: src/types.ts modifications

## What changed
Added optional `sendProgress` and `sendResult` methods to the Channel interface.

## Key sections

### Channel interface
- Added: `sendProgress?(jid, tool, summary)` — for streaming tool use events to clients
- Added: `sendResult?(jid, summary)` — for final result events (distinct from intermediate text)

## Invariants
- All existing interfaces and types are unchanged
- Both new methods are optional (existing channels like WhatsApp don't need them)
- All existing Channel methods remain required/optional as before

## Must-keep
- All existing interfaces (AdditionalMount, MountAllowlist, etc.)
- All existing Channel methods
- OnInboundMessage and OnChatMetadata types
