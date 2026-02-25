---
name: add-logseq
description: Add Logseq knowledge graph integration. Agents can read/write pages, journals, and notes. Reads graph path from LOGSEQ_GRAPH_PATH in .env.
---

# Add Logseq Knowledge Graph

Gives all agents read-write access to a Logseq graph via direct file mount.
No npm dependencies — agents use shell tools already in the container.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `logseq` is in `applied_skills`, skip to Phase 3.

### Verify build

```bash
npm run build
```

Fix any errors before continuing.

## Phase 2: Apply Code Changes

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-logseq
```

This deterministically:
- Three-way merges `LOGSEQ_GRAPH_PATH` config into `src/config.ts`
- Three-way merges Logseq volume mount into `src/container-runner.ts`
- Adds `container/skills/logseq/SKILL.md` (agent-facing docs)
- Appends `LOGSEQ_GRAPH_PATH` to `.env.example`

If the apply reports merge conflicts, read the intent files:
- `modify/src/config.ts.intent.md` — LOGSEQ_GRAPH_PATH config export
- `modify/src/container-runner.ts.intent.md` — Logseq volume mount

### Validate

```bash
npm run build
```

Build must be clean before proceeding.

## Phase 3: Configure

Add `LOGSEQ_GRAPH_PATH` to `.env`:

```bash
LOGSEQ_GRAPH_PATH=/path/to/your/logseq/graph
```

Then rebuild and restart:

```bash
npm run build
systemctl --user restart nanoclaw    # Linux
# or: launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
```

## Phase 4: Done

Tell the user:

> Logseq integration enabled. All agents can now read and write to your
> Logseq graph at `/workspace/logseq` inside the container.
>
> Test it: ask your assistant to "add a note to my Logseq journal about today's weather".
>
> Agents can search with `grep`, read with `cat`, and create new pages in `pages/`.
