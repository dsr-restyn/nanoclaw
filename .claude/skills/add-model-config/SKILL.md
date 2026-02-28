---
name: add-model-config
description: Configure which Claude model agent containers use via CLAUDE_MODEL env var. Set to any valid model ID (e.g. claude-opus-4-20250514, claude-sonnet-4-6-20250514).
---

# Add Model Configuration

Forwards the `CLAUDE_MODEL` environment variable into agent containers so the Claude Agent SDK uses the configured model instead of its default.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `model-config` is in `applied_skills`, skip to Phase 3.

### Verify build

```bash
npm run build
```

Fix any errors before continuing.

## Phase 2: Apply Code Changes

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-model-config
```

This deterministically:
- Three-way merges `CLAUDE_MODEL` env var forwarding into `buildContainerArgs()` in `src/container-runner.ts`
- Appends `CLAUDE_MODEL` to `.env.example`

If the apply reports merge conflicts, read the intent file:
- `modify/src/container-runner.ts.intent.md` — CLAUDE_MODEL passthrough

### Validate

```bash
npm run build
```

## Phase 3: Configure

### Set the model in .env

```bash
CLAUDE_MODEL=claude-opus-4-20250514
```

Use the full model ID. Common options:
- `claude-opus-4-20250514` — most capable
- `claude-sonnet-4-6-20250514` — fast and capable
- `claude-sonnet-4-20250514` — balanced

The SDK will fall back to its default if the ID is invalid, so double-check the spelling.

## Phase 4: Done

Restart NanoClaw. All agent containers will now use the configured model. Verify by asking an agent "What model are you?".
