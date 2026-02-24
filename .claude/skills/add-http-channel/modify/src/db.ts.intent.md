# Intent: src/db.ts modifications

## What changed
Added HTTP device token management for the HTTP/SSE channel's Bearer token auth.

## Key sections

### Imports (top of file)
- Added: `import { createHash, randomBytes } from 'crypto'` for token generation and hashing

### createSchema()
- Added: `http_device_tokens` table with columns `token_hash` (PK), `label`, `created_at`
- Tokens are stored as SHA-256 hashes — raw tokens are only returned at creation time

### New functions (after getAllRegisteredGroups, before JSON migration)
- `createHttpToken(label?)` — generates random 32-byte hex token, stores SHA-256 hash, returns raw token
- `validateHttpToken(token)` — hashes input and checks existence in DB
- `revokeHttpToken(token)` — hashes input and deletes matching row
- `listHttpTokens()` — returns all token metadata (hash, label, created_at)
- `getHttpGroupMessages(jid, since, limit)` — message history for HTTP groups with optional since-timestamp filtering

## Invariants
- All existing tables, queries, and functions are preserved
- Existing schema migrations (ALTER TABLE blocks) are unchanged
- The JSON migration section is unchanged
- No existing function signatures are modified

## Must-keep
- All existing table schemas and indexes
- The `storeMessageDirect` function (used by HTTP channel to write messages)
- All task, session, and registered group accessors
- The migration logic in `migrateJsonState`
