# Agent-Initiated Runtime Updates

## Problem

Containerized agents cannot update the NanoClaw runtime — code, skills, config, or container images. All changes require manual SSH or CLI access.

## Approach

Extend the existing file-based IPC with a new `runtime_update` message type. Any agent can propose an update. The host queues it and asks the human for approval via the originating channel. On approval, the host executes the action and auto-restarts via systemd/launchd if needed.

No new processes or sidecars. Follows the existing NanoClaw pattern: one process, file-based IPC, service manager handles lifecycle.

## IPC Message

Any agent writes to its IPC directory:

```json
{
  "type": "runtime_update",
  "action": "git_pull | apply_skill | update_config | rebuild_container",
  "params": {},
  "reason": "human-readable explanation"
}
```

### Actions

| Action | Params | Requires Restart |
|--------|--------|-----------------|
| `git_pull` | none | yes |
| `apply_skill` | `{ "skill": "path/under/.claude/skills/" }` | yes |
| `update_config` | `{ "key": "SOME_KEY", "value": "..." }` | no (hot-reload) |
| `rebuild_container` | none | yes |

## Approval Flow

1. IPC watcher picks up `runtime_update` request
2. Validates shape (known action, valid params)
3. Stores in SQLite: `runtime_updates` table with `id`, `group`, `action`, `params`, `reason`, `status` (pending), `created_at`
4. Sends message to human on originating channel:
   > Agent **trading** requests: `git_pull` — *upstream has new alpaca skill fixes*. Reply `approve 7` or `deny 7`.
5. Human replies with `approve <id>` or `deny <id>`
6. On deny: marks rejected, notifies agent via IPC input directory
7. On approve: executes action, notifies agent, triggers restart if needed
8. Pending requests expire after 1 hour with no response

One pending request per agent — prevents spam.

## Execution

On approval:

- **`git_pull`**: `git pull --rebase` → `npm install` → `npm run build`
- **`apply_skill`**: `npx tsx scripts/apply-skill.ts <path>` → `npm run build`
- **`update_config`**: append key/value to `.env`, hot-reload config
- **`rebuild_container`**: `./container/build.sh`

Results logged to `data/runtime-updates.log`. Confirmation message sent to human.

### Restart

For actions requiring restart:
1. Drain running containers — active agents finish current response, idle containers killed
2. Process exits with code 0
3. systemd (`Restart=always`) or launchd (`KeepAlive=true`) restarts automatically

## Security

### No arbitrary execution
Only 4 whitelisted actions. No shell injection surface — params are validated, not interpolated.

### Git pull restricted
Only pulls from the configured remote. No custom URLs accepted.

### Skill paths validated
Must exist under `.claude/skills/`. Path traversal blocked.

### Config updates: append-only
- **New keys**: allowed (with approval). Value shown to human in approval message.
- **Existing keys**: rejected outright. No overwrites, even with approval.
- **Agent never sees values**: agent only gets "approved" or "denied" back, never the contents of `.env`.

### Approval is durable
Pending requests stored in SQLite. Survive restarts. Expire after 1 hour.

### One request per agent
An agent with a pending request cannot submit another until the first is resolved.

## Data Model

```sql
CREATE TABLE runtime_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_folder TEXT NOT NULL,
  action TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | denied | expired | failed
  result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
```
