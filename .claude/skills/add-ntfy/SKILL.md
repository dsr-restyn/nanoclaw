---
name: add-ntfy
description: Add ntfy.sh push notifications. Agents can send alerts, reminders, and task completion notifications from any group. Reads topic from NTFY_TOPIC in .env.
---

# Add ntfy.sh Push Notifications

Gives all agents the ability to send push notifications via ntfy.sh.
No npm dependencies — uses `curl` which is already in the container.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `ntfy` is in `applied_skills`, skip to Phase 3.

### Verify build

```bash
npm run build
```

Fix any errors before continuing.

## Phase 2: Apply Code Changes

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-ntfy
```

This deterministically:
- Three-way merges `NTFY_TOPIC` config into `src/config.ts`
- Three-way merges env var passthrough into `src/container-runner.ts`
- Adds `container/skills/ntfy-notifications/SKILL.md` (agent-facing docs)
- Appends `NTFY_TOPIC` to `.env.example`

If the apply reports merge conflicts, read the intent files:
- `modify/src/config.ts.intent.md` — NTFY_TOPIC config export
- `modify/src/container-runner.ts.intent.md` — container env var passthrough

### Validate

```bash
npm run build
```

Build must be clean before proceeding.

## Phase 3: Configure

Add `NTFY_TOPIC` to `.env`:

```bash
NTFY_TOPIC=your-topic-name
```

Then rebuild and restart:

```bash
npm run build
systemctl --user restart nanoclaw    # Linux
# or: launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
```

Optionally add ntfy usage guidance to `groups/global/CLAUDE.md` so agents
know when to use notifications vs regular messages.

## Phase 4: Done

Tell the user:

> ntfy.sh notifications enabled. All agents can now send push notifications
> using `curl -d "message" ntfy.sh/$NTFY_TOPIC`.
>
> Test it: ask Andy to "send me a test push notification".
>
> Subscribe to your topic on your phone: https://ntfy.sh/your-topic-name
