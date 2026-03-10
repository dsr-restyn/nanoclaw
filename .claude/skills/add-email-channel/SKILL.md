# Add Email Channel

Two-way Gmail channel for NanoClaw. Polls an inbox, routes inbound emails to groups by sender address, and sends threaded replies with role-aware recipients (primary → To, cc → Cc).

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `email-channel` is in `applied_skills`, skip to Phase 3 (Setup).

### Prerequisites

- Gmail account with API access (Google Workspace or personal)
- OAuth credentials at `~/.gmail-mcp/`:
  - `gcp-oauth.keys.json` — OAuth client ID/secret
  - `credentials.json` — OAuth tokens (auto-refreshed)

If credentials don't exist, set them up:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or use existing)
3. Enable Gmail API
4. Create OAuth 2.0 credentials (Desktop app type)
5. Download as `gcp-oauth.keys.json` to `~/.gmail-mcp/`
6. Run initial auth to generate `credentials.json` (the channel auto-refreshes tokens after that)

## Phase 2: Apply Code Changes

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-email-channel
```

This:
- Adds `src/channels/email.ts` (EmailChannel class)
- Adds `src/channels/email.test.ts` (37 tests)
- Three-way merges email import into `src/channels/index.ts`
- Three-way merges EMAIL_* config into `src/config.ts`
- Installs `googleapis` npm dependency
- Updates `.env.example`

If merge conflicts occur, read the intent files:
- `modify/src/channels/index.ts.intent.md`
- `modify/src/config.ts.intent.md`

### Validate

```bash
npm test
npm run build
```

## Phase 3: Setup

### Configure environment

Add to `.env`:

```bash
EMAIL_ENABLED=true
EMAIL_POLL_INTERVAL=60
EMAIL_INBOX_ADDRESS=your-inbox@gmail.com
```

Sync to container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

### Build and restart

```bash
npm run build
systemctl --user restart nanoclaw   # Linux
# launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
```

## Phase 4: Registration

Each client group needs:
1. A `groups/{slug}/client/config.yaml` with contacts
2. A registered group with `email:{slug}` JID

### Create client config

```yaml
# groups/achosa/client/config.yaml
contacts:
  - email: stephen@example.com
    role: primary
  - email: ben@example.com
    role: cc
```

### Register the group

```bash
npx tsx -e "
import { initDatabase, setRegisteredGroup } from './dist/db.js';
initDatabase();
setRegisteredGroup('email:achosa', {
  name: 'Achosa',
  folder: 'achosa',
  trigger: '@claw',
  added_at: new Date().toISOString(),
  requiresTrigger: false,
});
"
```

## Phase 5: Verify

Send an email from a registered contact to the inbox. Check logs:

```bash
tail -f logs/nanoclaw.log | grep -i email
```

Expected: "Email delivered to group" log entry, followed by agent processing and a threaded reply.

## How It Works

- **Inbound:** Polls Gmail every `EMAIL_POLL_INTERVAL` seconds for unread messages. Matches sender against `groups/*/client/config.yaml` contacts. Routes to matching group via `onMessage()`. Marks as read.
- **Outbound:** Reads contacts from group config. Sends to `primary` contacts, CCs `cc` contacts. Threads using stored `In-Reply-To`/`References` headers.
- **Routing:** Rebuilt every poll cycle from disk. New clients are picked up without restart.
- **Unknown senders:** Ignored (marked as read, not routed).

## Troubleshooting

### No emails being received

1. Check `EMAIL_ENABLED=true` in `.env`
2. Check Gmail credentials exist: `ls ~/.gmail-mcp/`
3. Check logs for "Email channel connected"
4. Verify sender is in a group's `config.yaml` contacts

### Auth errors

Gmail OAuth tokens auto-refresh. If they expire completely:
1. Delete `~/.gmail-mcp/credentials.json`
2. Re-run initial OAuth flow
3. Restart NanoClaw
