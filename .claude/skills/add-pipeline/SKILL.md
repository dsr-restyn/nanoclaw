---
name: add-pipeline
description: Add host-level pipeline orchestration foundation. Ports DOT parser types, tokens, duration, and label utilities from the Attractor upstream.
---

# Add Pipeline Orchestration Foundation

Adds the foundational type definitions and utility modules for host-level pipeline orchestration, ported from the Attractor upstream codebase.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `pipeline` is in `applied_skills`, skip to Phase 3.

### Verify build

```bash
npm run build
```

Fix any errors before continuing.

## Phase 2: Apply Code Changes

### Initialize skills system (if needed)

If `.nanoclaw/` directory doesn't exist yet:

```bash
npx tsx scripts/apply-skill.ts --init
```

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-pipeline
```

This adds:
- `src/pipeline/tokens.ts` — DOT lexer token kinds and Token interface
- `src/pipeline/types.ts` — Graph, Node, Edge, Subgraph types and attribute helpers
- `src/pipeline/duration.ts` — Duration string parsing (e.g., "30s", "5m", "2h")
- `src/pipeline/label.ts` — Label normalization, accelerator key parsing, class name derivation
- `src/pipeline/duration.test.ts` — Unit tests for duration utilities

No source files are modified. No merge conflicts possible.

### Validate

```bash
npx vitest run src/pipeline/duration.test.ts
npm run build
```

All tests must pass and build must be clean.

## Phase 3: Done

Tell the user:

> Pipeline foundation types and utilities are in place. The `src/pipeline/`
> module provides DOT parser tokens, graph types, duration parsing, and
> label utilities. Ready for the lexer, parser, and orchestrator in
> subsequent tasks.
