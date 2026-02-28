---
name: add-attractor
description: Add Attractor pipeline workflow skill. Host-level orchestration of multi-step DAG-based workflows using DOT syntax. Agents compose workflow graphs and submit via IPC — no Bun or Attractor clone needed.
---

# Add Attractor Pipeline Workflows

Gives agents DAG-based pipeline workflows for multi-step tasks. The host orchestrates pipeline execution — agents just compose DOT graphs and submit them via IPC.

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
- `container/skills/attractor/CLAUDE.md` — DOT syntax reference and IPC request format for agents
- `container/skills/attractor/workflows/*.dot` — 4 pre-built workflow templates
- `src/pipeline/` — Host-level pipeline orchestration engine (parser, runner, orchestrator, conditions, edge selection, checkpoints, events)

And modifies:
- `src/ipc.ts` — Adds `start_pipeline` and `human_gate_response` IPC task handlers

### Validate

```bash
npm run build
```

Build must be clean before proceeding.

## Phase 3: Configure

No configuration needed. The pipeline engine runs on the host and processes `start_pipeline` IPC requests from agents.

Rebuild the container to pick up the new agent-facing skill files:

```bash
./container/build.sh
```

## Phase 4: Done

Tell the user:

> Attractor pipeline workflows enabled. The host now orchestrates
> multi-step DOT-based workflows. Agents compose pipeline graphs and
> submit them via IPC (`start_pipeline`). No Bun or Attractor clone
> needed inside containers.
>
> Pipeline source files are at `src/pipeline/`. Agent-facing DOT syntax
> reference is at `container/skills/attractor/CLAUDE.md`.
