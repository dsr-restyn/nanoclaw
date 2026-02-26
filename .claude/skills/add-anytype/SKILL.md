---
name: add-anytype
description: Add Anytype knowledge management integration. Agents can search, create, and organize objects via MCP. Reads ANYTYPE_API_KEY from .env. Requires Anytype CLI running as a headless server on the host.
---

# Add Anytype Knowledge Management

Gives all agents structured access to Anytype via the official MCP server.
Requires the Anytype CLI headless server running on the host.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `anytype` is in `applied_skills`, skip to Phase 3.

### Verify build

```bash
npm run build
```

Fix any errors before continuing.

## Phase 2: Apply Code Changes

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-anytype
```

This deterministically:
- Three-way merges `ANYTYPE_API_KEY` config into `src/config.ts`
- Three-way merges `--add-host` flag and env passthrough into `src/container-runner.ts`
- Adds `container/skills/anytype/SKILL.md` (agent-facing docs)
- Appends `ANYTYPE_API_KEY` to `.env.example`

If the apply reports merge conflicts, read the intent files:
- `modify/src/config.ts.intent.md` — ANYTYPE_API_KEY config export
- `modify/src/container-runner.ts.intent.md` — Docker host bridge and env passthrough

### Add Anytype MCP to Agent Runner

Read `container/agent-runner/src/index.ts` and find the `mcpServers` config in the `query()` call.

Add `anytype` to the `mcpServers` object:

```typescript
anytype: {
  command: 'npx',
  args: ['-y', '@anyproto/anytype-mcp'],
  env: {
    ANYTYPE_API_BASE_URL: 'http://host.docker.internal:31012',
    OPENAPI_MCP_HEADERS: JSON.stringify({
      Authorization: `Bearer ${process.env.ANYTYPE_API_KEY}`,
      'Anytype-Version': '2025-11-08',
    }),
  },
},
```

Find the `allowedTools` array and add:

```typescript
'mcp__anytype__*'
```

### Validate

```bash
npm run build
```

Build must be clean before proceeding.

## Phase 3: Configure

### Install Anytype CLI

```bash
/usr/bin/env bash -c "$(curl -fsSL https://raw.githubusercontent.com/anyproto/anytype-cli/HEAD/install.sh)"
```

Verify installation:

```bash
anytype --version
```

### Create Bot Account and API Key

```bash
# Create a dedicated bot account for NanoClaw
anytype auth create nanoclaw-bot

# Generate an API key
anytype auth apikey create nanoclaw
```

Save the output API key.

### Configure Anytype Service

The headless server must bind to the Docker bridge IP so containers can reach it:

```bash
anytype serve --listen-address 172.17.0.1:31012
```

Install as a systemd service for persistence. Create `~/.config/systemd/user/anytype.service`:

```ini
[Unit]
Description=Anytype Headless Server
After=network.target

[Service]
Type=simple
ExecStart=%h/.anytype/bin/anytype serve --listen-address 172.17.0.1:31012
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable --now anytype
```

Verify it's running:

```bash
systemctl --user status anytype
curl -s http://172.17.0.1:31012/ || echo "Server responding"
```

### Share Spaces with Bot

Tell the user:

> The bot account only sees spaces you explicitly share with it.
> Open Anytype on your phone or desktop, go to the space you want
> the agent to access, and invite the bot account as a member.
>
> You can revoke access anytime from the space settings.

### Add API Key to .env

```bash
ANYTYPE_API_KEY=your-api-key-here
```

### Rebuild and Restart

```bash
cd container && ./build.sh && cd ..
npm run build
systemctl --user restart nanoclaw    # Linux
# or: launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
```

## Phase 4: Done

Tell the user:

> Anytype integration enabled. All agents can now search, create, and
> organize objects in your shared Anytype spaces.
>
> Test it: ask your assistant to "search my Anytype for recent notes"
> or "create a new page in Anytype about today's meeting".
>
> Remember: the bot only sees spaces you've shared with it.
> Share more spaces from the Anytype app as needed.
