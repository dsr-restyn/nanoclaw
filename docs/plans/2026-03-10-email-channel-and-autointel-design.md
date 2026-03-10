# Email Channel & autoIntel Platform — Design

## Overview

Two skills that together enable a multi-tenant competitive intelligence SaaS product built on NanoClaw.

- **`add-email-channel`** — Two-way Gmail channel for NanoClaw. Routes inbound emails to groups by sender address, sends outbound with role-aware recipients and threading.
- **`add-autointel`** — Provisions CI clients as NanoClaw tenants. Mounts shared autoIntel context, creates client groups, deploys via docker-compose with DooD.

## Skill 1: add-email-channel

### What It Is

A NanoClaw channel (implementing the `Channel` interface) that uses a single Gmail inbox as a two-way message transport. The orchestrator polls for new emails, routes them to the correct group based on sender address, and sends agent responses back as threaded email replies.

### Architecture

```
Inbound:  Gmail API (poll) → match sender → groups/*/client/config.yaml → onMessage(jid, msg)
Outbound: agent result → channel.sendMessage(jid, text) → Gmail API (send, threaded, role-aware)
```

### JID Format

`email:{group-folder}` (e.g., `email:achosa`)

### Inbound Flow

1. Poll Gmail inbox every `EMAIL_POLL_INTERVAL` seconds (default: 60)
2. Fetch unread messages (use Gmail label or read status to track)
3. For each email, extract sender address
4. Look up sender in routing table (built from `groups/*/client/config.yaml` contacts)
5. If match found: deliver via `onMessage(jid, msg)` with email body as content
6. Mark email as read to avoid reprocessing
7. If no match: log and ignore

### Outbound Flow

1. Agent composes response (formatted using autoIntel templates or plain text)
2. `sendMessage(jid, text)` called by orchestrator
3. Channel reads `groups/{folder}/client/config.yaml` for recipient info
4. Sends to `primary` contacts, CCs `cc` contacts
5. Threads correctly using stored `threadId` / `In-Reply-To` / `References` headers

### Routing Table

Built by scanning `groups/*/client/config.yaml` on each poll cycle (local disk reads, negligible cost). Structure:

```
sender_email → { groupFolder, jid, contacts[] }
```

Refreshed every poll so new clients are picked up without restart.

### Config Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EMAIL_ENABLED` | `false` | Enable email channel |
| `EMAIL_POLL_INTERVAL` | `60` | Seconds between inbox checks |
| `EMAIL_INBOX_ADDRESS` | (required) | Gmail address to poll (display/logging) |

### Gmail Auth

Reuses existing OAuth credentials at `~/.gmail-mcp/`:
- `gcp-oauth.keys.json` — OAuth client ID/secret
- `credentials.json` — OAuth token (auto-refreshed)

### Dependencies

- `googleapis` npm package (direct Gmail API access)
- No gmail-mcp dependency (orchestrator handles transport directly)

### Threading

Per-group in-memory map:
```
groupFolder → { lastThreadId, lastMessageId }
```

When sending a reply, set `In-Reply-To` and `References` headers from the inbound email. When sending a scheduled report (no inbound to reply to), start a new thread.

### What It Does NOT Do

- No HTML rendering — markdown text (V1)
- No attachments — text only (V1)
- No multi-inbox — single Gmail account
- No agent-side Gmail access — orchestrator handles all transport

### Skill Package

```
.claude/skills/add-email-channel/
  manifest.yaml
  SKILL.md
  add/
    src/channels/email.ts          # Channel implementation
    src/channels/email.test.ts     # Tests
  modify/
    src/channels/index.ts          # Add import './email.js'
    src/channels/index.ts.intent.md
    src/config.ts                  # Add EMAIL_* config vars
    src/config.ts.intent.md
```

### Self-Registration

```typescript
registerChannel('email', (opts: ChannelOpts) => {
  const env = readEnvFile(['EMAIL_ENABLED', 'EMAIL_INBOX_ADDRESS']);
  const enabled = (process.env.EMAIL_ENABLED || env.EMAIL_ENABLED) === 'true';
  if (!enabled) return null;
  // Check for Gmail credentials
  const credPath = path.join(os.homedir(), '.gmail-mcp', 'credentials.json');
  if (!fs.existsSync(credPath)) {
    logger.warn('Email: Gmail credentials not found at ~/.gmail-mcp/');
    return null;
  }
  return new EmailChannel(opts);
});
```

---

## Skill 2: add-autointel

### What It Is

Provisions the autoIntel competitive intelligence product on NanoClaw. Handles: mounting the shared autoIntel context repo into agent containers, creating new client groups, and deploying via docker-compose with DooD.

### Client Provisioning

Each client becomes a NanoClaw group:

```
groups/{client-slug}/
  client/
    config.yaml        # Per-client settings (company, competitors, contacts, cadence, budget)
    history/           # Agent writes reports and follow-ups here
```

The autoIntel repo is mounted read-only as a sibling:

```
container mount layout:
  /workspace/group/           # groups/{client-slug}/ (read-write)
  /workspace/extra/autoIntel/ # autoIntel repo (read-only)
```

Using NanoClaw's existing `additionalMounts` in `containerConfig` or a dedicated mount in container-runner.

### Provisioning Flow

Script or IPC action to create a new client:

1. Create group folder: `groups/{slug}/client/config.yaml` from schema
2. Create history dir: `groups/{slug}/client/history/`
3. Register group in DB: `email:{slug}` JID, `requiresTrigger: false`
4. Create scheduled task per `report_cadence` from config
5. Group's CLAUDE.md references autoIntel: agent reads `../autoIntel/CLAUDE.md` via additional directories

### autoIntel Mount

Add to container-runner's `buildVolumeMounts`:

```typescript
// Mount autoIntel context repo (shared, read-only)
const autoIntelPath = process.env.AUTOINTEL_PATH || path.join(projectRoot, '..', 'autoIntel');
if (fs.existsSync(autoIntelPath)) {
  mounts.push({
    hostPath: autoIntelPath,
    containerPath: '/workspace/extra/autoIntel',
    readonly: true,
  });
}
```

The SDK's `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` setting (already enabled in container-runner) will pick up `/workspace/extra/autoIntel/CLAUDE.md` automatically.

### Docker Compose (DooD)

```yaml
version: '3.8'
services:
  nanoclaw:
    build: .
    restart: unless-stopped
    volumes:
      # DooD: host Docker socket for spawning agent containers
      - /var/run/docker.sock:/var/run/docker.sock
      # Persistent state
      - ./store:/app/store
      - ./groups:/app/groups
      - ./data:/app/data
      - ./logs:/app/logs
      # Credentials (host paths)
      - ~/.gmail-mcp:/home/node/.gmail-mcp
      - ~/.claude/.credentials.json:/home/node/.claude/.credentials.json:ro
      # Shared context repos
      - ../autoIntel:/app/autoIntel:ro
    env_file: .env
    environment:
      - AUTOINTEL_PATH=/app/autoIntel
      - EMAIL_ENABLED=true
    ports:
      - "4080:4080"  # HTTP channel (if enabled)
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### Config Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTOINTEL_PATH` | `../autoIntel` | Path to autoIntel context repo |

### Skill Package

```
.claude/skills/add-autointel/
  manifest.yaml
  SKILL.md
  add/
    docker-compose.autointel.yaml  # Compose overlay
    scripts/provision-client.ts    # Client creation script
  modify/
    src/container-runner.ts        # Add autoIntel mount
    src/container-runner.ts.intent.md
```

---

## Interaction Between Skills

```
add-email-channel (transport)     add-autointel (product)
─────────────────────────         ─────────────────────────
Gmail polling                     autoIntel repo mount
Sender → group routing            Client provisioning
Threaded sending                  Docker compose deploy
Role-aware recipients             Scheduled report tasks
config.yaml contact scanning      config.yaml creation
```

The email channel reads `config.yaml` for routing but doesn't create it. autoIntel creates configs but doesn't send emails. Clean boundary.

## Success Criteria

1. New client provisioned with a single command/script
2. Client receives weekly CI report via email on schedule
3. Client replies are routed to their specific agent container
4. Agent responds using autoIntel templates, threaded in same email chain
5. Multiple clients share one Gmail inbox with correct isolation
6. Deployed via `docker-compose up` with DooD
7. Unknown senders are ignored (no cross-tenant leakage)
