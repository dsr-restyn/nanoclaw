---
name: ntfy-notifications
description: Send push notifications to the user's phone/desktop via ntfy.sh. Use for alerts, reminders, task completions, or anything time-sensitive.
---

# Push Notifications (ntfy.sh)

Send push notifications using the `$NTFY_TOPIC` environment variable.

## Usage

```bash
# Simple notification
curl -d "Meeting in 15 minutes" "https://ntfy.sh/$NTFY_TOPIC"

# With title and priority
curl -H "Title: Reminder" -H "Priority: high" -d "Meeting in 15 minutes" "https://ntfy.sh/$NTFY_TOPIC"

# With tags/emoji
curl -H "Tags: white_check_mark" -d "Report finished" "https://ntfy.sh/$NTFY_TOPIC"

# Low priority (no sound)
curl -H "Priority: low" -d "Background task complete" "https://ntfy.sh/$NTFY_TOPIC"
```

## Priority Levels

| Priority | Effect |
|----------|--------|
| `max`, `urgent` | Persistent notification, vibrate |
| `high` | Sound + notification |
| `default` | Sound + notification |
| `low` | No sound |
| `min` | No sound, no visual |

## When to Use

- Task completions (scheduled tasks, long-running work)
- Reminders the user scheduled
- Alerts about important events
- Anything the user explicitly asks to be notified about

## When NOT to Use

- Regular conversation replies (use `send_message` instead)
- Every single action (notification fatigue)
- Debug/status info (use workspace files instead)
