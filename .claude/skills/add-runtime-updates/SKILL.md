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
