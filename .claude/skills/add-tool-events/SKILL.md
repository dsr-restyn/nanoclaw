---
name: add-tool-events
description: Stream agent tool use events to channels. Shows "Agent is using Bash..." progress indicators. Requires container rebuild. Optional enhancement — channels work without it.
---

# Add Tool Event Streaming

Streams tool use events from the agent runner to channels so clients can show
progress indicators (e.g. "Agent is using Bash...").

This is an optional enhancement. All channels work without it — they just won't
show tool progress between text responses.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `tool-events` is in `applied_skills`, skip to Phase 3 (Done).

### Verify build

```bash
npm run build
```

Fix any errors before continuing.

## Phase 2: Apply Code Changes

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-tool-events
```

This deterministically:
- Three-way merges `sendProgress`/`sendResult` into Channel interface in `src/types.ts`
- Three-way merges `ContainerOutput` event fields into `src/container-runner.ts`
- Three-way merges tool event routing into `src/index.ts`
- Three-way merges tool event emission into `container/agent-runner/src/index.ts`

If the apply reports merge conflicts, read the intent files:
- `modify/src/types.ts.intent.md` — Channel interface extensions
- `modify/src/container-runner.ts.intent.md` — ContainerOutput event fields
- `modify/src/index.ts.intent.md` — tool event routing in orchestrator
- `modify/container/agent-runner/src/index.ts.intent.md` — tool event emission

### Rebuild container

The agent runner changes require a container rebuild:

```bash
./container/build.sh
```

### Validate

```bash
npm run build
```

Build must be clean before proceeding.

## Phase 3: Done

Tell the user:

> Tool event streaming installed. Channels that implement `sendProgress()` and
> `sendResult()` will now show agent tool use progress (e.g. "Using Bash...",
> "Using Read...").
>
> No configuration needed — it works automatically with any channel that
> supports progress events (like the HTTP channel).
