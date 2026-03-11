# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/whatsapp.ts` | WhatsApp connection, auth, send/receive |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/agent-browser.md` | Browser automation tool (available to all agents via Bash) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update` | Pull upstream NanoClaw changes, merge with customizations, run migrations |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart

# Linux (systemd)
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
```

## Skill Development Rules

When creating or modifying skill packages (`.claude/skills/<name>/`):

1. **Skills are applied in a fixed order.** Each skill's modify/ files must be a complete snapshot of the file after that skill AND all prior skills are applied — but never include changes from later skills. Application order: email-channel → autointel → oauth-refresh.
2. **Build modify/ files incrementally**, not from the working tree. Start from `git show HEAD:<path>`, apply prior skills' changes, then add yours. The working tree has ALL skills applied and will contaminate modify/ files.
3. **Validate add/ imports against HEAD.** If an add/ file imports a module, verify it exists at HEAD or is in your skill's add/ list. Never import from another skill's added files unless you declare a dependency.
4. **Always include intent files** (`<path>.intent.md`) for each modify/ file. Document what changed, invariants, and which prior skills are included.
5. **Run validation before committing:** `npx tsx scripts/validate-skill.ts .claude/skills/<name>`
6. **Never commit src/ changes directly.** Integrations exist as skills that agents apply at runtime, not as committed source. Only `.claude/skills/` files are committed.

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.
