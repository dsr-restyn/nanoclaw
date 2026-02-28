---
name: add-git
description: Add git push/pull support for agent containers. Main group gets GitHub credentials via stdin secrets. Configures credential helper and git identity inside the container automatically.
---

# Add Git Push/Pull Support

Gives the main group container authenticated git access to GitHub via a personal access token.
Other groups do not receive the token.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `git` is in `applied_skills`, skip to Phase 3.

### Verify build

```bash
npm run build
```

Fix any errors before continuing.

## Phase 2: Apply Code Changes

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-git
```

This deterministically:
- Three-way merges `GITHUB_TOKEN` into `readSecrets()` in `src/container-runner.ts`
- Three-way merges the main-only secret filter into `runContainerAgent()` in `src/container-runner.ts`
- Three-way merges the Git documentation section into `groups/global/CLAUDE.md`
- Appends `GITHUB_TOKEN` to `.env.example`

If the apply reports merge conflicts, read the intent files:
- `modify/src/container-runner.ts.intent.md` — GITHUB_TOKEN secret handling
- `modify/groups/global/CLAUDE.md.intent.md` — Agent-facing git docs

### Add git credential helper to Agent Runner

Read `container/agent-runner/src/index.ts`.

**Step 1:** Add the `execFileSync` import at the top:

```typescript
import { execFileSync } from 'child_process';
```

**Step 2:** Add `'GITHUB_TOKEN'` to the `SECRET_ENV_VARS` array:

```typescript
const SECRET_ENV_VARS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'GITHUB_TOKEN'];
```

**Step 3:** After the `sdkEnv` block (where secrets are merged into process.env), add the credential helper setup:

```typescript
// Configure git credential helper for GitHub (main group only)
if (containerInput.secrets?.GITHUB_TOKEN) {
  const helperScript = [
    '#!/bin/sh',
    'echo "protocol=https"',
    'echo "host=github.com"',
    'echo "username=x-access-token"',
    `echo "password=${containerInput.secrets.GITHUB_TOKEN}"`,
  ].join('\n');
  fs.writeFileSync('/tmp/.git-credential-helper', helperScript, { mode: 0o700 });

  execFileSync('git', ['config', '--global', 'credential.helper', '/tmp/.git-credential-helper']);
  execFileSync('git', ['config', '--global', 'user.name', containerInput.assistantName || 'Andy']);
  execFileSync('git', ['config', '--global', 'user.email', 'noreply@nanoclaw.local']);
  log('Git credential helper configured for GitHub');
}
```

### Validate

```bash
npm run build
```

## Phase 3: Configure

### Create a GitHub token

1. Go to https://github.com/settings/tokens?type=beta (fine-grained tokens)
2. Create a token scoped to the repos you want the agent to access
3. Grant "Contents" read/write permission

### Add to .env

```bash
GITHUB_TOKEN=github_pat_...
```

## Phase 4: Done

Restart NanoClaw. The main group agent can now `git clone`, `git pull`, and `git push` to GitHub repos the token has access to.

Non-main groups will NOT receive the token — verify by asking a non-main agent to run `git push` (it should fail with auth errors).
