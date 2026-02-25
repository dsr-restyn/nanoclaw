# Runtime Updates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a NanoClaw skill (`add-runtime-updates`) that lets containerized agents propose runtime updates (git pull, skill apply, config changes, container rebuild) via IPC, with human approval via channel message and automatic service restart.

**Architecture:** New `runtime_update` IPC type → queued in SQLite → human approves/denies via channel reply → host executes whitelisted action → graceful exit for service manager restart. Packaged as a standard NanoClaw skill with `add/`, `modify/`, and `manifest.yaml`.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), vitest, existing IPC/channel infrastructure.

**Security note:** All subprocess calls MUST use `execFileSync` (no shell) instead of `execSync` to prevent command injection.

---

### Task 1: Scaffold the skill directory

**Files:**
- Create: `.claude/skills/add-runtime-updates/manifest.yaml`
- Create: `.claude/skills/add-runtime-updates/SKILL.md`

**Step 1: Create manifest.yaml**

```yaml
skill: runtime-updates
version: 1.0.0
description: "Agent-initiated runtime updates with human approval — git pull, skill apply, config changes, container rebuild"
core_version: 0.1.0
adds:
  - src/runtime-update-executor.ts
  - src/runtime-updates.test.ts
  - src/runtime-update-executor.test.ts
modifies:
  - src/types.ts
  - src/db.ts
  - src/ipc.ts
  - src/index.ts
  - src/ipc-auth.test.ts
structured:
  npm_dependencies: {}
  env_additions: []
conflicts: []
depends: []
test: "npx vitest run src/runtime-updates.test.ts src/runtime-update-executor.test.ts src/ipc-auth.test.ts"
```

**Step 2: Create SKILL.md**

Agent-facing docs explaining how to use `runtime_update` IPC. Write to `.claude/skills/add-runtime-updates/SKILL.md`:

```markdown
# Runtime Updates

Request changes to the NanoClaw runtime from inside a container.

## Usage

Write a JSON file to your IPC tasks directory:

### git_pull — update NanoClaw from upstream
```json
{"type": "runtime_update", "action": "git_pull", "reason": "upstream has new features"}
```

### apply_skill — apply a NanoClaw skill
```json
{"type": "runtime_update", "action": "apply_skill", "params": "{\"skill\": \".claude/skills/add-ntfy\"}", "reason": "enable notifications"}
```

### update_config — add a new .env key (append-only, no overwrites)
```json
{"type": "runtime_update", "action": "update_config", "params": "{\"key\": \"NOTION_API_KEY\", \"value\": \"sk-xxx\"}", "reason": "add Notion integration"}
```

### rebuild_container — rebuild the agent Docker image
```json
{"type": "runtime_update", "action": "rebuild_container", "reason": "new base image needed"}
```

## How it works

1. You write the request to your IPC tasks directory
2. The host sends an approval message to the human on your channel
3. Human replies `approve <id>` or `deny <id>`
4. On approval, the host executes the action and auto-restarts if needed
5. Pending requests expire after 1 hour

## Constraints

- One pending request per group at a time
- Skill paths must start with `.claude/skills/` (no path traversal)
- Config keys must be UPPER_SNAKE_CASE and cannot overwrite existing keys
- Only 4 actions are supported — no arbitrary commands
```

**Step 3: Commit**

```bash
git add .claude/skills/add-runtime-updates/manifest.yaml .claude/skills/add-runtime-updates/SKILL.md
git commit -m "feat(skill): scaffold add-runtime-updates skill"
```

---

### Task 2: Create the new files (add/ directory)

**Files:**
- Create: `.claude/skills/add-runtime-updates/add/src/runtime-update-executor.ts`
- Create: `.claude/skills/add-runtime-updates/add/src/runtime-updates.test.ts`
- Create: `.claude/skills/add-runtime-updates/add/src/runtime-update-executor.test.ts`

**Step 1: Write the test for DB CRUD**

Create `.claude/skills/add-runtime-updates/add/src/runtime-updates.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  _initTestDatabase,
  createRuntimeUpdate,
  getRuntimeUpdate,
  getPendingRuntimeUpdate,
  resolveRuntimeUpdate,
  getExpiredRuntimeUpdates,
} from './db.js';

beforeEach(() => {
  _initTestDatabase();
});

describe('runtime update CRUD', () => {
  it('creates and retrieves a runtime update', () => {
    const id = createRuntimeUpdate({
      group_folder: 'trading',
      action: 'git_pull',
      params: '{}',
      reason: 'upstream fix',
    });

    const update = getRuntimeUpdate(id);
    expect(update).toBeDefined();
    expect(update!.group_folder).toBe('trading');
    expect(update!.action).toBe('git_pull');
    expect(update!.status).toBe('pending');
  });

  it('blocks duplicate pending request from same group', () => {
    createRuntimeUpdate({
      group_folder: 'trading',
      action: 'git_pull',
      params: '{}',
      reason: 'first',
    });

    const id2 = createRuntimeUpdate({
      group_folder: 'trading',
      action: 'apply_skill',
      params: '{}',
      reason: 'second',
    });

    expect(id2).toBeNull();
  });

  it('allows request after previous one is resolved', () => {
    const id1 = createRuntimeUpdate({
      group_folder: 'trading',
      action: 'git_pull',
      params: '{}',
      reason: 'first',
    });

    resolveRuntimeUpdate(id1!, 'approved');

    const id2 = createRuntimeUpdate({
      group_folder: 'trading',
      action: 'apply_skill',
      params: '{}',
      reason: 'second',
    });

    expect(id2).not.toBeNull();
  });

  it('getPendingRuntimeUpdate returns null when none exist', () => {
    expect(getPendingRuntimeUpdate('trading')).toBeNull();
  });

  it('resolves a runtime update', () => {
    const id = createRuntimeUpdate({
      group_folder: 'trading',
      action: 'git_pull',
      params: '{}',
      reason: 'fix',
    });

    resolveRuntimeUpdate(id!, 'approved', 'success');

    const update = getRuntimeUpdate(id!);
    expect(update!.status).toBe('approved');
    expect(update!.result).toBe('success');
    expect(update!.resolved_at).toBeTruthy();
  });

  it('finds expired updates', () => {
    const id = createRuntimeUpdate({
      group_folder: 'trading',
      action: 'git_pull',
      params: '{}',
      reason: 'old',
    });

    // 0ms maxAge = everything is expired
    const expired = getExpiredRuntimeUpdates(0);
    expect(expired.length).toBe(1);
    expect(expired[0].id).toBe(id);
  });
});
```

**Step 2: Write the test for approval matcher/executor**

Create `.claude/skills/add-runtime-updates/add/src/runtime-update-executor.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  _initTestDatabase,
  createRuntimeUpdate,
  getRuntimeUpdate,
} from './db.js';
import { matchApprovalCommand, processApproval } from './runtime-update-executor.js';

beforeEach(() => {
  _initTestDatabase();
});

describe('matchApprovalCommand', () => {
  it('matches "approve 7"', () => {
    expect(matchApprovalCommand('approve 7')).toEqual({ action: 'approve', id: 7 });
  });

  it('matches "deny 3"', () => {
    expect(matchApprovalCommand('deny 3')).toEqual({ action: 'deny', id: 3 });
  });

  it('returns null for non-matching text', () => {
    expect(matchApprovalCommand('hello world')).toBeNull();
    expect(matchApprovalCommand('approve')).toBeNull();
    expect(matchApprovalCommand('approve abc')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(matchApprovalCommand('Approve 5')).toEqual({ action: 'approve', id: 5 });
    expect(matchApprovalCommand('DENY 2')).toEqual({ action: 'deny', id: 2 });
  });
});

describe('processApproval', () => {
  it('denies a pending request', async () => {
    const id = createRuntimeUpdate({
      group_folder: 'trading',
      action: 'git_pull',
      params: '{}',
      reason: 'test',
    });

    const result = await processApproval(id!, 'deny');
    expect(result.message).toContain('Denied');
    expect(getRuntimeUpdate(id!)!.status).toBe('denied');
  });

  it('returns error for non-existent ID', async () => {
    const result = await processApproval(999, 'approve');
    expect(result.message).toContain('not found');
  });

  it('returns error for already-resolved request', async () => {
    const id = createRuntimeUpdate({
      group_folder: 'trading',
      action: 'git_pull',
      params: '{}',
      reason: 'test',
    });

    await processApproval(id!, 'deny');
    const result = await processApproval(id!, 'approve');
    expect(result.message).toContain('already');
  });
});
```

**Step 3: Create the executor module**

Create `.claude/skills/add-runtime-updates/add/src/runtime-update-executor.ts`:

```typescript
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { getRuntimeUpdate, resolveRuntimeUpdate } from './db.js';
import { logger } from './logger.js';
import { RuntimeUpdate } from './types.js';

const APPROVAL_PATTERN = /^(approve|deny)\s+(\d+)$/i;

export function matchApprovalCommand(
  text: string,
): { action: 'approve' | 'deny'; id: number } | null {
  const match = text.trim().match(APPROVAL_PATTERN);
  if (!match) return null;
  return {
    action: match[1].toLowerCase() as 'approve' | 'deny',
    id: parseInt(match[2], 10),
  };
}

const REQUIRES_RESTART = new Set(['git_pull', 'apply_skill', 'rebuild_container']);

export async function processApproval(
  id: number,
  action: 'approve' | 'deny',
): Promise<{ message: string; restart: boolean }> {
  const update = getRuntimeUpdate(id);
  if (!update) {
    return { message: `Runtime update #${id} not found.`, restart: false };
  }
  if (update.status !== 'pending') {
    return { message: `Runtime update #${id} already ${update.status}.`, restart: false };
  }

  if (action === 'deny') {
    resolveRuntimeUpdate(id, 'denied');
    logToFile(id, update, 'DENIED');
    return {
      message: `Denied runtime update #${id} (\`${update.action}\` from ${update.group_folder}).`,
      restart: false,
    };
  }

  try {
    const result = executeAction(update);
    resolveRuntimeUpdate(id, 'approved', result);
    logToFile(id, update, result);

    const needsRestart = REQUIRES_RESTART.has(update.action);
    return {
      message: `Approved runtime update #${id} (\`${update.action}\`): ${result}${needsRestart ? '\nRestarting...' : ''}`,
      restart: needsRestart,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    resolveRuntimeUpdate(id, 'failed', errorMsg);
    logToFile(id, update, `FAILED — ${errorMsg}`);
    return {
      message: `Runtime update #${id} failed: ${errorMsg}`,
      restart: false,
    };
  }
}

function logToFile(id: number, update: RuntimeUpdate, result: string): void {
  const logLine = `[${new Date().toISOString()}] #${id} ${update.action} from ${update.group_folder}: ${result}\n`;
  try {
    fs.appendFileSync(path.join(DATA_DIR, 'runtime-updates.log'), logLine);
  } catch {
    logger.warn('Failed to write to runtime-updates.log');
  }
}

function executeAction(update: RuntimeUpdate): string {
  const cwd = process.cwd();

  switch (update.action) {
    case 'git_pull': {
      execFileSync('git', ['pull', '--rebase'], { cwd, timeout: 60000 });
      execFileSync('npm', ['install', '--silent'], { cwd, timeout: 120000 });
      execFileSync('npm', ['run', 'build'], { cwd, timeout: 60000 });
      return 'Pulled, installed, and built successfully.';
    }

    case 'apply_skill': {
      const { skill } = JSON.parse(update.params);
      execFileSync('npx', ['tsx', 'scripts/apply-skill.ts', skill], { cwd, timeout: 60000 });
      execFileSync('npm', ['run', 'build'], { cwd, timeout: 60000 });
      return `Applied skill ${skill} and rebuilt.`;
    }

    case 'update_config': {
      const { key, value } = JSON.parse(update.params);
      const envPath = path.join(cwd, '.env');

      let existing = '';
      try { existing = fs.readFileSync(envPath, 'utf-8'); } catch { /* no .env yet */ }

      const existingKeys = new Set(
        existing.split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'))
          .map((l) => l.split('=')[0].trim()),
      );

      if (existingKeys.has(key)) {
        throw new Error(`Key "${key}" already exists in .env. Overwrites are not allowed.`);
      }

      fs.appendFileSync(envPath, `\n${key}=${value}\n`);
      return `Added ${key} to .env.`;
    }

    case 'rebuild_container': {
      execFileSync('bash', ['./container/build.sh'], { cwd, timeout: 300000 });
      return 'Container image rebuilt.';
    }

    default:
      throw new Error(`Unknown action: ${update.action}`);
  }
}
```

**Step 4: Commit**

```bash
git add .claude/skills/add-runtime-updates/add/
git commit -m "feat(skill): add new files for runtime-updates skill"
```

---

### Task 3: Create modified file snapshots (modify/ directory)

**Files:**
- Create: `.claude/skills/add-runtime-updates/modify/src/types.ts` + `.intent.md`
- Create: `.claude/skills/add-runtime-updates/modify/src/db.ts` + `.intent.md`
- Create: `.claude/skills/add-runtime-updates/modify/src/ipc.ts` + `.intent.md`
- Create: `.claude/skills/add-runtime-updates/modify/src/index.ts` + `.intent.md`
- Create: `.claude/skills/add-runtime-updates/modify/src/ipc-auth.test.ts` + `.intent.md`

Each `modify/` file is a **full snapshot** of the modified version. Each `.intent.md` explains what changed.

**Step 1: types.ts modifications**

Add `RuntimeUpdate` interface after `TaskRunLog` (line 77):

```typescript
export interface RuntimeUpdate {
  id: number;
  group_folder: string;
  action: 'git_pull' | 'apply_skill' | 'update_config' | 'rebuild_container';
  params: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'failed';
  result: string | null;
  created_at: string;
  resolved_at: string | null;
}
```

Intent: Added RuntimeUpdate interface. All existing types unchanged.

**Step 2: db.ts modifications**

- Add `RuntimeUpdate` to the import from `./types.js`
- Add `runtime_updates` table to `createSchema()`
- Add 5 functions at end: `createRuntimeUpdate`, `getRuntimeUpdate`, `getPendingRuntimeUpdate`, `resolveRuntimeUpdate`, `getExpiredRuntimeUpdates`

Intent: Added runtime_updates table and CRUD. All existing tables, queries, and functions preserved.

**Step 3: ipc.ts modifications**

- Add `createRuntimeUpdate` to import from `./db.js`
- Add `action`, `params`, `reason` to `processTaskIpc` data parameter type
- Add `runtime_update` case to switch statement (validates action, skill path, config key format, queues in DB, sends approval message)

Intent: Added runtime_update IPC handler. All existing IPC handlers unchanged.

**Step 4: index.ts modifications**

- Add imports: `matchApprovalCommand`, `processApproval` from `./runtime-update-executor.js`
- Add `getExpiredRuntimeUpdates`, `resolveRuntimeUpdate` to db.js import
- In `startMessageLoop()`: intercept approval commands before agent processing
- In `main()`: add expiry sweep interval (every 5 min, expire requests older than 1 hour)

Intent: Added approval command interception and expiry sweep. All existing message processing, state management, and recovery logic unchanged.

**Step 5: ipc-auth.test.ts modifications**

- Add `getPendingRuntimeUpdate` to db.js import
- Add `runtime_update IPC` describe block testing: valid request queuing, unknown action rejection, path traversal rejection, valid config request, duplicate blocking

Intent: Added runtime_update authorization tests. All existing IPC auth tests unchanged.

**Step 6: Write all intent.md files and full snapshots**

Each `.intent.md` follows the pattern from existing skills (see `add-ntfy/modify/src/config.ts.intent.md` for format).

Each modified file is a full copy of the current file with the additions applied.

**Step 7: Commit**

```bash
git add .claude/skills/add-runtime-updates/modify/
git commit -m "feat(skill): add modified file snapshots for runtime-updates skill"
```

---

### Task 4: Apply the skill and run tests

**Step 1: Apply the skill**

Run: `npx tsx scripts/apply-skill.ts .claude/skills/add-runtime-updates`

**Step 2: Build**

Run: `npm run build`

**Step 3: Run all tests**

Run: `npx vitest run src/runtime-updates.test.ts src/runtime-update-executor.test.ts src/ipc-auth.test.ts`
Expected: All PASS

**Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

**Step 5: Commit the applied skill**

```bash
git add -A
git commit -m "feat: apply runtime-updates skill"
```

---

### Task 5: Manual end-to-end test

**Step 1: Start in dev mode**

Run: `npm run dev`

**Step 2: Test IPC request**

```bash
mkdir -p data/ipc/main/tasks
cat > data/ipc/main/tasks/test-update.json << 'EOF'
{
  "type": "runtime_update",
  "action": "update_config",
  "params": "{\"key\": \"TEST_RUNTIME_UPDATE\", \"value\": \"it_works\"}",
  "reason": "testing runtime updates"
}
EOF
```

**Step 3: Verify approval message appears in channel**

Expected: "Runtime update request from main: `update_config` — TEST_RUNTIME_UPDATE=it_works..."

**Step 4: Approve via channel**

Send: `approve 1`

**Step 5: Verify .env updated**

Run: `grep TEST_RUNTIME_UPDATE .env`
Expected: `TEST_RUNTIME_UPDATE=it_works`

**Step 6: Clean up and commit fixes**

Remove test key from `.env`. Commit any fixes needed.
