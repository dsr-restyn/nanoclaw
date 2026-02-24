---
name: add-http-channel
description: Add HTTP/SSE channel to NanoClaw. Provides REST API for web clients to create groups, send messages, and stream responses via Server-Sent Events.
---

# Add HTTP/SSE Channel

This skill adds a generic HTTP/SSE interface to NanoClaw using the skills engine for deterministic code changes.

Any web client can create groups, send messages, and stream agent responses.
Auth via Bearer tokens (SHA-256 hashed). JID format: `http:{uuid}`

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `http-channel` is in `applied_skills`, skip to Phase 3 (Done). The code changes are already in place.

### Verify build

```bash
npm run build
```

Fix any errors before continuing.

## Phase 2: Apply Code Changes

### Initialize skills system (if needed)

If `.nanoclaw/` directory doesn't exist yet:

```bash
npx tsx scripts/apply-skill.ts --init
```

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-http-channel
```

This deterministically:
- Adds `src/channels/http.ts` (HttpChannel class implementing Channel interface)
- Three-way merges token auth into `src/db.ts` (http_device_tokens table, CRUD functions)
- Three-way merges channel config into `src/config.ts` (HTTP_CHANNEL_ENABLED, HTTP_PORT, WHATSAPP_ENABLED)
- Three-way merges HTTP channel registration into `src/index.ts`
- Installs `fastify` and `@fastify/cors` npm dependencies
- Updates `.env.example` with `HTTP_CHANNEL_ENABLED`, `HTTP_PORT`, `WHATSAPP_ENABLED`
- Records the application in `.nanoclaw/state.yaml`

If the apply reports merge conflicts, read the intent files:
- `modify/src/db.ts.intent.md` — token table and functions
- `modify/src/config.ts.intent.md` — channel config exports
- `modify/src/index.ts.intent.md` — channel registration

### Validate

```bash
npm run build
```

Build must be clean before proceeding.

## Phase 3: Create Device Token

Create an initial device token so the user can authenticate:

```bash
npx tsx scripts/create-token.ts my-device
```

Show the user the printed token and remind them to save it — it cannot be retrieved later.

## Phase 4: Done

Tell the user:

> HTTP channel installed. Add these to your `.env`:
>
> ```
> HTTP_CHANNEL_ENABLED=true
> HTTP_PORT=4080
> WHATSAPP_ENABLED=false    # optional — set to false for HTTP-only deploys
> ```
>
> **Create more tokens anytime:**
> ```bash
> npx tsx scripts/create-token.ts <label>
> ```
>
> **Test:**
> ```bash
> curl http://localhost:4080/health
> curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:4080/groups
> ```

## Troubleshooting

**Port already in use:** Change `HTTP_PORT` to a different port.

**Token not working:** Tokens are SHA-256 hashed. The plaintext is only shown once
at creation. Create a new one if lost.

**No response from agent:** Check that the group is registered and NanoClaw's
container runner is working. Look at NanoClaw logs for errors.
