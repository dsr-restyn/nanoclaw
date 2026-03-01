---
name: add-autonomy
description: Teach the main agent about autonomous work capabilities — propose_work, request_resource, and request_host_access IPC actions with approval flow.
---

# Add Autonomy

Adds an "Autonomous Work" section to the main group's CLAUDE.md so the agent knows how to propose work, request resources, and request container host access via the IPC system.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `autonomy` is in `applied_skills`, skip — already applied.

### Verify build

```bash
npm run build
```

Fix any errors before continuing.

## Phase 2: Apply Code Changes

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-autonomy
```

This three-way merges the new "Autonomous Work" section into `groups/main/CLAUDE.md`. All existing sections are preserved.

If the apply reports merge conflicts, read the intent file:
- `modify/groups/main/CLAUDE.md.intent.md` — what the Autonomous Work section adds

### Validate

```bash
npm run build
```

## Phase 3: Done

Restart NanoClaw. The main agent will now know how to:
- Propose work with pipeline DOT graphs (`propose_work`)
- Request API keys and services (`request_resource`)
- Request container network access (`request_host_access`)
- Update environment configuration (`update_config`)

Test by asking the agent: "What autonomous capabilities do you have?"
