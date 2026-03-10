# add-email-channel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a two-way Gmail channel to NanoClaw that polls an inbox, routes inbound emails to groups by sender address, and sends threaded replies with role-aware recipients.

**Architecture:** A new `EmailChannel` class implementing the `Channel` interface, following the same self-registration pattern as `TelegramChannel`. The channel polls Gmail via the `googleapis` npm package, builds a routing table from `groups/*/client/config.yaml` contact lists, and sends threaded replies using stored `threadId`/`messageId` state.

**Tech Stack:** TypeScript, `googleapis` npm package (Gmail API), OAuth credentials from `~/.gmail-mcp/`, vitest for tests.

---

### Task 1: Add config variables

**Files:**
- Modify: `src/config.ts`

**Step 1: Write the test**

No dedicated test needed — config exports are validated implicitly by the channel tests in Task 2.

**Step 2: Add EMAIL_* config variables to `src/config.ts`**

Add after the existing `readEnvFile` call at the top, expanding the keys array:

```typescript
// In the existing readEnvFile call, add EMAIL_ENABLED, EMAIL_POLL_INTERVAL, EMAIL_INBOX_ADDRESS
const emailEnv = readEnvFile(['EMAIL_ENABLED', 'EMAIL_POLL_INTERVAL', 'EMAIL_INBOX_ADDRESS']);

export const EMAIL_ENABLED =
  (process.env.EMAIL_ENABLED || emailEnv.EMAIL_ENABLED) === 'true';
export const EMAIL_POLL_INTERVAL = parseInt(
  process.env.EMAIL_POLL_INTERVAL || emailEnv.EMAIL_POLL_INTERVAL || '60',
  10,
) * 1000; // Convert to ms
export const EMAIL_INBOX_ADDRESS =
  process.env.EMAIL_INBOX_ADDRESS || emailEnv.EMAIL_INBOX_ADDRESS || '';
```

**Step 3: Add to `.env.example`**

```
EMAIL_ENABLED=false
EMAIL_POLL_INTERVAL=60
EMAIL_INBOX_ADDRESS=
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Clean compilation

**Step 5: Commit**

```bash
git add src/config.ts .env.example
git commit -m "feat(email): add EMAIL_* config variables"
```

---

### Task 2: Write EmailChannel tests (TDD — red phase)

**Files:**
- Create: `src/channels/email.test.ts`

**Step 1: Write the full test file**

Model after `src/channels/telegram.test.ts`. Mock `googleapis`, `fs`, `os`, `path`, and the registry/config/logger modules. Test structure:

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// --- Mocks ---
vi.mock('./registry.js', () => ({ registerChannel: vi.fn() }));
vi.mock('../env.js', () => ({ readEnvFile: vi.fn(() => ({})) }));
vi.mock('../config.js', () => ({
  ASSISTANT_NAME: 'claw',
  TRIGGER_PATTERN: /^@claw\b/i,
  EMAIL_ENABLED: true,
  EMAIL_POLL_INTERVAL: 60000,
  EMAIL_INBOX_ADDRESS: 'reports@test.com',
  GROUPS_DIR: '/tmp/test-groups',
}));
vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// --- Gmail API mock ---
const mockGmail = {
  users: {
    messages: {
      list: vi.fn(),
      get: vi.fn(),
      modify: vi.fn(),
      send: vi.fn(),
    },
  },
};

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
        on: vi.fn(),
        credentials: {},
      })),
    },
    gmail: vi.fn(() => mockGmail),
  },
}));

// Mock fs for config.yaml reading and credential checks
const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => ''),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ isDirectory: () => true })),
}));
vi.mock('fs', () => ({ default: mockFs, ...mockFs }));

vi.mock('os', () => ({ default: { homedir: () => '/home/testuser' } }));

import { EmailChannel } from './email.js';

// --- Test helpers ---
function createTestOpts() {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: vi.fn(() => ({
      'email:achosa': {
        name: 'Achosa',
        folder: 'achosa',
        trigger: '@claw',
        added_at: '2024-01-01T00:00:00.000Z',
      },
    })),
  };
}

// --- Tests ---
describe('EmailChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --- Channel properties ---
  describe('channel properties', () => {
    it('has name "email"', () => {
      const channel = new EmailChannel(createTestOpts());
      expect(channel.name).toBe('email');
    });
  });

  // --- ownsJid ---
  describe('ownsJid', () => {
    it('owns email: JIDs', () => {
      const channel = new EmailChannel(createTestOpts());
      expect(channel.ownsJid('email:achosa')).toBe(true);
    });

    it('does not own tg: JIDs', () => {
      const channel = new EmailChannel(createTestOpts());
      expect(channel.ownsJid('tg:123456')).toBe(false);
    });

    it('does not own WhatsApp JIDs', () => {
      const channel = new EmailChannel(createTestOpts());
      expect(channel.ownsJid('12345@g.us')).toBe(false);
    });
  });

  // --- Routing table ---
  describe('routing table', () => {
    it('builds routing table from group config.yaml files', () => {
      // Mock GROUPS_DIR contents
      mockFs.readdirSync.mockReturnValue(['achosa'] as any);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        'contacts:\n  - email: stephen@test.com\n    role: primary\n  - email: ben@test.com\n    role: cc\n',
      );

      const channel = new EmailChannel(createTestOpts());
      const table = channel._buildRoutingTable();

      expect(table.get('stephen@test.com')).toEqual({
        groupFolder: 'achosa',
        jid: 'email:achosa',
      });
      expect(table.get('ben@test.com')).toEqual({
        groupFolder: 'achosa',
        jid: 'email:achosa',
      });
    });

    it('ignores groups without config.yaml', () => {
      mockFs.readdirSync.mockReturnValue(['achosa'] as any);
      mockFs.existsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('config.yaml')) return false;
        return true;
      });

      const channel = new EmailChannel(createTestOpts());
      const table = channel._buildRoutingTable();

      expect(table.size).toBe(0);
    });

    it('handles malformed config.yaml gracefully', () => {
      mockFs.readdirSync.mockReturnValue(['achosa'] as any);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('not: valid: yaml: :::');

      const channel = new EmailChannel(createTestOpts());
      const table = channel._buildRoutingTable();

      // Should not throw, returns empty map
      expect(table.size).toBe(0);
    });
  });

  // --- Inbound polling ---
  describe('inbound polling', () => {
    it('delivers email from known sender to correct group', async () => {
      const opts = createTestOpts();
      mockFs.readdirSync.mockReturnValue(['achosa'] as any);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('config.yaml')) {
          return 'contacts:\n  - email: stephen@test.com\n    role: primary\n';
        }
        if (typeof p === 'string' && p.includes('gcp-oauth')) {
          return JSON.stringify({ installed: { client_id: 'id', client_secret: 'secret' } });
        }
        if (typeof p === 'string' && p.includes('credentials')) {
          return JSON.stringify({ access_token: 'token', refresh_token: 'refresh' });
        }
        return '';
      });

      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-1', threadId: 'thread-1' }] },
      });
      mockGmail.users.messages.get.mockResolvedValue({
        data: {
          id: 'msg-1',
          threadId: 'thread-1',
          payload: {
            headers: [
              { name: 'From', value: 'stephen@test.com' },
              { name: 'Subject', value: 'Question about report' },
              { name: 'Date', value: 'Mon, 10 Mar 2026 09:00:00 +0000' },
              { name: 'Message-ID', value: '<msg-1@mail.test.com>' },
            ],
            body: { data: Buffer.from('Hello, can you update the competitor list?').toString('base64url') },
          },
        },
      });
      mockGmail.users.messages.modify.mockResolvedValue({});

      const channel = new EmailChannel(opts);
      await channel._pollOnce();

      expect(opts.onMessage).toHaveBeenCalledWith(
        'email:achosa',
        expect.objectContaining({
          chat_jid: 'email:achosa',
          content: expect.stringContaining('Hello, can you update the competitor list?'),
        }),
      );
    });

    it('ignores emails from unknown senders', async () => {
      const opts = createTestOpts();
      mockFs.readdirSync.mockReturnValue(['achosa'] as any);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('config.yaml')) {
          return 'contacts:\n  - email: stephen@test.com\n    role: primary\n';
        }
        if (typeof p === 'string' && p.includes('gcp-oauth')) {
          return JSON.stringify({ installed: { client_id: 'id', client_secret: 'secret' } });
        }
        if (typeof p === 'string' && p.includes('credentials')) {
          return JSON.stringify({ access_token: 'token', refresh_token: 'refresh' });
        }
        return '';
      });

      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-2', threadId: 'thread-2' }] },
      });
      mockGmail.users.messages.get.mockResolvedValue({
        data: {
          id: 'msg-2',
          threadId: 'thread-2',
          payload: {
            headers: [
              { name: 'From', value: 'unknown@spam.com' },
              { name: 'Subject', value: 'Spam' },
              { name: 'Date', value: 'Mon, 10 Mar 2026 09:00:00 +0000' },
            ],
            body: { data: Buffer.from('Buy now!').toString('base64url') },
          },
        },
      });

      const channel = new EmailChannel(opts);
      await channel._pollOnce();

      expect(opts.onMessage).not.toHaveBeenCalled();
    });

    it('marks processed emails as read', async () => {
      const opts = createTestOpts();
      mockFs.readdirSync.mockReturnValue(['achosa'] as any);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('config.yaml')) {
          return 'contacts:\n  - email: stephen@test.com\n    role: primary\n';
        }
        if (typeof p === 'string' && p.includes('gcp-oauth')) {
          return JSON.stringify({ installed: { client_id: 'id', client_secret: 'secret' } });
        }
        if (typeof p === 'string' && p.includes('credentials')) {
          return JSON.stringify({ access_token: 'token', refresh_token: 'refresh' });
        }
        return '';
      });

      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-3', threadId: 'thread-3' }] },
      });
      mockGmail.users.messages.get.mockResolvedValue({
        data: {
          id: 'msg-3',
          threadId: 'thread-3',
          payload: {
            headers: [
              { name: 'From', value: 'stephen@test.com' },
              { name: 'Subject', value: 'Test' },
              { name: 'Date', value: 'Mon, 10 Mar 2026 09:00:00 +0000' },
            ],
            body: { data: Buffer.from('Test body').toString('base64url') },
          },
        },
      });
      mockGmail.users.messages.modify.mockResolvedValue({});

      const channel = new EmailChannel(opts);
      await channel._pollOnce();

      expect(mockGmail.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg-3',
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    });
  });

  // --- Outbound sending ---
  describe('sendMessage', () => {
    it('sends email to primary contacts and CCs cc contacts', async () => {
      mockFs.readdirSync.mockReturnValue(['achosa'] as any);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('config.yaml')) {
          return 'contacts:\n  - email: stephen@test.com\n    role: primary\n  - email: ben@test.com\n    role: cc\n';
        }
        if (typeof p === 'string' && p.includes('gcp-oauth')) {
          return JSON.stringify({ installed: { client_id: 'id', client_secret: 'secret' } });
        }
        if (typeof p === 'string' && p.includes('credentials')) {
          return JSON.stringify({ access_token: 'token', refresh_token: 'refresh' });
        }
        return '';
      });

      mockGmail.users.messages.send.mockResolvedValue({
        data: { id: 'sent-1', threadId: 'thread-1' },
      });

      const channel = new EmailChannel(createTestOpts());
      await channel.sendMessage('email:achosa', 'Here is your weekly report.');

      expect(mockGmail.users.messages.send).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'me',
          requestBody: expect.objectContaining({
            raw: expect.any(String),
          }),
        }),
      );
    });

    it('does nothing for unknown group folder', async () => {
      mockFs.readdirSync.mockReturnValue([] as any);
      mockFs.existsSync.mockReturnValue(false);

      const channel = new EmailChannel(createTestOpts());
      await channel.sendMessage('email:nonexistent', 'Test');

      expect(mockGmail.users.messages.send).not.toHaveBeenCalled();
    });
  });

  // --- Threading ---
  describe('threading', () => {
    it('stores threadId from inbound and uses it for replies', async () => {
      const opts = createTestOpts();
      mockFs.readdirSync.mockReturnValue(['achosa'] as any);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('config.yaml')) {
          return 'contacts:\n  - email: stephen@test.com\n    role: primary\n';
        }
        if (typeof p === 'string' && p.includes('gcp-oauth')) {
          return JSON.stringify({ installed: { client_id: 'id', client_secret: 'secret' } });
        }
        if (typeof p === 'string' && p.includes('credentials')) {
          return JSON.stringify({ access_token: 'token', refresh_token: 'refresh' });
        }
        return '';
      });

      // Simulate inbound email
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-t1', threadId: 'thread-t1' }] },
      });
      mockGmail.users.messages.get.mockResolvedValue({
        data: {
          id: 'msg-t1',
          threadId: 'thread-t1',
          payload: {
            headers: [
              { name: 'From', value: 'stephen@test.com' },
              { name: 'Subject', value: 'CI Report Question' },
              { name: 'Date', value: 'Mon, 10 Mar 2026 09:00:00 +0000' },
              { name: 'Message-ID', value: '<msg-t1@mail.test.com>' },
            ],
            body: { data: Buffer.from('Question here').toString('base64url') },
          },
        },
      });
      mockGmail.users.messages.modify.mockResolvedValue({});
      mockGmail.users.messages.send.mockResolvedValue({
        data: { id: 'sent-t1', threadId: 'thread-t1' },
      });

      const channel = new EmailChannel(opts);
      await channel._pollOnce();

      // Now send a reply — should use stored thread
      await channel.sendMessage('email:achosa', 'Here is the updated info.');

      const sendCall = mockGmail.users.messages.send.mock.calls[0][0];
      expect(sendCall.requestBody.threadId).toBe('thread-t1');
    });
  });

  // --- Connection lifecycle ---
  describe('connection lifecycle', () => {
    it('isConnected returns false before connect', () => {
      const channel = new EmailChannel(createTestOpts());
      expect(channel.isConnected()).toBe(false);
    });

    it('disconnect stops polling', async () => {
      const channel = new EmailChannel(createTestOpts());
      // Simulate connected state
      (channel as any).connected = true;
      await channel.disconnect();
      expect(channel.isConnected()).toBe(false);
    });
  });

  // --- setTyping ---
  describe('setTyping', () => {
    it('is a no-op (email has no typing indicator)', async () => {
      const channel = new EmailChannel(createTestOpts());
      // Should not throw
      await channel.setTyping?.('email:achosa', true);
    });
  });
});
```

**Step 2: Run the tests to see them fail**

Run: `npx vitest run src/channels/email.test.ts`
Expected: FAIL — `Cannot find module './email.js'`

**Step 3: Commit**

```bash
git add src/channels/email.test.ts
git commit -m "test(email): add failing tests for EmailChannel"
```

---

### Task 3: Implement EmailChannel (TDD — green phase)

**Files:**
- Create: `src/channels/email.ts`

**Step 1: Install googleapis dependency**

Run: `npm install googleapis`

**Step 2: Write the EmailChannel implementation**

```typescript
import fs from 'fs';
import os from 'os';
import path from 'path';

import { google } from 'googleapis';

import { EMAIL_INBOX_ADDRESS, EMAIL_POLL_INTERVAL, GROUPS_DIR } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

interface RoutingEntry {
  groupFolder: string;
  jid: string;
}

interface ContactInfo {
  email: string;
  role: 'primary' | 'cc';
}

interface ThreadState {
  threadId: string;
  messageId: string;
  subject: string;
}

export interface EmailChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class EmailChannel implements Channel {
  name = 'email';

  private opts: EmailChannelOpts;
  private gmail: ReturnType<typeof google.gmail> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private threadState = new Map<string, ThreadState>(); // groupFolder → last thread

  constructor(opts: EmailChannelOpts) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    const homeDir = process.env.HOME || os.homedir();
    const keysPath = path.join(homeDir, '.gmail-mcp', 'gcp-oauth.keys.json');
    const credPath = path.join(homeDir, '.gmail-mcp', 'credentials.json');

    const keys = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));

    const clientId = keys.installed?.client_id || keys.web?.client_id;
    const clientSecret = keys.installed?.client_secret || keys.web?.client_secret;

    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials(creds);

    // Auto-save refreshed tokens
    auth.on('tokens', (tokens: any) => {
      const existing = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
      const updated = { ...existing, ...tokens };
      fs.writeFileSync(credPath, JSON.stringify(updated, null, 2));
      logger.debug('Gmail OAuth tokens refreshed');
    });

    this.gmail = google.gmail({ version: 'v1', auth });
    this.connected = true;

    // Start polling
    this.pollTimer = setInterval(() => {
      this._pollOnce().catch((err) => {
        logger.error({ err }, 'Email poll error');
      });
    }, EMAIL_POLL_INTERVAL);

    logger.info(
      { inbox: EMAIL_INBOX_ADDRESS, interval: EMAIL_POLL_INTERVAL / 1000 },
      'Email channel connected',
    );
  }

  async _pollOnce(): Promise<void> {
    if (!this.gmail) return;

    const routingTable = this._buildRoutingTable();
    if (routingTable.size === 0) return;

    // Fetch unread messages
    const res = await this.gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
      maxResults: 20,
    });

    const messages = res.data.messages || [];
    if (messages.length === 0) return;

    logger.debug({ count: messages.length }, 'Email: unread messages found');

    for (const msgRef of messages) {
      try {
        const msg = await this.gmail.users.messages.get({
          userId: 'me',
          id: msgRef.id!,
          format: 'full',
        });

        const headers = msg.data.payload?.headers || [];
        const fromHeader = headers.find((h: any) => h.name?.toLowerCase() === 'from')?.value || '';
        const subject = headers.find((h: any) => h.name?.toLowerCase() === 'subject')?.value || '';
        const dateHeader = headers.find((h: any) => h.name?.toLowerCase() === 'date')?.value || '';
        const messageId = headers.find((h: any) => h.name?.toLowerCase() === 'message-id')?.value || '';

        // Extract email address from "Name <email>" or bare "email"
        const senderEmail = extractEmail(fromHeader);
        if (!senderEmail) {
          logger.debug({ from: fromHeader }, 'Email: could not extract sender');
          continue;
        }

        const route = routingTable.get(senderEmail.toLowerCase());
        if (!route) {
          logger.debug({ sender: senderEmail }, 'Email: unknown sender, ignoring');
          // Still mark as read to avoid reprocessing
          await this.gmail.users.messages.modify({
            userId: 'me',
            id: msgRef.id!,
            requestBody: { removeLabelIds: ['UNREAD'] },
          });
          continue;
        }

        // Extract body text
        const body = extractTextBody(msg.data.payload);

        // Store thread state for replies
        if (msg.data.threadId) {
          this.threadState.set(route.groupFolder, {
            threadId: msg.data.threadId,
            messageId,
            subject,
          });
        }

        const timestamp = dateHeader
          ? new Date(dateHeader).toISOString()
          : new Date().toISOString();

        // Report metadata
        this.opts.onChatMetadata(
          route.jid,
          timestamp,
          route.groupFolder,
          'email',
          false,
        );

        // Deliver message
        this.opts.onMessage(route.jid, {
          id: msgRef.id!,
          chat_jid: route.jid,
          sender: senderEmail,
          sender_name: extractName(fromHeader) || senderEmail,
          content: body,
          timestamp,
          is_from_me: false,
        });

        logger.info(
          { sender: senderEmail, group: route.groupFolder, subject },
          'Email delivered to group',
        );

        // Mark as read
        await this.gmail.users.messages.modify({
          userId: 'me',
          id: msgRef.id!,
          requestBody: { removeLabelIds: ['UNREAD'] },
        });
      } catch (err) {
        logger.error({ msgId: msgRef.id, err }, 'Email: failed to process message');
      }
    }
  }

  /**
   * Build routing table: sender email → { groupFolder, jid }
   * Scans groups/*/client/config.yaml for contacts.
   * @internal — exported for testing
   */
  _buildRoutingTable(): Map<string, RoutingEntry> {
    const table = new Map<string, RoutingEntry>();

    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(GROUPS_DIR);
    } catch {
      return table;
    }

    for (const folder of groupFolders) {
      const configPath = path.join(GROUPS_DIR, folder, 'client', 'config.yaml');
      if (!fs.existsSync(configPath)) continue;

      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const contacts = parseContactsFromYaml(content);
        const jid = `email:${folder}`;

        for (const contact of contacts) {
          table.set(contact.email.toLowerCase(), {
            groupFolder: folder,
            jid,
          });
        }
      } catch (err) {
        logger.warn({ folder, err }, 'Email: failed to parse config.yaml');
      }
    }

    return table;
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.gmail) {
      logger.warn('Email: Gmail not initialized');
      return;
    }

    const groupFolder = jid.replace(/^email:/, '');
    const configPath = path.join(GROUPS_DIR, groupFolder, 'client', 'config.yaml');

    if (!fs.existsSync(configPath)) {
      logger.warn({ jid }, 'Email: no config.yaml for group');
      return;
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const contacts = parseContactsFromYaml(content);

      const toAddresses = contacts
        .filter((c) => c.role === 'primary')
        .map((c) => c.email);
      const ccAddresses = contacts
        .filter((c) => c.role === 'cc')
        .map((c) => c.email);

      if (toAddresses.length === 0) {
        logger.warn({ jid }, 'Email: no primary contacts found');
        return;
      }

      const thread = this.threadState.get(groupFolder);
      const subject = thread?.subject
        ? (thread.subject.startsWith('Re: ') ? thread.subject : `Re: ${thread.subject}`)
        : `Report — ${groupFolder}`;

      // Build RFC 2822 email
      const lines: string[] = [
        `From: ${EMAIL_INBOX_ADDRESS}`,
        `To: ${toAddresses.join(', ')}`,
      ];
      if (ccAddresses.length > 0) {
        lines.push(`Cc: ${ccAddresses.join(', ')}`);
      }
      lines.push(`Subject: ${subject}`);

      // Threading headers
      if (thread?.messageId) {
        lines.push(`In-Reply-To: ${thread.messageId}`);
        lines.push(`References: ${thread.messageId}`);
      }

      lines.push('Content-Type: text/plain; charset=UTF-8');
      lines.push('');
      lines.push(text);

      const raw = Buffer.from(lines.join('\r\n')).toString('base64url');

      const sendResult = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw,
          threadId: thread?.threadId,
        },
      });

      // Update thread state with sent message
      if (sendResult.data.threadId) {
        this.threadState.set(groupFolder, {
          threadId: sendResult.data.threadId,
          messageId: sendResult.data.id || '',
          subject,
        });
      }

      logger.info(
        { jid, to: toAddresses, cc: ccAddresses, threadId: thread?.threadId },
        'Email sent',
      );
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send email');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('email:');
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.connected = false;
    this.gmail = null;
    logger.info('Email channel disconnected');
  }

  async setTyping(_jid: string, _isTyping: boolean): Promise<void> {
    // No-op: email has no typing indicator
  }
}

/** Extract email from "Name <email@host.com>" or bare "email@host.com" */
function extractEmail(from: string): string | null {
  const angleMatch = from.match(/<([^>]+)>/);
  if (angleMatch) return angleMatch[1];
  const bareMatch = from.match(/[\w.-]+@[\w.-]+/);
  return bareMatch ? bareMatch[0] : null;
}

/** Extract display name from "Name <email@host.com>" */
function extractName(from: string): string | null {
  const match = from.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : null;
}

/** Parse contacts from a YAML config string (minimal parser — avoids yaml dep) */
function parseContactsFromYaml(content: string): ContactInfo[] {
  const contacts: ContactInfo[] = [];
  const lines = content.split('\n');
  let inContacts = false;
  let currentEmail = '';

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === 'contacts:') {
      inContacts = true;
      continue;
    }

    if (inContacts) {
      // End of contacts block (new top-level key)
      if (/^\w+:/.test(trimmed) && !trimmed.startsWith('- ') && !trimmed.startsWith('email:') && !trimmed.startsWith('role:')) {
        break;
      }

      const emailMatch = trimmed.match(/^-?\s*email:\s*(.+)/);
      if (emailMatch) {
        currentEmail = emailMatch[1].trim().replace(/^["']|["']$/g, '');
        continue;
      }

      const roleMatch = trimmed.match(/^role:\s*(.+)/);
      if (roleMatch && currentEmail) {
        const role = roleMatch[1].trim().replace(/^["']|["']$/g, '') as 'primary' | 'cc';
        contacts.push({ email: currentEmail, role });
        currentEmail = '';
      }
    }
  }

  return contacts;
}

/** Extract text/plain body from Gmail message payload (handles multipart) */
function extractTextBody(payload: any): string {
  if (!payload) return '';

  // Direct body
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }

  // Multipart — find text/plain part
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractTextBody(part);
      if (text) return text;
    }
  }

  // Fallback: decode whatever body data exists
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }

  return '';
}

// Self-register
registerChannel('email', (opts: ChannelOpts) => {
  const env = readEnvFile(['EMAIL_ENABLED', 'EMAIL_INBOX_ADDRESS']);
  const enabled = (process.env.EMAIL_ENABLED || env.EMAIL_ENABLED) === 'true';
  if (!enabled) return null;

  const homeDir = process.env.HOME || os.homedir();
  const credPath = path.join(homeDir, '.gmail-mcp', 'credentials.json');
  if (!fs.existsSync(credPath)) {
    logger.warn('Email: Gmail credentials not found at ~/.gmail-mcp/');
    return null;
  }

  return new EmailChannel(opts);
});
```

**Step 3: Register in barrel file**

Add to `src/channels/index.ts`:

```typescript
// email
import './email.js';
```

**Step 4: Run the tests**

Run: `npx vitest run src/channels/email.test.ts`
Expected: All tests PASS

**Step 5: Run full test suite and build**

Run: `npm test && npm run build`
Expected: All pass, clean build

**Step 6: Commit**

```bash
git add src/channels/email.ts src/channels/email.test.ts src/channels/index.ts package.json package-lock.json
git commit -m "feat(email): implement EmailChannel with Gmail polling and threaded replies"
```

---

### Task 4: Build the skill package

**Files:**
- Create: `.claude/skills/add-email-channel/manifest.yaml`
- Create: `.claude/skills/add-email-channel/SKILL.md`
- Create: `.claude/skills/add-email-channel/add/src/channels/email.ts` (copy from src)
- Create: `.claude/skills/add-email-channel/add/src/channels/email.test.ts` (copy from src)
- Create: `.claude/skills/add-email-channel/modify/src/channels/index.ts` (modified version)
- Create: `.claude/skills/add-email-channel/modify/src/channels/index.ts.intent.md`
- Create: `.claude/skills/add-email-channel/modify/src/config.ts` (modified version)
- Create: `.claude/skills/add-email-channel/modify/src/config.ts.intent.md`

**Step 1: Create manifest.yaml**

```yaml
skill: email-channel
version: 1.0.0
description: "Gmail two-way email channel with sender-based group routing"
core_version: 0.1.0
adds:
  - src/channels/email.ts
  - src/channels/email.test.ts
modifies:
  - src/channels/index.ts
  - src/config.ts
structured:
  npm_dependencies:
    googleapis: "^148.0.0"
  env_additions:
    - EMAIL_ENABLED
    - EMAIL_POLL_INTERVAL
    - EMAIL_INBOX_ADDRESS
conflicts: []
depends: []
test: "npx vitest run src/channels/email.test.ts"
```

**Step 2: Create intent files**

`modify/src/channels/index.ts.intent.md`:
```markdown
# Intent: src/channels/index.ts modifications

## What changed
Added email channel import for self-registration.

## Key sections
- Added: `import './email.js'` under the `// email` comment

## Invariants
- All existing channel imports preserved
- Comment structure preserved
```

`modify/src/config.ts.intent.md`:
```markdown
# Intent: src/config.ts modifications

## What changed
Added EMAIL_ENABLED, EMAIL_POLL_INTERVAL, EMAIL_INBOX_ADDRESS config exports.

## Key sections
- Added: `readEnvFile` call for email config keys
- Added: Three new exports (`EMAIL_ENABLED`, `EMAIL_POLL_INTERVAL`, `EMAIL_INBOX_ADDRESS`)

## Invariants
- All existing config exports unchanged
- readEnvFile pattern matches existing usage
```

**Step 3: Create SKILL.md**

Write interactive setup instructions following the add-telegram pattern: credential check, .env config, build & restart, registration, verification.

**Step 4: Copy source files to skill package**

Copy `src/channels/email.ts` → `add/src/channels/email.ts`
Copy `src/channels/email.test.ts` → `add/src/channels/email.test.ts`
Copy modified `src/channels/index.ts` → `modify/src/channels/index.ts`
Copy modified `src/config.ts` → `modify/src/config.ts`

**Step 5: Commit**

```bash
git add .claude/skills/add-email-channel/
git commit -m "feat(skills): add-email-channel skill package"
```

---

### Task 5: Manual integration test

**Step 1: Add test config to .env**

```
EMAIL_ENABLED=true
EMAIL_INBOX_ADDRESS=reports@restyn.com
EMAIL_POLL_INTERVAL=60
```

**Step 2: Verify Gmail credentials exist**

```bash
ls ~/.gmail-mcp/gcp-oauth.keys.json ~/.gmail-mcp/credentials.json
```

**Step 3: Create a test group with email contacts**

```bash
mkdir -p groups/test-email/client
cat > groups/test-email/client/config.yaml << 'EOF'
company:
  name: Test Company
contacts:
  - email: your-email@example.com
    role: primary
EOF
```

**Step 4: Register the group**

```bash
npx tsx -e "
import { initDatabase, setRegisteredGroup } from './dist/db.js';
initDatabase();
setRegisteredGroup('email:test-email', {
  name: 'Test Email',
  folder: 'test-email',
  trigger: '@claw',
  added_at: new Date().toISOString(),
  requiresTrigger: false,
});
"
```

**Step 5: Run and verify**

```bash
npm run dev
```

Expected: Logs show "Email channel connected" with inbox address and poll interval. Sending an email to the inbox from the registered contact should trigger a message delivery.

**Step 6: Clean up test group (if needed)**

```bash
rm -rf groups/test-email
```

---

## Summary

| Task | What | Est. |
|------|------|------|
| 1 | Config variables | Config-only |
| 2 | Write tests (red) | TDD red phase |
| 3 | Implement EmailChannel (green) | Core implementation |
| 4 | Build skill package | Packaging |
| 5 | Integration test | Verification |
