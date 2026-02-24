# Intent: src/index.ts modifications

## What changed
Added HTTP/SSE channel registration and switched WhatsApp guard to use config constant.

## Key sections

### Imports (top of file)
- Added: `HTTP_CHANNEL_ENABLED`, `HTTP_PORT`, `WHATSAPP_ENABLED` to the `./config.js` import

### main() — WhatsApp guard
- Changed: `process.env.WHATSAPP_ENABLED !== 'false'` → `WHATSAPP_ENABLED` (uses config constant from readEnvFile)
- Changed: simplified disabled log message

### main() — HTTP channel block (after ntfy.sh block)
- Added: conditional block guarded by `HTTP_CHANNEL_ENABLED`
- Dynamic import of `HttpChannel` from `./channels/http.js` (keeps it lazy like WhatsApp)
- Creates `HttpChannel` with `port: HTTP_PORT`, shared `channelOpts`, `enqueueCheck`, `registerGroup`
- Pushes to `channels` array and connects

### processGroupMessages() — streaming output callback
- Added: tool event routing — `result.eventType === 'tool'` calls `channel.sendProgress?.()`
- Added: result event routing — `result.eventType === 'result'` calls `channel.sendResult?.()`
- Changed: text output still uses `channel.sendMessage()` (unchanged for WhatsApp)
- Both sendProgress and sendResult use optional chaining (no-op on channels that don't implement them)

## Invariants
- All existing message processing logic is preserved
- The `runAgent` function is completely unchanged
- State management (loadState/saveState) is unchanged
- Recovery logic is unchanged
- Container runtime check is unchanged
- All other channel registrations (WhatsApp, Warren, ntfy) are unchanged

## Must-keep
- The `escapeXml` and `formatMessages` re-exports
- The `_setRegisteredGroups` test helper
- The `isDirectRun` guard at bottom
- All error handling and cursor rollback logic in processGroupMessages
- The shared `channelOpts` object pattern
