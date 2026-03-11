# Intent: src/index.ts modifications

## What changed
Added email channel creation block using dynamic import pattern (same as WhatsApp).

## Key sections

### New import (config)
- Added: `EMAIL_ENABLED` to the config.js import

### New channel block (after WhatsApp creation)
- Added: `if (EMAIL_ENABLED)` block that dynamically imports `./channels/email.js`, creates `EmailChannel(channelOpts)`, pushes to `channels` array, and connects
- Follows same pattern as WhatsApp channel creation

## Invariants
- All existing code unchanged
- WhatsApp channel creation remains unconditional
- Email channel is gated by `EMAIL_ENABLED` config flag
- `channelOpts` is passed directly (EmailChannel uses onMessage and onChatMetadata from it)
