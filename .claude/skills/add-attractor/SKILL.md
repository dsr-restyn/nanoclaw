---
name: add-attractor
description: Add Attractor pipeline workflow skill. Agents can run multi-step DAG-based workflows using DOT syntax for features, bug fixes, refactoring, and code review.
---

# Add Attractor Pipeline Workflows

Gives agents DAG-based pipeline workflows for multi-step tasks.
No host-side changes — adds agent-facing docs and workflow templates only.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `attractor` is in `applied_skills`, skip to Phase 4.

### Verify build

```bash
npm run build
```

Fix any errors before continuing.

## Phase 2: Apply Code Changes

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-attractor
```

This adds:
- `container/skills/attractor/CLAUDE.md` (agent-facing docs)
- `container/skills/attractor/workflows/*.dot` (4 pre-built workflow templates)

No source files are modified. No merge conflicts possible.

### Validate

```bash
npm run build
```

Build must be clean before proceeding.

## Phase 3: Configure

No configuration needed. The skill is purely agent-facing — workflow templates and documentation are available inside containers automatically.

Optionally rebuild the container to pick up the new skill files:

```bash
./container/build.sh
```

## Phase 4: Done

Tell the user:

> Attractor pipeline workflows enabled. Agents can now use DOT-based
> workflow graphs for multi-step tasks like feature development, bug
> fixes, refactoring, and code review.
>
> Workflow templates are at `/home/node/.claude/skills/attractor/workflows/`
> inside the container. Agents install Bun and clone Attractor on first use.
