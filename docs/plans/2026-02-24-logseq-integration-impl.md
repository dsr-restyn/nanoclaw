# Logseq Integration Skill — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a NanoClaw skill that mounts a Logseq graph into agent containers at `/workspace/logseq`.

**Architecture:** Single env var `LOGSEQ_GRAPH_PATH` read from `.env`. When non-empty, `buildVolumeMounts()` adds a read-write bind mount. Agent-facing skill doc teaches Logseq markdown format.

**Tech Stack:** NanoClaw skills engine (three-way merge), TypeScript, shell tools in container.

---

### Task 1: Create manifest.yaml

**Files:**
- Create: `.claude/skills/add-logseq/manifest.yaml`

**Step 1: Write the manifest**

```yaml
skill: logseq
version: 1.0.0
description: "Logseq knowledge graph — agents can read/write pages, journals, and notes"
core_version: 0.1.0
adds:
  - container/skills/logseq/SKILL.md
modifies:
  - src/config.ts
  - src/container-runner.ts
structured:
  npm_dependencies: {}
  env_additions:
    - LOGSEQ_GRAPH_PATH
conflicts: []
depends: []
test: "npm run build"
```

**Step 2: Verify file exists**

Run: `cat .claude/skills/add-logseq/manifest.yaml`

---

### Task 2: Create SKILL.md (user-facing install guide)

**Files:**
- Create: `.claude/skills/add-logseq/SKILL.md`

**Step 1: Write the skill guide**

Follow the 4-phase pattern from `add-ntfy/SKILL.md`:
- Phase 1: Pre-flight (check state.yaml, verify build)
- Phase 2: Apply code changes (`npx tsx scripts/apply-skill.ts .claude/skills/add-logseq`)
- Phase 3: Configure (set `LOGSEQ_GRAPH_PATH` in `.env`, rebuild, restart)
- Phase 4: Done (tell user how to verify)

---

### Task 3: Create agent-facing container skill doc

**Files:**
- Create: `.claude/skills/add-logseq/add/container/skills/logseq/SKILL.md`

**Step 1: Write the agent skill doc**

This teaches agents:
- Logseq is mounted at `/workspace/logseq`
- Directory structure: `pages/`, `journals/`, `logseq/` (config, read-only)
- Reading: `cat /workspace/logseq/pages/PageName.md`, `grep -rl "term" /workspace/logseq/`
- Writing: Always use `- ` bullet prefix, `key:: value` properties, `[[WikiLink]]` syntax
- Journal filenames: `YYYY_MM_DD.md` (underscores, not hyphens)
- Creating pages: one `.md` file per page in `pages/`
- When to use vs when not to use

---

### Task 4: Create modify/src/config.ts

**Files:**
- Create: `.claude/skills/add-logseq/modify/src/config.ts`
- Create: `.claude/skills/add-logseq/modify/src/config.ts.intent.md`

**Step 1: Write the modified config.ts**

Copy current `src/config.ts` (98 lines) and add two changes:
1. Add `'LOGSEQ_GRAPH_PATH'` to `readEnvFile()` array (after `'NTFY_TOPIC'`)
2. Add export at end of file:
```typescript
// Logseq knowledge graph
export const LOGSEQ_GRAPH_PATH =
  process.env.LOGSEQ_GRAPH_PATH || envConfig.LOGSEQ_GRAPH_PATH || '';
```

**Step 2: Write the intent doc**

Explain: added LOGSEQ_GRAPH_PATH to readEnvFile and exported it. Path to user's Logseq graph folder. Empty string when unconfigured (no-op).

---

### Task 5: Create modify/src/container-runner.ts

**Files:**
- Create: `.claude/skills/add-logseq/modify/src/container-runner.ts`
- Create: `.claude/skills/add-logseq/modify/src/container-runner.ts.intent.md`

**Step 1: Write the modified container-runner.ts**

Copy current `src/container-runner.ts` (659 lines) and add two changes:
1. Add `LOGSEQ_GRAPH_PATH` to the config import (line 9-18, alphabetical order)
2. In `buildVolumeMounts()`, add Logseq mount before the `additionalMounts` block (before line 172):
```typescript
  // Logseq knowledge graph (read-write for all groups)
  if (LOGSEQ_GRAPH_PATH) {
    mounts.push({
      hostPath: LOGSEQ_GRAPH_PATH,
      containerPath: '/workspace/logseq',
      readonly: false,
    });
  }
```

**Step 2: Write the intent doc**

Explain: added LOGSEQ_GRAPH_PATH import, added conditional volume mount in buildVolumeMounts(). Mount is read-write, placed before additionalMounts validation. Only added when path is non-empty.

---

### Task 6: Test skill engine

**Step 1: Run the skill engine**

Run: `npx tsx scripts/apply-skill.ts .claude/skills/add-logseq`
Expected: `{"success": true, "skill": "logseq", ...}`

**Step 2: Verify merged files**

Check `src/config.ts` contains `LOGSEQ_GRAPH_PATH` in readEnvFile and as export.
Check `src/container-runner.ts` imports `LOGSEQ_GRAPH_PATH` and has the mount block.
Check `container/skills/logseq/SKILL.md` exists.

**Step 3: Build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 4: Revert applied changes for clean commit**

The skill engine test modified working files. Revert them so the commit only contains the skill definition:
```bash
git checkout src/config.ts src/container-runner.ts
rm -rf container/skills/logseq/
```

Then update `.nanoclaw/state.yaml` to remove the logseq entry (or restore from git).

---

### Task 7: Commit

**Step 1: Stage skill files**

```bash
git add .claude/skills/add-logseq/
```

**Step 2: Commit**

```bash
git commit -m "feat(skills): add Logseq knowledge graph integration skill"
```
