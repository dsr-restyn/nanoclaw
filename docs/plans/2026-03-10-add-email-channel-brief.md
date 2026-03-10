# add-email-channel Skill — Design Brief

## Context

This skill is needed for **autoIntel**, a competitive intelligence product built on NanoClaw. autoIntel agents send weekly CI reports to clients via email and clients reply to ask follow-up questions, refine their competitor lists, or request ad-hoc research. The agent needs to receive those replies as inbound messages — a true two-way email channel.

The autoIntel agent context repo lives at `dsr-restyn/autoIntel`. It defines the agent's behavior (research methodology, report templates, guardrails). This skill provides the email transport layer.

## What to Build

A NanoClaw skills-engine skill (`add-email-channel`) that adds email as a two-way channel, following the same pattern as `add-telegram`.

### Channel Interface

Implement the `Channel` interface from `src/types.ts`:

```typescript
interface Channel {
  name: string;                                          // "email"
  connect(): Promise<void>;                              // Start polling
  sendMessage(jid: string, text: string): Promise<void>; // Send email
  isConnected(): boolean;
  ownsJid(jid: string): boolean;                         // Match "email:*" jids
  disconnect(): Promise<void>;
  setTyping?(jid: string, isTyping: boolean): Promise<void>; // No-op for email
}
```

### Inbound (Polling)

- Poll a Gmail inbox on an interval (configurable, e.g., every 60 seconds)
- Use the Gmail API (same `@anthropic-ai/gmail-mcp` or direct Google API client)
- For each new email:
  1. Extract sender address
  2. Look up which NanoClaw group owns that sender (see Routing below)
  3. Deliver to that group via `onMessage(chatJid, message)`
  4. Mark the email as read / apply a label to avoid reprocessing

### Outbound (Sending)

- When an agent calls `sendMessage(jid, text)`:
  1. Parse the jid to get recipient email(s)
  2. Send via Gmail API (or SMTP — your call on implementation)
  3. Support markdown → HTML conversion for formatted reports
  4. Thread replies correctly (use In-Reply-To / References headers)

### Routing (Sender → Group)

This is the critical piece. Each NanoClaw group that uses email has client contacts in its config. The channel needs to route inbound emails to the correct group.

**Approach:** On connect, scan all registered groups for email contact info. Build a lookup map: `sender_email → group_jid`. When an email arrives, look up the sender and route to the matching group.

**JID format:** `email:{group-identifier}` (e.g., `email:achosa`, matching the pattern of `tg:{chatId}`)

**Where contact info lives:** Each autoIntel client has a `client/config.yaml` with a `contacts` list:

```yaml
contacts:
  - email: stephen.simons@restyn.com
    role: primary
  - email: ben.thresher@restyn.com
    role: cc
```

The channel should read this from each group's directory to build the routing table. The exact mechanism for discovering this config per-group is a design decision — could be:
- A channel-specific config in the group directory (e.g., `groups/{name}/email.yaml`)
- Reading from a known path in the group's mounted volumes
- A new field in NanoClaw's group registration

**Unknown sender handling:** If an email arrives from an address not in any group's contacts, ignore it (don't route to any agent). Optionally log it.

### Skill Package Structure

Follow the existing skill pattern (see `add-telegram` as reference):

```
.claude/skills/add-email-channel/
  manifest.yaml
  SKILL.md                                    # Installation instructions
  add/
    src/channels/email.ts                     # The channel implementation
    src/channels/email.test.ts                # Tests
  modify/
    src/channels/index.ts                     # Add import './email.js'
    src/channels/index.ts.intent.md
    src/config.ts                             # Add EMAIL_* config vars
    src/config.ts.intent.md
```

### Config Variables

At minimum:
- `EMAIL_ENABLED` — boolean, default false
- `EMAIL_POLL_INTERVAL` — seconds between inbox checks, default 60
- `EMAIL_INBOX_ADDRESS` — the inbox to poll (e.g., `reports@restyn.com`)

Gmail credentials: reuse the existing `~/.gmail-mcp/` credential path that NanoClaw already mounts into containers. The channel runs at the orchestrator level though, so it needs credentials on the host.

### What NOT to Build

- No SendGrid/Mailgun — use Gmail API for now (Restyn has a Google Workspace)
- No HTML email composer — markdown text is fine for V1 (agents output markdown)
- No attachment handling — text-only for V1
- No multi-inbox — single inbox, routing by sender

## Key References

| File | What it shows |
|------|--------------|
| `src/channels/telegram.ts` | Reference channel implementation |
| `src/channels/registry.ts` | Channel registration pattern |
| `src/channels/index.ts` | Channel import barrel (you'll modify this) |
| `src/types.ts:82-93` | Channel interface definition |
| `.claude/skills/add-telegram/manifest.yaml` | Reference skill manifest for a channel |
| `dsr-restyn/autoIntel/config/schema.yaml` | Client config schema (contacts field) |
| `dsr-restyn/autoIntel/config/examples/achosa.yaml` | Example client with contact emails |

## Dependencies

- Gmail API client library (e.g., `googleapis` npm package, or reuse gmail-mcp approach)
- Existing Gmail OAuth credentials at `~/.gmail-mcp/`

## Success Criteria

1. Agent can receive an email from a known client contact and respond in-context
2. Agent can send a formatted report via email to client contacts
3. Emails from unknown senders are ignored (no cross-talk)
4. Multiple groups can use the same inbox with correct routing
5. Email threads are maintained (replies stay in the same thread)
