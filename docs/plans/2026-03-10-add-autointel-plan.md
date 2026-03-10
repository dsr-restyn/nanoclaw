# add-autointel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provision the autoIntel competitive intelligence product on NanoClaw. Mount the shared autoIntel context repo into agent containers read-only, create a client provisioning script, and add a docker-compose overlay for DooD deployment.

**Architecture:** The skill modifies `container-runner.ts` to conditionally mount the autoIntel repo at `/workspace/extra/autoIntel` when `AUTOINTEL_PATH` is set. A provisioning script creates new client groups with `config.yaml` from the autoIntel schema and registers them with email JIDs. Docker Compose config uses DooD (Docker-out-of-Docker) pattern.

**Tech Stack:** TypeScript, Docker Compose, YAML config schema from `dsr-restyn/autoIntel`.

**Depends on:** `add-email-channel` skill (for the email transport layer)

---

### Task 1: Add AUTOINTEL_PATH config variable

**Files:**
- Modify: `src/config.ts`

**Step 1: Add config export**

Add to `src/config.ts` after the existing integration key section:

```typescript
// autoIntel context repo path (mounted read-only into agent containers)
const autoIntelEnv = readEnvFile(['AUTOINTEL_PATH']);
export const AUTOINTEL_PATH =
  process.env.AUTOINTEL_PATH || autoIntelEnv.AUTOINTEL_PATH || '';
```

**Step 2: Add to `.env.example`**

```
AUTOINTEL_PATH=
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Clean compilation

**Step 4: Commit**

```bash
git add src/config.ts .env.example
git commit -m "feat(autointel): add AUTOINTEL_PATH config variable"
```

---

### Task 2: Write container-runner mount tests (TDD — red phase)

**Files:**
- Modify: `src/container-runner.test.ts`

**Step 1: Add test for autoIntel mount**

Add tests to the existing container-runner test file. The test should verify that when `AUTOINTEL_PATH` is set and the directory exists, the autoIntel repo is mounted read-only at `/workspace/extra/autoIntel`.

```typescript
describe('autoIntel mount', () => {
  it('mounts autoIntel repo read-only when AUTOINTEL_PATH is set and exists', () => {
    // Set AUTOINTEL_PATH env
    process.env.AUTOINTEL_PATH = '/tmp/test-autointel';
    // Mock fs.existsSync to return true for the path
    // Assert buildVolumeMounts includes the mount
    // hostPath: /tmp/test-autointel
    // containerPath: /workspace/extra/autoIntel
    // readonly: true
  });

  it('skips autoIntel mount when AUTOINTEL_PATH is not set', () => {
    delete process.env.AUTOINTEL_PATH;
    // Assert buildVolumeMounts does NOT include /workspace/extra/autoIntel
  });

  it('skips autoIntel mount when path does not exist', () => {
    process.env.AUTOINTEL_PATH = '/nonexistent/path';
    // Mock fs.existsSync to return false
    // Assert mount not present
  });
});
```

Note: The exact test implementation depends on how `buildVolumeMounts` is currently tested. It's a module-private function, so tests may need to go through `runContainerAgent` or the function may need to be exported for testing.

**Step 2: Run test to verify failure**

Run: `npx vitest run src/container-runner.test.ts`
Expected: FAIL — autoIntel mount not present

**Step 3: Commit**

```bash
git add src/container-runner.test.ts
git commit -m "test(autointel): add failing tests for autoIntel container mount"
```

---

### Task 3: Add autoIntel mount to container-runner (TDD — green phase)

**Files:**
- Modify: `src/container-runner.ts`

**Step 1: Import AUTOINTEL_PATH**

Add to the imports at top of `container-runner.ts`:

```typescript
import {
  // ... existing imports
  AUTOINTEL_PATH,
} from './config.js';
```

**Step 2: Add mount logic to buildVolumeMounts**

Add after the `additionalMounts` validation block (before `return mounts`):

```typescript
  // Mount autoIntel context repo (shared, read-only) when configured
  if (AUTOINTEL_PATH && fs.existsSync(AUTOINTEL_PATH)) {
    mounts.push({
      hostPath: AUTOINTEL_PATH,
      containerPath: '/workspace/extra/autoIntel',
      readonly: true,
    });
  }
```

This goes at the end of `buildVolumeMounts`, after the `additionalMounts` block and before `return mounts`. The `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` setting (already enabled in container settings.json) will auto-discover `/workspace/extra/autoIntel/CLAUDE.md`.

**Step 3: Run tests**

Run: `npx vitest run src/container-runner.test.ts`
Expected: All PASS

**Step 4: Run full suite**

Run: `npm test && npm run build`
Expected: All pass, clean build

**Step 5: Commit**

```bash
git add src/container-runner.ts
git commit -m "feat(autointel): mount autoIntel repo read-only into agent containers"
```

---

### Task 4: Create client provisioning script

**Files:**
- Create: `scripts/provision-client.ts`

**Step 1: Write the provisioning script**

```typescript
#!/usr/bin/env npx tsx
/**
 * Provision a new autoIntel client as a NanoClaw group.
 *
 * Usage:
 *   npx tsx scripts/provision-client.ts <slug> <company-name> <primary-email> [cc-email...]
 *
 * Example:
 *   npx tsx scripts/provision-client.ts achosa "Achosa Home Warranty" stephen@restyn.com ben@restyn.com
 */
import fs from 'fs';
import path from 'path';

const GROUPS_DIR = path.resolve(process.cwd(), 'groups');

function main() {
  const [slug, companyName, primaryEmail, ...ccEmails] = process.argv.slice(2);

  if (!slug || !companyName || !primaryEmail) {
    console.error('Usage: npx tsx scripts/provision-client.ts <slug> <company-name> <primary-email> [cc-email...]');
    process.exit(1);
  }

  // Validate slug
  if (!/^[a-z0-9-]+$/.test(slug)) {
    console.error('Error: slug must be lowercase alphanumeric with hyphens only');
    process.exit(1);
  }

  const groupDir = path.join(GROUPS_DIR, slug);
  const clientDir = path.join(groupDir, 'client');
  const historyDir = path.join(clientDir, 'history');
  const configPath = path.join(clientDir, 'config.yaml');

  if (fs.existsSync(configPath)) {
    console.error(`Error: client "${slug}" already exists at ${groupDir}`);
    process.exit(1);
  }

  // Create directories
  fs.mkdirSync(historyDir, { recursive: true });

  // Build contacts YAML
  const contactLines = [
    `  - email: ${primaryEmail}`,
    `    role: primary`,
  ];
  for (const cc of ccEmails) {
    contactLines.push(`  - email: ${cc}`);
    contactLines.push(`    role: cc`);
  }

  // Write config.yaml
  const config = `# ${companyName} — autoIntel Client Configuration
# Created: ${new Date().toISOString()}

company:
  name: ${companyName}
  industry: ""
  website: ""
  description: ""

competitors: []

contacts:
${contactLines.join('\n')}

focus_areas:
  - pricing
  - product_changes
  - hiring
  - sentiment
  - news

report_cadence:
  frequency: weekly
  day: monday
  time: "09:00"

budget:
  max_research_rounds: 15
  max_followups_per_week: 10
`;

  fs.writeFileSync(configPath, config);

  // Register in database
  // Use dynamic import to avoid loading the full app at script time
  console.log(`Client "${slug}" provisioned at ${groupDir}`);
  console.log(`Config: ${configPath}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Edit ${configPath} — add competitors, industry, website`);
  console.log(`  2. Register group: npx tsx -e "`);
  console.log(`     import { initDatabase, setRegisteredGroup } from './dist/db.js';`);
  console.log(`     initDatabase();`);
  console.log(`     setRegisteredGroup('email:${slug}', {`);
  console.log(`       name: '${companyName}',`);
  console.log(`       folder: '${slug}',`);
  console.log(`       trigger: '@claw',`);
  console.log(`       added_at: new Date().toISOString(),`);
  console.log(`       requiresTrigger: false,`);
  console.log(`     });"`);
  console.log(`  3. Create scheduled task for report cadence`);
}

main();
```

**Step 2: Test the script**

Run: `npx tsx scripts/provision-client.ts test-client "Test Company" test@example.com`
Expected: Creates `groups/test-client/client/config.yaml` with correct structure

**Step 3: Clean up test**

```bash
rm -rf groups/test-client
```

**Step 4: Commit**

```bash
git add scripts/provision-client.ts
git commit -m "feat(autointel): add client provisioning script"
```

---

### Task 5: Create docker-compose overlay

**Files:**
- Create: `docker-compose.autointel.yaml`

**Step 1: Write the compose file**

```yaml
# autoIntel docker-compose overlay
# Usage: docker compose -f docker-compose.yaml -f docker-compose.autointel.yaml up -d
#
# Requires:
# - NanoClaw base docker-compose.yaml
# - ../autoIntel repo cloned alongside nanoclaw
# - Gmail credentials at ~/.gmail-mcp/
# - .env with EMAIL_ENABLED=true, AUTOINTEL_PATH=/app/autoIntel

services:
  nanoclaw:
    build: .
    restart: unless-stopped
    volumes:
      # DooD: host Docker socket for spawning agent containers
      - /var/run/docker.sock:/var/run/docker.sock
      # Persistent state
      - ./store:/app/store
      - ./groups:/app/groups
      - ./data:/app/data
      - ./logs:/app/logs
      # Credentials (host paths)
      - ~/.gmail-mcp:/home/node/.gmail-mcp
      - ~/.claude/.credentials.json:/home/node/.claude/.credentials.json:ro
      # Shared context repos
      - ../autoIntel:/app/autoIntel:ro
    env_file: .env
    environment:
      - AUTOINTEL_PATH=/app/autoIntel
      - EMAIL_ENABLED=true
    ports:
      - "4080:4080"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

**Step 2: Commit**

```bash
git add docker-compose.autointel.yaml
git commit -m "feat(autointel): add docker-compose DooD overlay"
```

---

### Task 6: Build the skill package

**Files:**
- Create: `.claude/skills/add-autointel/manifest.yaml`
- Create: `.claude/skills/add-autointel/SKILL.md`
- Create: `.claude/skills/add-autointel/add/docker-compose.autointel.yaml`
- Create: `.claude/skills/add-autointel/add/scripts/provision-client.ts`
- Create: `.claude/skills/add-autointel/modify/src/container-runner.ts`
- Create: `.claude/skills/add-autointel/modify/src/container-runner.ts.intent.md`
- Create: `.claude/skills/add-autointel/modify/src/config.ts`
- Create: `.claude/skills/add-autointel/modify/src/config.ts.intent.md`

**Step 1: Create manifest.yaml**

```yaml
skill: autointel
version: 1.0.0
description: "autoIntel competitive intelligence platform provisioning and DooD deployment"
core_version: 0.1.0
adds:
  - docker-compose.autointel.yaml
  - scripts/provision-client.ts
modifies:
  - src/container-runner.ts
  - src/config.ts
structured:
  env_additions:
    - AUTOINTEL_PATH
conflicts: []
depends:
  - email-channel
test: "npm run build"
```

**Step 2: Create intent files**

`modify/src/container-runner.ts.intent.md`:
```markdown
# Intent: src/container-runner.ts modifications

## What changed
Added conditional mount of autoIntel context repo into agent containers.

## Key sections
- Import: Added `AUTOINTEL_PATH` from config
- buildVolumeMounts: Added autoIntel mount block after additionalMounts validation

## Invariants
- All existing mounts unchanged
- Mount is read-only
- Mount only added when AUTOINTEL_PATH is set and directory exists
- containerPath is always /workspace/extra/autoIntel
```

`modify/src/config.ts.intent.md`:
```markdown
# Intent: src/config.ts modifications

## What changed
Added AUTOINTEL_PATH config export.

## Key sections
- Added readEnvFile call for AUTOINTEL_PATH
- Added export const AUTOINTEL_PATH

## Invariants
- All existing config exports unchanged
- Defaults to empty string when not set
```

**Step 3: Create SKILL.md**

Write interactive setup instructions: prerequisite check (autoIntel repo, email channel), AUTOINTEL_PATH config, provisioning walkthrough, docker-compose deployment.

**Step 4: Copy source files to skill package**

**Step 5: Commit**

```bash
git add .claude/skills/add-autointel/
git commit -m "feat(skills): add-autointel skill package"
```

---

### Task 7: End-to-end verification

**Step 1: Set up environment**

```bash
# .env
AUTOINTEL_PATH=/home/dakota/Work/github/dsr-restyn/autoIntel
EMAIL_ENABLED=true
EMAIL_INBOX_ADDRESS=reports@restyn.com
```

**Step 2: Provision test client**

```bash
npx tsx scripts/provision-client.ts achosa "Achosa Home Warranty" stephen.simons@restyn.com ben.thresher@restyn.com
```

**Step 3: Register group**

```bash
npx tsx -e "
import { initDatabase, setRegisteredGroup } from './dist/db.js';
initDatabase();
setRegisteredGroup('email:achosa', {
  name: 'Achosa',
  folder: 'achosa',
  trigger: '@claw',
  added_at: new Date().toISOString(),
  requiresTrigger: false,
});
"
```

**Step 4: Verify container mounts**

Run with `LOG_LEVEL=debug npm run dev` and check that container logs show:
- `/workspace/extra/autoIntel` mount present (read-only)
- Email channel connected log message
- autoIntel CLAUDE.md discovered by agent

**Step 5: Send test email and verify round-trip**

Send an email from a registered contact to the inbox. Verify:
1. Email appears in agent logs
2. Agent processes and responds
3. Response is threaded in the same email chain
4. Primary contacts in To:, CC contacts in Cc:

---

## Summary

| Task | What | Depends on |
|------|------|------------|
| 1 | AUTOINTEL_PATH config | — |
| 2 | Container mount tests (red) | Task 1 |
| 3 | Container mount impl (green) | Task 2 |
| 4 | Provisioning script | — |
| 5 | Docker compose overlay | — |
| 6 | Skill package | Tasks 1-5 |
| 7 | E2E verification | Tasks 1-6 + email channel |
