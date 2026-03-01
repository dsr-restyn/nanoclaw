# Security Hardening & Autonomous Engineer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden NanoClaw's container isolation, HTTP security, and secret handling, then build a supervised autonomy loop where agents can propose work, execute pipelines on feature branches, extend themselves via skills, and request resources — all gated by approval tiers.

**Architecture:** Security changes modify existing files (container-runner, http channel, voice handler, db schema). Autonomy features extend the IPC/runtime-update system with new actions (propose_work, request_host_access, request_resource, rollback) and add new modules (approval tiers, audit trail, health checks, spending tracker).

**Tech Stack:** TypeScript, Vitest, Fastify, better-sqlite3, Docker CLI, @fastify/rate-limit

---

## Phase 1: Container Isolation

### Task 1: Read-only agent-runner-src mount

**Files:**
- Modify: `src/container-runner.ts:198-202`
- Test: `src/container-runner.test.ts`

**Step 1: Write the failing test**

In `src/container-runner.test.ts`, add a test that verifies the agent-runner-src mount is read-only:

```typescript
it('mounts agent-runner-src as read-only', async () => {
  const onProcess = vi.fn();
  fakeProc = createFakeProcess();

  const runPromise = runContainerAgent(
    { name: 'Test', folder: 'test-group', trigger: '@Andy', added_at: '' },
    { prompt: 'test', groupFolder: 'test-group', chatJid: 'test@g.us', isMain: false },
    onProcess,
  );

  // Inspect spawn args
  const { spawn } = await import('child_process');
  const spawnArgs = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
  const joinedArgs = spawnArgs.join(' ');

  // Agent runner source should be mounted read-only
  expect(joinedArgs).toContain('/app/src:ro');

  // Complete the process
  fakeProc.emit('close', 0);
  await runPromise;
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/container-runner.test.ts -t "mounts agent-runner-src as read-only"`
Expected: FAIL — mount is currently read-write (no `:ro` suffix)

**Step 3: Write minimal implementation**

In `src/container-runner.ts`, change lines 198-202:

```typescript
  mounts.push({
    hostPath: groupAgentRunnerDir,
    containerPath: '/app/src',
    readonly: true,  // was: false
  });
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/container-runner.test.ts -t "mounts agent-runner-src as read-only"`
Expected: PASS

**Step 5: Run full test suite**

Run: `npx vitest run src/container-runner.test.ts`
Expected: All tests pass

**Step 6: Build**

Run: `npm run build`
Expected: Success

**Step 7: Commit**

```bash
git add src/container-runner.ts src/container-runner.test.ts
git commit -m "security: make agent-runner-src mount read-only"
```

---

### Task 2: Bridge networking with config-driven host access

**Files:**
- Create: `src/container-hosts.ts`
- Create: `src/container-hosts.test.ts`
- Modify: `src/container-runner.ts:236-294`
- Test: `src/container-runner.test.ts`

**Step 1: Write the failing test for container-hosts module**

Create `src/container-hosts.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./config.js', () => ({
  DATA_DIR: '/tmp/nanoclaw-test-data',
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => ''),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    },
  };
});

describe('container-hosts', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns default host-gateway entry when no config file exists', async () => {
    const fs = (await import('fs')).default;
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const { loadContainerHosts } = await import('./container-hosts.js');
    const hosts = loadContainerHosts();

    expect(hosts).toEqual([
      { name: 'host.docker.internal', ip: 'host-gateway' },
    ]);
  });

  it('reads hosts from data/container-hosts.json', async () => {
    const fs = (await import('fs')).default;
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify({
        hosts: [
          { name: 'host.docker.internal', ip: 'host-gateway' },
          { name: 'redis', ip: '172.17.0.3' },
        ],
        auto_approve_ranges: ['172.17.0.0/16'],
      }),
    );

    const { loadContainerHosts } = await import('./container-hosts.js');
    const hosts = loadContainerHosts();

    expect(hosts).toHaveLength(2);
    expect(hosts[1]).toEqual({ name: 'redis', ip: '172.17.0.3' });
  });

  it('addHost appends to config and returns updated list', async () => {
    const fs = (await import('fs')).default;
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify({
        hosts: [{ name: 'host.docker.internal', ip: 'host-gateway' }],
        auto_approve_ranges: [],
      }),
    );

    const { addContainerHost } = await import('./container-hosts.js');
    addContainerHost('postgres', '172.17.0.5');

    expect(fs.writeFileSync).toHaveBeenCalled();
    const written = JSON.parse(
      (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1],
    );
    expect(written.hosts).toHaveLength(2);
    expect(written.hosts[1].name).toBe('postgres');
  });

  it('isAutoApproved returns true for IPs in allowed ranges', async () => {
    const fs = (await import('fs')).default;
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify({
        hosts: [],
        auto_approve_ranges: ['172.17.0.0/16'],
      }),
    );

    const { isAutoApprovedIp } = await import('./container-hosts.js');
    expect(isAutoApprovedIp('172.17.0.5')).toBe(true);
    expect(isAutoApprovedIp('10.0.0.1')).toBe(false);
    expect(isAutoApprovedIp('host-gateway')).toBe(true); // always allowed
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/container-hosts.test.ts`
Expected: FAIL — module doesn't exist yet

**Step 3: Implement container-hosts module**

Create `src/container-hosts.ts`:

```typescript
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

export interface HostEntry {
  name: string;
  ip: string;
}

interface ContainerHostsConfig {
  hosts: HostEntry[];
  auto_approve_ranges: string[];
}

const CONFIG_PATH = path.join(DATA_DIR, 'container-hosts.json');

const DEFAULT_CONFIG: ContainerHostsConfig = {
  hosts: [{ name: 'host.docker.internal', ip: 'host-gateway' }],
  auto_approve_ranges: [],
};

function readConfig(): ContainerHostsConfig {
  if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (err) {
    logger.warn({ err }, 'Failed to parse container-hosts.json, using defaults');
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(config: ContainerHostsConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

export function loadContainerHosts(): HostEntry[] {
  return readConfig().hosts;
}

export function addContainerHost(name: string, ip: string): HostEntry[] {
  const config = readConfig();
  config.hosts.push({ name, ip });
  writeConfig(config);
  return config.hosts;
}

/** Check if an IP is within auto-approve ranges. host-gateway is always allowed. */
export function isAutoApprovedIp(ip: string): boolean {
  if (ip === 'host-gateway') return true;
  const config = readConfig();
  return config.auto_approve_ranges.some((range) => ipInCidr(ip, range));
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [rangeIp, bits] = cidr.split('/');
  const mask = ~((1 << (32 - parseInt(bits, 10))) - 1) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(rangeIp) & mask);
}

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/container-hosts.test.ts`
Expected: PASS

**Step 5: Write the failing test for bridge network args**

In `src/container-runner.test.ts`, add:

```typescript
it('uses bridge network with --add-host entries', async () => {
  const onProcess = vi.fn();
  fakeProc = createFakeProcess();

  const runPromise = runContainerAgent(
    { name: 'Test', folder: 'test-group', trigger: '@Andy', added_at: '' },
    { prompt: 'test', groupFolder: 'test-group', chatJid: 'test@g.us', isMain: false },
    onProcess,
  );

  const { spawn } = await import('child_process');
  const spawnArgs = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];

  // Should NOT have --network host
  expect(spawnArgs).not.toContain('host');
  // Should have --network bridge
  const networkIdx = spawnArgs.indexOf('--network');
  expect(spawnArgs[networkIdx + 1]).toBe('bridge');
  // Should have at least the default --add-host
  expect(spawnArgs).toContain('--add-host');

  fakeProc.emit('close', 0);
  await runPromise;
});
```

**Step 6: Run test to verify it fails**

Run: `npx vitest run src/container-runner.test.ts -t "uses bridge network"`
Expected: FAIL — currently uses `--network host`

**Step 7: Modify buildContainerArgs to use bridge network**

In `src/container-runner.ts`, replace lines 241-246:

```typescript
  // Bridge network: containers can only reach explicitly listed hosts.
  // Host entries are managed via data/container-hosts.json — agents can
  // request new entries via the request_host_access IPC action.
  args.push('--network', 'bridge');
  const hosts = loadContainerHosts();
  for (const host of hosts) {
    args.push('--add-host', `${host.name}:${host.ip}`);
  }
```

Add the import at the top of the file:

```typescript
import { loadContainerHosts } from './container-hosts.js';
```

**Step 8: Run tests and build**

Run: `npx vitest run src/container-runner.test.ts && npm run build`
Expected: All pass, build succeeds

**Step 9: Commit**

```bash
git add src/container-hosts.ts src/container-hosts.test.ts src/container-runner.ts src/container-runner.test.ts
git commit -m "security: switch containers to bridge network with config-driven hosts"
```

---

### Task 3: Add request_host_access IPC action

**Files:**
- Modify: `src/ipc.ts:414-499`
- Modify: `src/runtime-update-executor.ts:76-135`
- Test: `src/ipc-auth.test.ts`

**Step 1: Write the failing test**

In `src/ipc-auth.test.ts`, add a test for the new IPC action:

```typescript
describe('request_host_access', () => {
  it('queues request_host_access as a runtime update', async () => {
    await processTaskIpc(
      {
        type: 'runtime_update',
        action: 'request_host_access',
        params: JSON.stringify({ host: 'redis', ip: '172.17.0.3' }),
        reason: 'Need Redis for caching',
      },
      'main',
      true,
      deps,
    );

    const update = getPendingRuntimeUpdate('main');
    expect(update).toBeTruthy();
    expect(update!.action).toBe('request_host_access');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/ipc-auth.test.ts -t "request_host_access"`
Expected: FAIL — `request_host_access` not in VALID_ACTIONS

**Step 3: Add request_host_access to IPC validation**

In `src/ipc.ts:415`, add to VALID_ACTIONS:

```typescript
const VALID_ACTIONS = ['git_pull', 'apply_skill', 'update_config', 'rebuild_container', 'request_host_access'];
```

Add validation after the `update_config` block (after line 458):

```typescript
      // Validate request_host_access params
      if (data.action === 'request_host_access') {
        try {
          const parsed = JSON.parse(params);
          if (!parsed.host || !parsed.ip || typeof parsed.host !== 'string' || typeof parsed.ip !== 'string') {
            logger.warn({ sourceGroup }, 'Invalid request_host_access params');
            break;
          }
          // Basic IP format validation
          if (parsed.ip !== 'host-gateway' && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parsed.ip)) {
            logger.warn({ ip: parsed.ip, sourceGroup }, 'Invalid IP format in request_host_access');
            break;
          }
        } catch {
          logger.warn({ sourceGroup }, 'Invalid params JSON in runtime_update');
          break;
        }
      }
```

**Step 4: Add executor for request_host_access**

In `src/runtime-update-executor.ts`, add a case in `executeAction()`. Note: this action does NOT require restart — new containers pick up the updated config automatically.

```typescript
    case 'request_host_access': {
      const { host, ip } = JSON.parse(update.params);
      const { addContainerHost } = await import('./container-hosts.js');
      addContainerHost(host, ip);
      return `Added host ${host} (${ip}). Effective on next container spawn.`;
    }
```

Since `executeAction` is currently synchronous and the dynamic import is async, change the function signature to `async function executeAction` and update the caller in `processApproval` to `await executeAction(update)`.

**Step 5: Run tests and build**

Run: `npx vitest run src/ipc-auth.test.ts && npx vitest run src/runtime-update-executor.test.ts && npm run build`
Expected: All pass

**Step 6: Commit**

```bash
git add src/ipc.ts src/runtime-update-executor.ts src/ipc-auth.test.ts
git commit -m "feat: add request_host_access IPC action for container network config"
```

---

## Phase 2: HTTP Hardening

### Task 4: CORS allowlist and localhost binding

**Files:**
- Modify: `src/config.ts`
- Modify: `src/channels/http.ts:112-130`
- Modify: `.env.example`

**Step 1: Add config values**

In `src/config.ts`, add to `readEnvFile` call (line 9 array):

```typescript
'HTTP_ALLOWED_ORIGINS',
'HTTP_HOST',
```

Add exports after the HTTP_PORT export:

```typescript
export const HTTP_ALLOWED_ORIGINS = (
  process.env.HTTP_ALLOWED_ORIGINS || envConfig.HTTP_ALLOWED_ORIGINS || 'http://localhost:4080'
).split(',').map(s => s.trim()).filter(Boolean);

export const HTTP_HOST =
  process.env.HTTP_HOST || envConfig.HTTP_HOST || '127.0.0.1';
```

**Step 2: Update HTTP channel**

In `src/channels/http.ts:113`, change CORS:

```typescript
    await this.server.register(cors, {
      origin: HTTP_ALLOWED_ORIGINS,
    });
```

At line 130, change host:

```typescript
    await this.server.listen({ port: this.opts.port, host: HTTP_HOST });
```

Update imports to include the new config values.

**Step 3: Update .env.example**

Append:

```
HTTP_ALLOWED_ORIGINS=http://localhost:4080
HTTP_HOST=127.0.0.1
```

**Step 4: Build**

Run: `npm run build`
Expected: Success

**Step 5: Commit**

```bash
git add src/config.ts src/channels/http.ts .env.example
git commit -m "security: CORS allowlist and bind HTTP to localhost by default"
```

---

### Task 5: Rate limiting

**Files:**
- Modify: `package.json` (add @fastify/rate-limit)
- Modify: `src/channels/http.ts`

**Step 1: Install dependency**

Run: `npm install @fastify/rate-limit`

**Step 2: Add rate limiting to HTTP channel**

In `src/channels/http.ts`, after the CORS registration:

```typescript
    const rateLimit = (await import('@fastify/rate-limit')).default;
    await this.server.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
    });
```

For auth-sensitive endpoints (QR code generation), add stricter limits:

```typescript
    server.get('/pair/install/qr', {
      preHandler: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    }, async (request, reply) => { ... });
```

**Step 3: Build**

Run: `npm run build`
Expected: Success

**Step 4: Commit**

```bash
git add package.json package-lock.json src/channels/http.ts
git commit -m "security: add rate limiting to HTTP channel"
```

---

### Task 6: Remove query param token auth

**Files:**
- Modify: `src/channels/http.ts:74-78`

**Step 1: Remove query param from extractToken**

Change `extractToken()`:

```typescript
function extractToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}
```

**Step 2: Add comment to QR generation endpoints**

The QR code still embeds the token in the URL for one-time delivery to the Creation WebView. The frontend stores it in localStorage and uses Bearer auth for API calls thereafter. Add a comment:

```typescript
      // Token is embedded in URL for one-time delivery to the Creation WebView.
      // The frontend stores it in localStorage and uses Bearer auth for API calls.
      // The ?token= query param is NOT accepted by the API (Bearer only).
```

**Step 3: Build**

Run: `npm run build`
Expected: Success

**Step 4: Commit**

```bash
git add src/channels/http.ts
git commit -m "security: remove query parameter token authentication"
```

---

### Task 7: Voice session security — remove IP-only resumption

**Files:**
- Modify: `src/channels/http/voice.ts:36,78-105`

**Step 1: Change RECONNECT_GRACE_MS**

In `src/channels/http/voice.ts:36`:

```typescript
const RECONNECT_GRACE_MS = 60 * 60 * 1000; // 1 hour (was 7 days)
```

**Step 2: Remove IP-only resumption**

Replace lines 78-105 with:

```typescript
  if (!token) {
    logger.warn(
      { tokenLength: 0, clientIp },
      'Voice handshake: empty token — rejecting (token required)',
    );
    socket.send(
      JSON.stringify(buildHelloError(requestId, 'token required')),
    );
    socket.close();
    return;
  }
```

This removes the `findRecentVoiceSession` IP-based lookup path entirely. All connections require a token.

**Step 3: Build**

Run: `npm run build`
Expected: Success

**Step 4: Commit**

```bash
git add src/channels/http/voice.ts
git commit -m "security: require token for all voice connections, remove IP-only resumption"
```

---

### Task 8: Token scoping (admin vs device)

**Files:**
- Modify: `src/db.ts` (schema migration, createHttpToken, validateHttpToken)
- Modify: `src/channels/http.ts` (scope-aware auth middleware)
- Test: `src/db.test.ts`

**Step 1: Write the failing test**

In `src/db.test.ts`, add:

```typescript
describe('token scoping', () => {
  it('creates admin token with no group_jid', () => {
    const token = createHttpToken('Admin');
    expect(validateHttpToken(token)).toBe(true);
    expect(getTokenScope(token)).toBeNull(); // null = admin
  });

  it('creates scoped token with group_jid', () => {
    const token = createHttpToken('R1 Device', 'http:abc123');
    expect(validateHttpToken(token)).toBe(true);
    expect(getTokenScope(token)).toBe('http:abc123');
  });

  it('validateHttpTokenForGroup rejects scoped token for wrong group', () => {
    const token = createHttpToken('R1 Device', 'http:abc123');
    expect(validateHttpTokenForGroup(token, 'http:abc123')).toBe(true);
    expect(validateHttpTokenForGroup(token, 'http:other')).toBe(false);
  });

  it('validateHttpTokenForGroup allows admin token for any group', () => {
    const token = createHttpToken('Admin');
    expect(validateHttpTokenForGroup(token, 'http:abc123')).toBe(true);
    expect(validateHttpTokenForGroup(token, 'http:other')).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db.test.ts -t "token scoping"`
Expected: FAIL — functions don't exist yet

**Step 3: Add schema migration and functions**

In `src/db.ts`, add migration in `createSchema()` (after existing migrations):

```typescript
  // Add group_jid column for token scoping (null = admin, value = device token)
  try {
    database.exec(`ALTER TABLE http_device_tokens ADD COLUMN group_jid TEXT`);
  } catch { /* column already exists */ }
```

Modify `createHttpToken()` to accept optional group_jid:

```typescript
export function createHttpToken(label: string, groupJid?: string): string {
  const raw = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  db.prepare(
    'INSERT INTO http_device_tokens (token_hash, label, created_at, group_jid) VALUES (?, ?, ?, ?)',
  ).run(hash, label, new Date().toISOString(), groupJid ?? null);
  return raw;
}
```

Add new functions:

```typescript
export function getTokenScope(raw: string): string | null {
  const hash = createHash('sha256').update(raw).digest('hex');
  const row = db
    .prepare('SELECT group_jid FROM http_device_tokens WHERE token_hash = ?')
    .get(hash) as { group_jid: string | null } | undefined;
  return row?.group_jid ?? null;
}

export function validateHttpTokenForGroup(raw: string, groupJid: string): boolean {
  const hash = createHash('sha256').update(raw).digest('hex');
  const row = db
    .prepare('SELECT group_jid FROM http_device_tokens WHERE token_hash = ?')
    .get(hash) as { group_jid: string | null } | undefined;
  if (!row) return false;
  if (row.group_jid === null) return true; // admin
  return row.group_jid === groupJid;
}
```

**Step 4: Run tests**

Run: `npx vitest run src/db.test.ts -t "token scoping"`
Expected: PASS

**Step 5: Update HTTP channel to use scope-aware auth on group endpoints**

In `src/channels/http.ts`, add a `requireGroupAuth` preHandler for group-specific endpoints:

```typescript
async function requireGroupAuth(
  request: FastifyRequest<{ Params: { jid: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const token = extractToken(request);
  if (!token || !validateHttpTokenForGroup(token, request.params.jid)) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}
```

Replace `requireAuth` with `requireGroupAuth` on:
- `GET /groups/:jid/messages`
- `POST /groups/:jid/messages`
- `GET /groups/:jid/stream`

The list endpoint (`GET /groups`) and group creation (`POST /groups`) keep `requireAuth` (admin only).

**Step 6: Build**

Run: `npm run build`
Expected: Success

**Step 7: Commit**

```bash
git add src/db.ts src/db.test.ts src/channels/http.ts
git commit -m "security: add token scoping (admin vs device tokens)"
```

---

### Task 9: Gmail credentials to stdin

**Files:**
- Modify: `src/container-runner.ts:204-213` (remove gmail mount)
- Modify: `src/container-runner.ts:232-234` (add gmail token to secrets)

**Step 1: Remove the gmail mount**

In `src/container-runner.ts`, replace lines 204-213:

```typescript
  // Gmail OAuth tokens are passed via stdin (see readSecrets), not mounted.
  // This prevents container filesystem access to persistent credentials.
```

**Step 2: Add gmail token reading to readSecrets**

```typescript
function readSecrets(): Record<string, string> {
  const secrets = readEnvFile(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN']);

  // Read Gmail OAuth token if available
  const homeDir = process.env.HOME || '/root';
  const gmailTokenPath = path.join(homeDir, '.gmail-mcp', 'tokens.json');
  try {
    if (fs.existsSync(gmailTokenPath)) {
      secrets.GMAIL_OAUTH_TOKEN = fs.readFileSync(gmailTokenPath, 'utf-8');
    }
  } catch { /* no gmail token */ }

  return secrets;
}
```

**Step 3: Build**

Run: `npm run build`
Expected: Success

**Note:** The container-side MCP server will need to be updated to read the token from stdin instead of from the filesystem. This is a container-side change that should be done when the gmail MCP server is next modified.

**Step 4: Commit**

```bash
git add src/container-runner.ts
git commit -m "security: move Gmail credentials from mount to stdin secrets"
```

---

## Phase 3: Autonomous Engineer — Proposal System

### Task 10: Approval tiers config

**Files:**
- Create: `src/approval-tiers.ts`
- Create: `src/approval-tiers.test.ts`

**Step 1: Write the failing test**

Create `src/approval-tiers.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./config.js', () => ({
  DATA_DIR: '/tmp/nanoclaw-test-data',
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => ''),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    },
  };
});

describe('approval-tiers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns default tiers when no config file exists', async () => {
    const { getApprovalTier } = await import('./approval-tiers.js');
    expect(getApprovalTier('propose_work')).toBe('auto');
    expect(getApprovalTier('apply_skill')).toBe('require');
    expect(getApprovalTier('push_branch')).toBe('notify');
  });

  it('reads custom tiers from config file', async () => {
    const fs = (await import('fs')).default;
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify({ push_branch: 'auto' }),
    );

    const { getApprovalTier } = await import('./approval-tiers.js');
    expect(getApprovalTier('push_branch')).toBe('auto');
  });

  it('defaults unknown actions to require', async () => {
    const { getApprovalTier } = await import('./approval-tiers.js');
    expect(getApprovalTier('unknown_action')).toBe('require');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/approval-tiers.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement approval-tiers module**

Create `src/approval-tiers.ts`:

```typescript
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

export type ApprovalTier = 'auto' | 'notify' | 'require';

const CONFIG_PATH = path.join(DATA_DIR, 'approval-tiers.json');

const DEFAULTS: Record<string, ApprovalTier> = {
  // Auto-approve: safe, read-only, or self-contained
  propose_work: 'auto',
  health_check: 'auto',

  // Notify: visible side effects but recoverable
  push_branch: 'notify',
  create_branch: 'notify',
  schedule_task: 'notify',

  // Require approval: destructive or security-sensitive
  apply_skill: 'require',
  request_host_access: 'require',
  request_resource: 'require',
  update_config: 'require',
  rebuild_container: 'require',
  git_pull: 'require',
  rollback: 'require',
};

function readConfig(): Record<string, ApprovalTier> {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (err) {
    logger.warn({ err }, 'Failed to parse approval-tiers.json');
    return {};
  }
}

export function getApprovalTier(action: string): ApprovalTier {
  const overrides = readConfig();
  return overrides[action] ?? DEFAULTS[action] ?? 'require';
}
```

**Step 4: Run tests and build**

Run: `npx vitest run src/approval-tiers.test.ts && npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add src/approval-tiers.ts src/approval-tiers.test.ts
git commit -m "feat: add approval tiers config for autonomous actions"
```

---

### Task 11: Audit trail

**Files:**
- Create: `src/audit.ts`
- Create: `src/audit.test.ts`

**Step 1: Write the failing test**

Create `src/audit.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./config.js', () => ({
  DATA_DIR: '/tmp/nanoclaw-test-data',
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      appendFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    },
  };
});

describe('audit', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('writes JSON line to audit.jsonl', async () => {
    const fs = (await import('fs')).default;
    const { auditLog } = await import('./audit.js');

    auditLog('propose_work', { title: 'Test', status: 'approved' });

    expect(fs.appendFileSync).toHaveBeenCalledOnce();
    const [filePath, line] = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(filePath).toContain('audit.jsonl');
    const parsed = JSON.parse(line.trim());
    expect(parsed.action).toBe('propose_work');
    expect(parsed.title).toBe('Test');
    expect(parsed.ts).toBeDefined();
  });
});
```

**Step 2: Implement audit module**

Create `src/audit.ts`:

```typescript
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';

const AUDIT_PATH = path.join(DATA_DIR, 'audit.jsonl');

export function auditLog(action: string, details: Record<string, unknown>): void {
  const entry = { ts: new Date().toISOString(), action, ...details };
  fs.mkdirSync(path.dirname(AUDIT_PATH), { recursive: true });
  fs.appendFileSync(AUDIT_PATH, JSON.stringify(entry) + '\n');
}
```

**Step 3: Run tests and build**

Run: `npx vitest run src/audit.test.ts && npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/audit.ts src/audit.test.ts
git commit -m "feat: add append-only audit trail for autonomous actions"
```

---

### Task 12: propose_work and request_resource IPC actions

**Files:**
- Modify: `src/ipc.ts` (add to VALID_ACTIONS, add validation)
- Modify: `src/runtime-update-executor.ts` (add executors)
- Test: `src/ipc-auth.test.ts`

**Step 1: Write the failing test**

In `src/ipc-auth.test.ts`:

```typescript
describe('propose_work', () => {
  it('creates a runtime update for propose_work', async () => {
    await processTaskIpc(
      {
        type: 'runtime_update',
        action: 'propose_work',
        params: JSON.stringify({
          title: 'Add rate limiting',
          description: 'Install @fastify/rate-limit',
          estimated_nodes: 3,
          pipeline_dot: 'digraph { a -> b -> c }',
        }),
        reason: 'Security hardening',
      },
      'main',
      true,
      deps,
    );

    const update = getPendingRuntimeUpdate('main');
    expect(update).toBeTruthy();
    expect(update!.action).toBe('propose_work');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/ipc-auth.test.ts -t "propose_work"`
Expected: FAIL

**Step 3: Add actions to IPC**

In `src/ipc.ts:415`:

```typescript
const VALID_ACTIONS = ['git_pull', 'apply_skill', 'update_config', 'rebuild_container', 'request_host_access', 'propose_work', 'request_resource'];
```

Add validation blocks:

```typescript
      if (data.action === 'propose_work') {
        try {
          const parsed = JSON.parse(params);
          if (!parsed.title || !parsed.pipeline_dot) {
            logger.warn({ sourceGroup }, 'propose_work missing title or pipeline_dot');
            break;
          }
        } catch {
          logger.warn({ sourceGroup }, 'Invalid params JSON in propose_work');
          break;
        }
      }

      if (data.action === 'request_resource') {
        try {
          const parsed = JSON.parse(params);
          if (!parsed.type || !parsed.service) {
            logger.warn({ sourceGroup }, 'request_resource missing type or service');
            break;
          }
        } catch {
          logger.warn({ sourceGroup }, 'Invalid params JSON in request_resource');
          break;
        }
      }
```

Update the description formatting to handle new actions:

```typescript
      if (data.action === 'propose_work') {
        const parsed = JSON.parse(params);
        description = `**Proposal:** ${parsed.title}\n${parsed.description || ''}\nEstimated nodes: ${parsed.estimated_nodes || 'unknown'}`;
      } else if (data.action === 'request_resource') {
        const parsed = JSON.parse(params);
        description += ` — ${parsed.service} (${parsed.estimated_cost || 'cost unknown'})`;
      }
```

**Step 4: Add executors**

In `src/runtime-update-executor.ts`, add cases:

```typescript
    case 'propose_work': {
      const { title } = JSON.parse(update.params);
      return `Approved proposal: ${title}. Pipeline will be submitted.`;
    }

    case 'request_resource': {
      const { service, type: resourceType } = JSON.parse(update.params);
      return `Resource request approved: ${resourceType} for ${service}. Awaiting provisioning.`;
    }
```

Neither requires restart. Add them to a DOES_NOT_RESTART check or simply leave them out of REQUIRES_RESTART (they're not included by default).

**Step 5: Run tests and build**

Run: `npx vitest run src/ipc-auth.test.ts && npm run build`
Expected: PASS

**Step 6: Commit**

```bash
git add src/ipc.ts src/runtime-update-executor.ts src/ipc-auth.test.ts
git commit -m "feat: add propose_work and request_resource IPC actions"
```

---

### Task 13: Wire propose_work approval to pipeline submission

**Files:**
- Modify: `src/index.ts` (in the approval handler, check for propose_work and submit pipeline)

**Step 1: Find the approval handler in index.ts**

Search for where `processApproval` is called. After it returns, check if the approved action was `propose_work` and if so, extract the DOT from params and call `startPipeline`.

**Step 2: Add post-approval pipeline submission**

After the `processApproval` call returns successfully, add:

```typescript
// If approved proposal, auto-submit the pipeline
if (approvalAction === 'approve') {
  const update = getRuntimeUpdate(approvalId);
  if (update?.action === 'propose_work') {
    const params = JSON.parse(update.params);
    if (params.pipeline_dot && startPipeline) {
      startPipeline(params.pipeline_dot, update.group_folder, chatJid, 'standard');
      auditLog('pipeline_submitted', { title: params.title, update_id: update.id });
    }
  }
}
```

Import `auditLog` and `getRuntimeUpdate` at the top of the file.

**Step 3: Build**

Run: `npm run build`
Expected: Success

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: auto-submit pipeline on propose_work approval"
```

---

### Task 14: Spending limits

**Files:**
- Create: `src/spending.ts`
- Create: `src/spending.test.ts`

**Step 1: Write the failing test**

Create `src/spending.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./config.js', () => ({
  DATA_DIR: '/tmp/nanoclaw-test-data',
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => ''),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    },
  };
});

describe('spending', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('records a spend entry', async () => {
    const fs = (await import('fs')).default;
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const { recordSpend } = await import('./spending.js');
    recordSpend('openai', 5.00, 'Whisper API');
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('checkBudget returns ok when under limit', async () => {
    const fs = (await import('fs')).default;
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify([
        { ts: new Date().toISOString(), service: 'openai', amount: 10, note: 'test' },
      ]),
    );

    const { checkBudget } = await import('./spending.js');
    const result = checkBudget(50);
    expect(result.ok).toBe(true);
    expect(result.spent).toBe(10);
  });

  it('checkBudget returns not ok when over limit', async () => {
    const fs = (await import('fs')).default;
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify([
        { ts: new Date().toISOString(), service: 'openai', amount: 48, note: 'test' },
      ]),
    );

    const { checkBudget } = await import('./spending.js');
    const result = checkBudget(50);
    expect(result.ok).toBe(false);
  });
});
```

**Step 2: Implement spending module**

Create `src/spending.ts`:

```typescript
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';

interface SpendEntry {
  ts: string;
  service: string;
  amount: number;
  note: string;
}

const SPEND_LOG_PATH = path.join(DATA_DIR, 'spend-log.json');

function readLog(): SpendEntry[] {
  if (!fs.existsSync(SPEND_LOG_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(SPEND_LOG_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function writeLog(entries: SpendEntry[]): void {
  fs.mkdirSync(path.dirname(SPEND_LOG_PATH), { recursive: true });
  fs.writeFileSync(SPEND_LOG_PATH, JSON.stringify(entries, null, 2) + '\n');
}

export function recordSpend(service: string, amount: number, note: string): void {
  const entries = readLog();
  entries.push({ ts: new Date().toISOString(), service, amount, note });
  writeLog(entries);
}

export function getMonthlySpend(): number {
  const entries = readLog();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  return entries
    .filter((e) => e.ts >= monthStart)
    .reduce((sum, e) => sum + e.amount, 0);
}

export function checkBudget(limit: number): { ok: boolean; spent: number; limit: number } {
  const spent = getMonthlySpend();
  return { ok: spent < limit, spent, limit };
}
```

**Step 3: Run tests and build**

Run: `npx vitest run src/spending.test.ts && npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/spending.ts src/spending.test.ts
git commit -m "feat: add spending tracker for resource request budgets"
```

---

### Task 15: Rollback IPC action

**Files:**
- Modify: `src/ipc.ts` (add rollback to VALID_ACTIONS)
- Modify: `src/runtime-update-executor.ts` (add rollback executor)

**Step 1: Add rollback to VALID_ACTIONS**

In `src/ipc.ts:415`:

```typescript
const VALID_ACTIONS = [...existing, 'rollback'];
```

**Step 2: Add rollback executor**

In `src/runtime-update-executor.ts`, add case:

```typescript
    case 'rollback': {
      const { target_id } = JSON.parse(update.params);
      const target = getRuntimeUpdate(target_id);
      if (!target) throw new Error(`Runtime update #${target_id} not found`);

      switch (target.action) {
        case 'update_config': {
          const { key } = JSON.parse(target.params);
          const envPath = path.join(cwd, '.env');
          const existing = fs.readFileSync(envPath, 'utf-8');
          const filtered = existing
            .split('\n')
            .filter((l) => !l.startsWith(`${key}=`))
            .join('\n');
          fs.writeFileSync(envPath, filtered);

          // Remove from passthrough
          const passthroughPath = path.join(DATA_DIR, 'container-env-passthrough.json');
          try {
            const passthrough: string[] = JSON.parse(fs.readFileSync(passthroughPath, 'utf-8'));
            fs.writeFileSync(
              passthroughPath,
              JSON.stringify(passthrough.filter((k) => k !== key), null, 2) + '\n',
            );
          } catch { /* no file */ }

          return `Rolled back update_config: removed ${key} from .env`;
        }
        default:
          throw new Error(`Rollback not supported for action: ${target.action}`);
      }
    }
```

**Step 3: Build and test**

Run: `npm run build && npx vitest run src/runtime-update-executor.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/ipc.ts src/runtime-update-executor.ts
git commit -m "feat: add rollback IPC action for config changes"
```

---

### Task 16: Health check module

**Files:**
- Create: `src/health-check.ts`
- Create: `src/health-check.test.ts`

**Step 1: Write the test**

Create `src/health-check.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('./config.js', () => ({
  DATA_DIR: '/tmp/nanoclaw-test-data',
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => Buffer.from('')),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => true),
    },
  };
});

describe('health-check', () => {
  it('runHealthCheck returns results for all checks', async () => {
    const { runHealthCheck } = await import('./health-check.js');
    const results = runHealthCheck();
    expect(results).toHaveProperty('build');
    expect(results).toHaveProperty('disk');
    expect(results.build.ok).toBe(true);
  });

  it('formatHealthReport produces readable output', async () => {
    const { formatHealthReport } = await import('./health-check.js');
    const report = {
      build: { ok: true, message: 'Build succeeded' },
      disk: { ok: true, message: 'Data directory: 50MB' },
      timestamp: '2026-03-01T00:00:00.000Z',
    };
    const text = formatHealthReport(report);
    expect(text).toContain('OK build');
    expect(text).toContain('OK disk');
  });
});
```

**Step 2: Implement**

Create `src/health-check.ts`:

```typescript
import { execFileSync } from 'child_process';
import fs from 'fs';

import { DATA_DIR } from './config.js';

interface CheckResult {
  ok: boolean;
  message: string;
}

export interface HealthReport {
  build: CheckResult;
  disk: CheckResult;
  timestamp: string;
}

export function runHealthCheck(): HealthReport {
  const timestamp = new Date().toISOString();

  let build: CheckResult;
  try {
    execFileSync('npm', ['run', 'build'], { cwd: process.cwd(), timeout: 60000 });
    build = { ok: true, message: 'Build succeeded' };
  } catch (err) {
    build = { ok: false, message: `Build failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  let disk: CheckResult;
  try {
    const output = execFileSync('du', ['-sm', DATA_DIR], { timeout: 10000 }).toString();
    const sizeMB = parseInt(output.split('\t')[0], 10) || 0;
    const warnThreshold = 1024;
    disk = sizeMB > warnThreshold
      ? { ok: false, message: `Data directory is ${sizeMB}MB (threshold: ${warnThreshold}MB)` }
      : { ok: true, message: `Data directory: ${sizeMB}MB` };
  } catch (err) {
    disk = { ok: false, message: `Disk check failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  return { build, disk, timestamp };
}

export function formatHealthReport(report: HealthReport): string {
  const lines = [`**Health Check** (${report.timestamp})`];
  for (const [name, result] of Object.entries(report)) {
    if (name === 'timestamp') continue;
    const r = result as CheckResult;
    lines.push(`${r.ok ? 'OK' : 'FAIL'} ${name}: ${r.message}`);
  }
  return lines.join('\n');
}
```

**Step 3: Run tests and build**

Run: `npx vitest run src/health-check.test.ts && npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/health-check.ts src/health-check.test.ts
git commit -m "feat: add health check module for autonomous monitoring"
```

---

## Phase 4: Final Integration

### Task 17: Config and .env.example updates

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`

**Step 1: Add MONTHLY_SPEND_LIMIT config**

In `src/config.ts`, add to `readEnvFile`:

```typescript
'MONTHLY_SPEND_LIMIT',
```

Add export:

```typescript
export const MONTHLY_SPEND_LIMIT = parseInt(
  process.env.MONTHLY_SPEND_LIMIT || envConfig.MONTHLY_SPEND_LIMIT || '50',
  10,
);
```

**Step 2: Update .env.example**

Append the new security and autonomy config vars.

**Step 3: Build**

Run: `npm run build`
Expected: Success

**Step 4: Commit**

```bash
git add src/config.ts .env.example
git commit -m "feat: add autonomy config vars and update .env.example"
```

---

### Task 18: Full test suite verification

**Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

**Step 2: Build**

Run: `npm run build`
Expected: Success

**Step 3: Final commit if any fixups needed**

```bash
git add -A
git commit -m "test: fix any integration issues from security+autonomy changes"
```
