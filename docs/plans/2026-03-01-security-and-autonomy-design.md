# Security Hardening & Autonomous Engineer

## Problem

NanoClaw has security gaps that compound: containers share the host network, agent-runner source is writable, HTTP is open to all origins on all interfaces, and voice sessions resume by IP alone. Separately, agents are purely reactive — they can only work when directly instructed, one message at a time. There's no mechanism for an agent to propose work, plan multi-step implementations, or extend its own capabilities.

This design addresses both: lock down the blast radius of each component, then build a supervised autonomy loop on top of the hardened foundation.

## Part 1: Security Hardening

### 1.1 Container Network Isolation

**Current:** `--network host` gives containers full access to every host port and service.

**Change:** Switch to bridge networking with config-driven host access.

`buildContainerArgs()` in `container-runner.ts` replaces `--network host` with:

```
--network bridge
--add-host host.docker.internal:host-gateway
--add-host redis:172.17.0.3
```

Host entries are sourced from `data/container-hosts.json`:

```json
{
  "hosts": [
    { "name": "host.docker.internal", "ip": "host-gateway" }
  ],
  "auto_approve_ranges": ["172.17.0.0/16"]
}
```

Agents request new host access via IPC:

```json
{
  "type": "runtime_update",
  "action": "request_host_access",
  "params": { "host": "postgres", "ip": "172.17.0.5" },
  "reason": "Need DB for backtesting pipeline"
}
```

If the IP falls within `auto_approve_ranges`, it's added immediately. Otherwise it goes through the existing approval flow — user sees the request in Telegram, replies approve/deny.

### 1.2 Read-Only Agent Runner Source

**Current:** `data/sessions/{group}/agent-runner-src` is bind-mounted read-write to `/app/src`. A compromised agent can modify its own runner to exfiltrate stdin secrets on next spawn.

**Change:** Mount as read-only: `-v .../agent-runner-src:/app/src:ro`

The container entrypoint compiles source to `/tmp/dist` (writable tmpfs). Read-only source has zero runtime impact — compilation still works, the agent can't modify the compiled output (it's `chmod a-w`), and secrets arrive via stdin after compilation completes.

### 1.3 Gmail Credentials to Stdin

**Current:** Gmail OAuth tokens mounted as files at `data/sessions/{group}/gmail-tokens/`, accessible to the container filesystem for the entire session.

**Change:** Move to the stdin secret pattern already used for API keys.

Host reads the token file, includes it in the stdin JSON payload under `gmail_oauth_token`, clears from memory after write. The MCP server inside the container reads the token from stdin at startup. Token files are never mounted into the container.

### 1.4 HTTP CORS Allowlist

**Current:** `origin: true` allows any origin to call the HTTP API.

**Change:** Read allowed origins from `.env`:

```
HTTP_ALLOWED_ORIGINS=http://localhost:4080,https://nanoclaw.example.com
```

Default: `http://localhost:4080` only. R1 Creation WebView uses `file://` origin, which CORS doesn't restrict. Cloudflared tunnels terminate at localhost, so the default works for tunnel setups without changes.

### 1.5 Bind to Localhost

**Current:** HTTP server binds to `0.0.0.0` (all interfaces).

**Change:** Default to `127.0.0.1`. Configurable via `HTTP_HOST` in `.env` for LAN-direct setups. Since Telegram and WhatsApp are outbound-only (long-poll/WebSocket to their servers), this has no impact on messaging channels. Cloudflared connects to localhost, so tunnel setups are unaffected.

### 1.6 Bearer-Only Token Auth

**Current:** Tokens accepted via `Authorization: Bearer` header or `?token=` query parameter. Query params leak to browser history, server logs, and proxy logs.

**Change:** Remove query parameter support from `extractToken()`. The R1 Creation frontend stores the token in `localStorage` on first load (received via QR URL one time), then uses `Authorization: Bearer` for all API calls. SSE connections (which can't set custom headers via `EventSource`) authenticate via a short-lived session cookie set by `POST /auth/session`.

### 1.7 Rate Limiting

**Current:** No rate limiting on any endpoint.

**Change:** Add `@fastify/rate-limit`:

| Scope | Limit | Window |
|-------|-------|--------|
| Global | 100 requests | 1 minute per IP |
| Auth endpoints | 10 requests | 1 minute per IP |
| SSE streams | Exempt | Long-lived connections |

### 1.8 Voice Session Security

**Current:** If no token is provided, voice WebSocket sessions resume by IP address alone with a 7-day grace window.

**Change:** Remove IP-only resumption entirely. All voice connections require a valid device token. R1 stores its token persistently — reconnection re-sends it. Reduce `RECONNECT_GRACE_MS` from 7 days to 1 hour (covers transient network drops; token is still required).

### 1.9 Token Scoping

**Current:** All HTTP tokens have equal, unlimited access.

**Change:** Two tiers:

- **Admin tokens** — full access to all endpoints and groups. Created via `scripts/create-token.ts`. Backwards compatible with existing tokens (`group_jid = NULL`).
- **Device tokens** — scoped to a single group JID. Can only read/send messages for that group. Created when pairing R1 or voice devices.

Implementation: add `group_jid TEXT` column to `http_device_tokens` table. `requireAuth()` middleware checks scope against the requested JID. Admin tokens pass all checks.

## Part 2: Autonomous Engineer

### 2.1 The Development Loop

The main agent operates in a supervised cycle:

```
Observe → Propose → (await approval) → Plan → Execute → Review → Report
```

1. **Observe** — Agent notices something actionable: a direct instruction from you, a scheduled review task, a failing health check, or a backlog item from its own CLAUDE.md
2. **Propose** — Agent sends a short proposal via Telegram: "I'd like to add rate limiting to the HTTP channel. 3 pipeline nodes, ~15 min. Approve?"
3. **Await approval** — You reply `approve N` or `deny N` (existing runtime update approval flow)
4. **Plan** — Agent writes a DOT pipeline graph for Attractor: analyze → implement → test/build
5. **Execute** — Pipeline runs in a git worktree on a feature branch. Each node gets accumulated context from prior nodes (pipeline context accumulation)
6. **Review** — Final pipeline node runs the test suite and self-reviews. Agent reports results
7. **Report** — Summary sent to Telegram: what changed, what passed, what needs attention. You merge the branch or request changes

### 2.2 Proposal IPC Action

New IPC action `propose_work`:

```json
{
  "type": "runtime_update",
  "action": "propose_work",
  "params": {
    "title": "Add rate limiting to HTTP channel",
    "description": "Install @fastify/rate-limit, configure per-endpoint limits, add tests",
    "estimated_nodes": 3,
    "pipeline_dot": "digraph { analyze -> implement -> test }"
  },
  "reason": "Security hardening — HTTP endpoints have no rate limiting"
}
```

Creates a pending runtime update visible in Telegram. On approval, the pipeline DOT is submitted to Attractor automatically. The agent can propose work from:
- Direct instruction (you ask it to do something)
- Scheduled tasks (daily codebase review, dependency audit)
- Self-initiated ideas (backlog in its group CLAUDE.md)

### 2.3 Feature Branch Isolation

All autonomous work happens on git branches, never main.

The pipeline's first node creates `feat/{slug}` from HEAD. The agent gets git credentials via the existing `add-git` skill, scoped to push branches. Force-push and branch deletion are not permitted. When work is complete, the agent opens a PR via `gh` — you merge manually or approve via Telegram.

Combined with git worktrees, the main working directory is never touched during autonomous work. A failed pipeline leaves behind one deletable branch and one removable worktree.

### 2.4 Self-Extension via Skills

The agent extends NanoClaw by writing skills:

1. Agent identifies a capability gap ("I need to read Jira tickets")
2. Proposes via `propose_work` — pipeline creates the skill under `.claude/skills/add-{name}/`
3. Final pipeline node calls `apply_skill` IPC action (goes through approval)
4. After restart, the new capability is live

This is recursive — the agent uses the existing skill system to teach itself new tricks. Every step goes through approval, preventing runaway self-modification.

### 2.5 Resource Requests

When the agent needs something it can't self-serve, it uses a new IPC action `request_resource`:

```json
{
  "type": "runtime_update",
  "action": "request_resource",
  "params": {
    "type": "api_key",
    "service": "openai",
    "estimated_cost": "$0.006/min of audio"
  },
  "reason": "Need Whisper API for voice transcription skill"
}
```

Appears in Telegram as a request. You provide the key (injected via `update_config` → stdin secrets) or deny with a reason. The agent never gets direct access to payment methods — you provision what it asks for.

### 2.6 Revenue Exploration

The agent treats revenue as a backlog item like any other. It might propose:
- Building a SaaS tool and deploying it
- Writing code or content for freelance platforms
- Building and selling integrations/skills

All proposals go through the same approve/deny loop. The agent controls *what* it proposes; you control *whether* it happens. Over time, you can loosen approval requirements for categories of work it's proven reliable at.

## Part 3: Guardrails & Blast Radius

### 3.1 Approval Tiers

Three tiers with configurable assignments:

| Tier | Examples | Gate |
|------|----------|------|
| **Auto-approve** | Read files, run tests, `npm run build`, propose work, health checks | None |
| **Notify** | Create branch, push branch, write skill files, schedule tasks | Telegram notification, no block |
| **Require approval** | Apply skill, merge to main, request resources, request host access, delete data, modify `.env` | Blocks until approve/deny |

Tier assignments stored in `data/approval-tiers.json`. Promotable as trust builds.

### 3.2 Spending Limits

Configurable monthly budget:

```
MONTHLY_SPEND_LIMIT=50
```

Agent tracks estimated costs of approved resource requests in `data/spend-log.json`. When cumulative monthly spend approaches the limit, new requests are auto-denied: "Monthly budget $47/$50 used. Awaiting next cycle or limit increase."

Advisory, not a hard financial control — you still provision API keys and services manually. Gives the agent budget awareness and prevents escalating resource request loops.

### 3.3 Rollback

`runtime-update-executor` already logs every action to `data/runtime-updates.log`. New `rollback` IPC action reverts the last N applied actions:

| Action | Rollback |
|--------|----------|
| `apply_skill` | `git checkout` modified files from pre-skill state |
| `update_config` | Remove `.env` line and env passthrough entry |
| `rebuild_container` | Restore previous image tag (`docker tag`) |

The agent can self-diagnose: if `npm run build` fails after its own changes, it proposes a rollback before asking for help.

### 3.4 Health Checks

Scheduled task, default every 6 hours:

- `npm run build` — does the project compile?
- Container test spawn — can a container start and respond?
- Disk usage — warn if data dirs exceed threshold
- Git status — warn if working tree has unexpected changes

Results posted to Telegram. If critical checks fail, the agent proposes fixes or rollbacks.

### 3.5 Audit Trail

Every autonomous action logged to `data/audit.jsonl`:

```json
{"ts":"2026-03-01T14:30:00Z","action":"propose_work","title":"Add rate limiting","status":"approved","pipeline_id":"abc123"}
{"ts":"2026-03-01T14:31:00Z","action":"push_branch","branch":"feat/rate-limiting","commits":3}
{"ts":"2026-03-01T14:45:00Z","action":"pipeline_complete","pipeline_id":"abc123","nodes":3,"status":"success"}
```

Append-only, outside container mounts. Reviewable at any time via Telegram command or directly.

## Implementation Order

Security hardening first (reduces risk surface before adding autonomy), then autonomy features:

1. Container network isolation (1.1, 1.2)
2. HTTP hardening (1.4–1.8)
3. Secret handling (1.3, 1.9)
4. Proposal and approval system (2.1, 2.2, 3.1)
5. Feature branch pipelines (2.3)
6. Self-extension (2.4)
7. Resource requests and spending (2.5, 3.2)
8. Guardrails (3.3–3.5)
9. Revenue exploration (2.6)
