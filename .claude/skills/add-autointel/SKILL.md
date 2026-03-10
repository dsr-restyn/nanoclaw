# Add autoIntel

Provisions the autoIntel competitive intelligence product on NanoClaw. Mounts the shared autoIntel context repo into agent containers, provides a client provisioning script, and includes a docker-compose overlay for DooD deployment.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `autointel` is in `applied_skills`, skip to Phase 3 (Setup).

### Prerequisites

- `add-email-channel` skill must be applied first (email transport)
- autoIntel repo cloned alongside nanoclaw: `../autoIntel/` (or custom path)

## Phase 2: Apply Code Changes

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-autointel
```

This:
- Adds `docker-compose.autointel.yaml`
- Adds `scripts/provision-client.ts`
- Three-way merges `AUTOINTEL_PATH` config into `src/config.ts`
- Three-way merges autoIntel mount into `src/container-runner.ts`
- Updates `.env.example`

If merge conflicts occur, read the intent files:
- `modify/src/container-runner.ts.intent.md`
- `modify/src/config.ts.intent.md`

### Validate

```bash
npm run build
npm test
```

## Phase 3: Setup

### Configure environment

Add to `.env`:

```bash
AUTOINTEL_PATH=/path/to/autoIntel
```

For docker-compose deployment, use the container path:
```bash
AUTOINTEL_PATH=/app/autoIntel
```

### Provision a client

```bash
npx tsx scripts/provision-client.ts <slug> "<company-name>" <primary-email> [cc-email...]
```

Example:
```bash
npx tsx scripts/provision-client.ts achosa "Achosa Home Warranty" stephen@restyn.com ben@restyn.com
```

This creates:
- `groups/{slug}/client/config.yaml` — Edit to add competitors, industry, website
- `groups/{slug}/client/history/` — Agent writes reports here

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

### Create scheduled report task

Register a cron task for the report cadence defined in config.yaml.

## Phase 4: Docker Compose Deployment (DooD)

### Deploy

```bash
docker compose -f docker-compose.autointel.yaml up -d
```

This uses Docker-out-of-Docker (DooD): the orchestrator container spawns agent containers as siblings via the mounted Docker socket.

### Required host setup

1. autoIntel repo at `../autoIntel/` (relative to nanoclaw)
2. Gmail credentials at `~/.gmail-mcp/`
3. Claude credentials at `~/.claude/.credentials.json`
4. `.env` with all required variables

## Phase 5: Verify

### Check autoIntel mount

Run with debug logging:
```bash
LOG_LEVEL=debug npm run dev
```

Look for container mount logs showing `/workspace/group/autoIntel (ro)`.

### Check agent discovers autoIntel CLAUDE.md

The agent's `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` setting (already enabled) auto-discovers `/workspace/group/autoIntel/CLAUDE.md`. Check agent logs for autoIntel context being loaded.

### End-to-end test

1. Provision a test client
2. Send email from registered contact
3. Verify agent responds using autoIntel templates
4. Verify response is threaded and sent to correct recipients

## How It Works

- **Mount:** `AUTOINTEL_PATH` directory mounted read-only at `/workspace/group/autoIntel` in every agent container
- **Context:** Agent reads `CLAUDE.md` from autoIntel (research methodology, templates, guardrails)
- **Isolation:** Each client group has its own container, config, and history. autoIntel context is shared read-only.
- **DooD:** Orchestrator runs in container, spawns agent containers via Docker socket mounted from host
