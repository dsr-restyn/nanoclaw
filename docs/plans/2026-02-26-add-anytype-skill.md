# Add Anytype Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create an `/add-anytype` skill that gives NanoClaw agents access to Anytype's knowledge management API via the official MCP server.

**Architecture:** Anytype CLI runs as a systemd service on the host at `172.17.0.1:31012`. The official `@anyproto/anytype-mcp` MCP server runs inside containers (like Gmail). Containers reach the host via `--add-host=host.docker.internal:host-gateway`. API key passed as env var.

**Tech Stack:** Anytype CLI (Go binary), `@anyproto/anytype-mcp` (npm), Docker `--add-host` networking

---

## Task 1: Scaffold skill directory structure

**Files:**
- Create: `.claude/skills/add-anytype/manifest.yaml`
- Create: `.claude/skills/add-anytype/SKILL.md`
- Create: `.claude/skills/add-anytype/modify/src/config.ts`
- Create: `.claude/skills/add-anytype/modify/src/config.ts.intent.md`
- Create: `.claude/skills/add-anytype/modify/src/container-runner.ts`
- Create: `.claude/skills/add-anytype/modify/src/container-runner.ts.intent.md`
- Create: `.claude/skills/add-anytype/add/container/skills/anytype/SKILL.md`

**Step 1: Create manifest.yaml**

```yaml
skill: anytype
version: 1.0.0
description: "Anytype knowledge management — agents can search, create, and organize objects via MCP"
core_version: 0.1.0
adds:
  - container/skills/anytype/SKILL.md
modifies:
  - src/config.ts
  - src/container-runner.ts
structured:
  npm_dependencies: {}
  env_additions:
    - ANYTYPE_API_KEY
conflicts: []
depends: []
test: "npm run build"
```

**Step 2: Commit scaffold**

```bash
git add .claude/skills/add-anytype/manifest.yaml
git commit -m "feat(skills): scaffold add-anytype skill manifest"
```

---

## Task 2: Create config.ts snapshot

The snapshot is a full copy of `src/config.ts` with the Anytype additions merged in. The apply-skill.ts script performs a three-way merge against the base snapshot.

**Files:**
- Create: `.claude/skills/add-anytype/modify/src/config.ts`
- Create: `.claude/skills/add-anytype/modify/src/config.ts.intent.md`

**Step 1: Create the config.ts snapshot**

Copy the current `src/config.ts` and add these changes:

1. Add `'ANYTYPE_API_KEY'` to the `readEnvFile` call (after `'TELEGRAM_ONLY'`):

```typescript
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'HTTP_CHANNEL_ENABLED',
  'HTTP_PORT',
  'WHATSAPP_ENABLED',
  'VOICE_ENABLED',
  'VOICE_PORT',
  'NTFY_TOPIC',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ONLY',
  'ANYTYPE_API_KEY',
]);
```

2. Append at end of file:

```typescript
// Anytype knowledge management API key
export const ANYTYPE_API_KEY =
  process.env.ANYTYPE_API_KEY || envConfig.ANYTYPE_API_KEY || '';
```

**Step 2: Create the intent file** at `.claude/skills/add-anytype/modify/src/config.ts.intent.md`:

```markdown
# Intent: src/config.ts modifications

## What changed
Added ANYTYPE_API_KEY configuration for Anytype knowledge management integration.

## Key sections

### readEnvFile call
- Added key: `ANYTYPE_API_KEY` (after `TELEGRAM_ONLY`)

### New export (appended at end of file)
- `ANYTYPE_API_KEY` — string, API key for authenticating with the Anytype headless server, defaults to empty string (disabled when empty)

## Invariants
- All existing config exports remain unchanged
- New key is added to the `readEnvFile` call alongside existing keys
- Both `process.env` and `envConfig` are checked (same pattern as other config vars)

## Must-keep
- All existing exports
- The `readEnvFile` pattern — ALL config read from `.env` must go through this function
```

**Step 3: Commit**

```bash
git add .claude/skills/add-anytype/modify/src/config.ts .claude/skills/add-anytype/modify/src/config.ts.intent.md
git commit -m "feat(skills): add config.ts snapshot for add-anytype"
```

---

## Task 3: Create container-runner.ts snapshot

**Files:**
- Create: `.claude/skills/add-anytype/modify/src/container-runner.ts`
- Create: `.claude/skills/add-anytype/modify/src/container-runner.ts.intent.md`

**Step 1: Create the container-runner.ts snapshot**

Copy the current `src/container-runner.ts` and add these changes:

1. Add `ANYTYPE_API_KEY` to the config import:

```typescript
import {
  ANYTYPE_API_KEY,
  CONTAINER_IMAGE,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  TIMEZONE,
} from './config.js';
```

2. In `buildContainerArgs`, add `--add-host` flag right after the `['run', '-i', '--rm', '--name', containerName]` line:

```typescript
function buildContainerArgs(mounts: VolumeMount[], containerName: string): string[] {
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];

  // Allow containers to reach host services (e.g. Anytype headless server)
  args.push('--add-host=host.docker.internal:host-gateway');

  // Pass host timezone so container's local time matches the user's
  args.push('-e', `TZ=${TIMEZONE}`);
```

3. In `buildContainerArgs`, add Anytype API key passthrough after the env passthrough block and before the user/GID block:

```typescript
  } catch { /* no passthrough file yet */ }

  // Pass Anytype API key for MCP server authentication
  if (ANYTYPE_API_KEY) {
    args.push('-e', `ANYTYPE_API_KEY=${ANYTYPE_API_KEY}`);
  }

  // Run as host user so bind-mounted files are accessible.
```

**Step 2: Create the intent file** at `.claude/skills/add-anytype/modify/src/container-runner.ts.intent.md`:

```markdown
# Intent: src/container-runner.ts modifications

## What changed
Added Docker host networking bridge and Anytype API key passthrough so containers can reach the Anytype headless server.

## Key sections

### Import block
- Added `ANYTYPE_API_KEY` to the config import (alphabetical, first in list)

### buildContainerArgs function — `--add-host` flag
- Added `--add-host=host.docker.internal:host-gateway` immediately after the `run -i --rm --name` args
- This lets containers resolve `host.docker.internal` to the Docker host IP
- Required for any integration that talks to a host-local service (Anytype at 172.17.0.1:31012)
- Safe: only adds a /etc/hosts entry, does NOT change network isolation

### buildContainerArgs function — env var passthrough
- Added conditional block that passes `ANYTYPE_API_KEY` as container env var
- Only passed when the key is non-empty (skill not configured = no env var)
- Placed after the runtime-updates env passthrough block, before the user/GID block

## Invariants
- All existing container args remain unchanged
- `--add-host` is a no-op for containers that don't use it
- ANYTYPE_API_KEY is NOT a secret in the stdin sense — it's scoped to a bot account with limited space access
- The env var is only added when ANYTYPE_API_KEY is configured (non-empty)

## Must-keep
- All existing `-e` env var passes (TZ, runtime passthrough, HOME)
- The secrets mechanism (readSecrets/stdin) — Anytype key does NOT go through this
- The full buildContainerArgs function structure
- The `--add-host` flag must be before volume mounts (Docker arg ordering)
```

**Step 3: Commit**

```bash
git add .claude/skills/add-anytype/modify/src/container-runner.ts .claude/skills/add-anytype/modify/src/container-runner.ts.intent.md
git commit -m "feat(skills): add container-runner.ts snapshot for add-anytype"
```

---

## Task 4: Create agent-facing skill (container/skills/anytype/SKILL.md)

This is the documentation agents see inside the container — tells them what MCP tools are available and when to use them.

**Files:**
- Create: `.claude/skills/add-anytype/add/container/skills/anytype/SKILL.md`

**Step 1: Write the agent-facing skill**

```markdown
---
name: anytype
description: Search, create, and organize objects in the user's Anytype knowledge base. Use for structured notes, project tracking, knowledge management, and any data the user wants stored in Anytype.
---

# Anytype Knowledge Management

You have access to Anytype via MCP tools (`mcp__anytype__*`).

## Available Tools

### Search
- `mcp__anytype__search` — Global search across all spaces
- `mcp__anytype__search_objects` — Search objects within a specific space

### Spaces
- `mcp__anytype__list_spaces` — List all available spaces
- `mcp__anytype__get_space` — Get space details

### Objects
- `mcp__anytype__list_objects` — List objects in a space
- `mcp__anytype__get_object` — Get full object details
- `mcp__anytype__create_object` — Create a new object
- `mcp__anytype__update_object` — Update an existing object

### Organization
- `mcp__anytype__list_types` — List available object types in a space
- `mcp__anytype__list_templates` — List templates for a type
- `mcp__anytype__add_objects_to_list` — Add objects to a list/collection
- `mcp__anytype__list_members` — List space members

### Properties & Tags
- `mcp__anytype__list_properties` — List properties in a space
- `mcp__anytype__list_tags` — List tags for a property
- `mcp__anytype__create_tag` — Create a new tag

## Common Patterns

```
# Find something
Use mcp__anytype__search with a query string

# Create a note
1. mcp__anytype__list_spaces to find the right space
2. mcp__anytype__list_types to find the "Note" or "Page" type
3. mcp__anytype__create_object with the space ID and type ID

# Organize with tags
1. mcp__anytype__list_properties to find tag properties
2. mcp__anytype__create_tag or reference existing tags
3. mcp__anytype__update_object to apply tags
```

## When to Use Anytype

- User asks to save/store/remember something in Anytype
- Creating structured notes with types and properties
- Project or task tracking
- Knowledge base entries with relationships
- Anything the user explicitly asks to put in Anytype

## When NOT to Use Anytype

- Quick scratch notes (use workspace files in `/workspace/group/`)
- Sending messages to the user (use IPC)
- Data that belongs in Logseq (if user has both, ask which they prefer)
- Temporary data or intermediate computation results
```

**Step 2: Commit**

```bash
git add .claude/skills/add-anytype/add/container/skills/anytype/SKILL.md
git commit -m "feat(skills): add agent-facing Anytype skill docs"
```

---

## Task 5: Write the main SKILL.md (installer instructions)

This is what the agent follows when the user invokes `/add-anytype`.

**Files:**
- Create: `.claude/skills/add-anytype/SKILL.md`

**Step 1: Write SKILL.md**

```markdown
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
```

**Step 2: Commit**

```bash
git add .claude/skills/add-anytype/SKILL.md
git commit -m "feat(skills): add main SKILL.md for add-anytype"
```

---

## Task 6: Build and verify

**Step 1: Verify the skill structure is complete**

```bash
find .claude/skills/add-anytype -type f | sort
```

Expected output:
```
.claude/skills/add-anytype/SKILL.md
.claude/skills/add-anytype/add/container/skills/anytype/SKILL.md
.claude/skills/add-anytype/manifest.yaml
.claude/skills/add-anytype/modify/src/config.ts
.claude/skills/add-anytype/modify/src/config.ts.intent.md
.claude/skills/add-anytype/modify/src/container-runner.ts
.claude/skills/add-anytype/modify/src/container-runner.ts.intent.md
```

**Step 2: Verify build still passes**

```bash
npm run build
```

**Step 3: Final commit**

```bash
git add .claude/skills/add-anytype/
git commit -m "feat(skills): complete add-anytype skill for Anytype knowledge management"
```
