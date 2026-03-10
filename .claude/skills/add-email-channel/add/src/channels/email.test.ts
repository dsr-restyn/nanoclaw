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

const gmailMock = vi.hoisted(() => ({
  users: {
    messages: {
      list: vi.fn().mockResolvedValue({ data: { messages: [] } }),
      get: vi.fn().mockResolvedValue({ data: {} }),
      modify: vi.fn().mockResolvedValue({}),
      send: vi.fn().mockResolvedValue({ data: { id: 'sent-1', threadId: 'thread-1' } }),
    },
  },
}));

const authMock = vi.hoisted(() => ({
  setCredentials: vi.fn(),
  on: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class MockOAuth2 {
        constructor() {
          Object.assign(this, authMock);
        }
      },
    },
    gmail: vi.fn(() => gmailMock),
  },
}));

// --- fs mock ---

const fsMock = vi.hoisted(() => {
  const _files = new Map<string, string>();
  return {
    _files,
    _setFile(path: string, content: string) {
      _files.set(path, content);
    },
    _clear() {
      _files.clear();
    },
    readFileSync: vi.fn((filePath: string) => {
      const content = _files.get(filePath);
      if (content === undefined) {
        const err: any = new Error(`ENOENT: no such file: ${filePath}`);
        err.code = 'ENOENT';
        throw err;
      }
      return content;
    }),
    writeFileSync: vi.fn(),
    existsSync: vi.fn((filePath: string) => _files.has(filePath)),
    readdirSync: vi.fn((_dirPath: string) => {
      // Return folder names from _files that look like GROUPS_DIR/folder/...
      const prefix = '/tmp/test-groups/';
      const folders = new Set<string>();
      for (const key of _files.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const folder = rest.split('/')[0];
          if (folder) folders.add(folder);
        }
      }
      return [...folders];
    }),
  };
});

vi.mock('fs', () => ({
  default: {
    readFileSync: fsMock.readFileSync,
    writeFileSync: fsMock.writeFileSync,
    existsSync: fsMock.existsSync,
    readdirSync: fsMock.readdirSync,
  },
}));

vi.mock('os', () => ({
  default: {
    homedir: () => '/home/testuser',
  },
}));

// path: use real path module
vi.mock('path', async () => {
  const actual: any = await vi.importActual('path');
  return { default: actual.default ?? actual };
});

import { EmailChannel, EmailChannelOpts } from './email.js';

// --- Test helpers ---

function createTestOpts(overrides?: Partial<EmailChannelOpts>): EmailChannelOpts {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    ...overrides,
  };
}

function setupGmailCreds() {
  fsMock._setFile('/home/testuser/.gmail-mcp/gcp-oauth.keys.json', JSON.stringify({
    installed: {
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
      redirect_uris: ['http://localhost'],
    },
  }));
  fsMock._setFile('/home/testuser/.gmail-mcp/credentials.json', JSON.stringify({
    access_token: 'test-access',
    refresh_token: 'test-refresh',
  }));
}

function setupGroupConfig(folder: string, yaml: string) {
  fsMock._setFile(`/tmp/test-groups/${folder}/client/config.yaml`, yaml);
}

const SAMPLE_YAML = `contacts:
  - email: stephen@test.com
    role: primary
  - email: ben@test.com
    role: cc
`;

function makeGmailMessage(opts: {
  id?: string;
  threadId?: string;
  from?: string;
  subject?: string;
  date?: string;
  messageId?: string;
  bodyData?: string;
}) {
  const body = opts.bodyData
    ? Buffer.from(opts.bodyData).toString('base64url')
    : Buffer.from('Hello from email').toString('base64url');

  return {
    data: {
      id: opts.id || 'msg-1',
      threadId: opts.threadId || 'thread-1',
      payload: {
        headers: [
          { name: 'From', value: opts.from || 'Stephen <stephen@test.com>' },
          { name: 'Subject', value: opts.subject || 'Test Subject' },
          { name: 'Date', value: opts.date || 'Mon, 10 Mar 2026 12:00:00 +0000' },
          { name: 'Message-ID', value: opts.messageId || '<msg-1@test.com>' },
        ],
        body: { data: body },
      },
    },
  };
}

// --- Tests ---

describe('EmailChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock._clear();
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

    it('owns email: JIDs with dashes', () => {
      const channel = new EmailChannel(createTestOpts());
      expect(channel.ownsJid('email:my-group')).toBe(true);
    });

    it('does not own tg: JIDs', () => {
      const channel = new EmailChannel(createTestOpts());
      expect(channel.ownsJid('tg:123456')).toBe(false);
    });

    it('does not own WhatsApp JIDs', () => {
      const channel = new EmailChannel(createTestOpts());
      expect(channel.ownsJid('12345@g.us')).toBe(false);
    });

    it('does not own unknown JID formats', () => {
      const channel = new EmailChannel(createTestOpts());
      expect(channel.ownsJid('random-string')).toBe(false);
    });
  });

  // --- Routing table ---

  describe('routing table', () => {
    it('builds routing table from config.yaml contacts', () => {
      setupGroupConfig('achosa', SAMPLE_YAML);

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

    it('handles multiple groups', () => {
      setupGroupConfig('group1', `contacts:\n  - email: alice@test.com\n    role: primary\n`);
      setupGroupConfig('group2', `contacts:\n  - email: bob@test.com\n    role: primary\n`);

      const channel = new EmailChannel(createTestOpts());
      const table = channel._buildRoutingTable();

      expect(table.get('alice@test.com')?.groupFolder).toBe('group1');
      expect(table.get('bob@test.com')?.groupFolder).toBe('group2');
    });

    it('ignores groups without config.yaml', () => {
      // group 'empty' exists (has files) but no config.yaml
      fsMock._setFile('/tmp/test-groups/empty/CLAUDE.md', 'some content');

      const channel = new EmailChannel(createTestOpts());
      const table = channel._buildRoutingTable();

      expect(table.size).toBe(0);
    });

    it('handles malformed YAML gracefully', () => {
      setupGroupConfig('bad', 'this is not yaml\nno contacts here\n');

      const channel = new EmailChannel(createTestOpts());
      const table = channel._buildRoutingTable();

      expect(table.size).toBe(0);
    });

    it('lowercases email addresses', () => {
      setupGroupConfig('achosa', `contacts:\n  - email: UPPER@TEST.COM\n    role: primary\n`);

      const channel = new EmailChannel(createTestOpts());
      const table = channel._buildRoutingTable();

      expect(table.has('upper@test.com')).toBe(true);
    });

    it('returns empty table when groups dir does not exist', () => {
      // readdirSync will return [] since no files in _files
      const channel = new EmailChannel(createTestOpts());
      const table = channel._buildRoutingTable();

      expect(table.size).toBe(0);
    });
  });

  // --- Contact parsing ---

  describe('contact parsing', () => {
    it('parses contacts with roles', () => {
      const channel = new EmailChannel(createTestOpts());
      const contacts = channel._parseContacts(SAMPLE_YAML);

      expect(contacts).toEqual([
        { email: 'stephen@test.com', role: 'primary' },
        { email: 'ben@test.com', role: 'cc' },
      ]);
    });

    it('defaults role to primary when missing', () => {
      const channel = new EmailChannel(createTestOpts());
      const contacts = channel._parseContacts(`contacts:\n  - email: solo@test.com\n`);

      expect(contacts).toEqual([{ email: 'solo@test.com', role: 'primary' }]);
    });

    it('returns empty array for YAML without contacts', () => {
      const channel = new EmailChannel(createTestOpts());
      const contacts = channel._parseContacts('name: test\nother: stuff\n');

      expect(contacts).toEqual([]);
    });
  });

  // --- Inbound polling ---

  describe('inbound polling', () => {
    it('delivers known sender to correct group', async () => {
      setupGroupConfig('achosa', SAMPLE_YAML);

      const opts = createTestOpts();
      const channel = new EmailChannel(opts);

      gmailMock.users.messages.list.mockResolvedValueOnce({
        data: { messages: [{ id: 'msg-1' }] },
      });
      gmailMock.users.messages.get.mockResolvedValueOnce(makeGmailMessage({
        from: 'Stephen <stephen@test.com>',
      }));

      // Assign gmail directly for testing without connect()
      (channel as any).gmail = gmailMock;

      await channel._pollOnce();

      expect(opts.onMessage).toHaveBeenCalledWith(
        'email:achosa',
        expect.objectContaining({
          id: 'msg-1',
          chat_jid: 'email:achosa',
          sender: 'stephen@test.com',
          sender_name: 'Stephen',
          content: 'Hello from email',
          is_from_me: false,
        }),
      );
    });

    it('calls onChatMetadata for known senders', async () => {
      setupGroupConfig('achosa', SAMPLE_YAML);

      const opts = createTestOpts();
      const channel = new EmailChannel(opts);
      (channel as any).gmail = gmailMock;

      gmailMock.users.messages.list.mockResolvedValueOnce({
        data: { messages: [{ id: 'msg-1' }] },
      });
      gmailMock.users.messages.get.mockResolvedValueOnce(makeGmailMessage({}));

      await channel._pollOnce();

      expect(opts.onChatMetadata).toHaveBeenCalledWith(
        'email:achosa',
        expect.any(String),
        'Stephen',
        'email',
        false,
      );
    });

    it('ignores unknown senders and marks as read', async () => {
      setupGroupConfig('achosa', SAMPLE_YAML);

      const opts = createTestOpts();
      const channel = new EmailChannel(opts);
      (channel as any).gmail = gmailMock;

      gmailMock.users.messages.list.mockResolvedValueOnce({
        data: { messages: [{ id: 'msg-2' }] },
      });
      gmailMock.users.messages.get.mockResolvedValueOnce(makeGmailMessage({
        id: 'msg-2',
        from: 'Unknown <unknown@nowhere.com>',
      }));

      await channel._pollOnce();

      expect(opts.onMessage).not.toHaveBeenCalled();
      expect(gmailMock.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg-2',
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    });

    it('marks delivered messages as read', async () => {
      setupGroupConfig('achosa', SAMPLE_YAML);

      const opts = createTestOpts();
      const channel = new EmailChannel(opts);
      (channel as any).gmail = gmailMock;

      gmailMock.users.messages.list.mockResolvedValueOnce({
        data: { messages: [{ id: 'msg-1' }] },
      });
      gmailMock.users.messages.get.mockResolvedValueOnce(makeGmailMessage({}));

      await channel._pollOnce();

      expect(gmailMock.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg-1',
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    });

    it('handles empty inbox gracefully', async () => {
      const opts = createTestOpts();
      const channel = new EmailChannel(opts);
      (channel as any).gmail = gmailMock;

      gmailMock.users.messages.list.mockResolvedValueOnce({
        data: { messages: [] },
      });

      await channel._pollOnce();

      expect(opts.onMessage).not.toHaveBeenCalled();
      expect(gmailMock.users.messages.get).not.toHaveBeenCalled();
    });

    it('handles null messages list', async () => {
      const opts = createTestOpts();
      const channel = new EmailChannel(opts);
      (channel as any).gmail = gmailMock;

      gmailMock.users.messages.list.mockResolvedValueOnce({
        data: {},
      });

      await channel._pollOnce();

      expect(opts.onMessage).not.toHaveBeenCalled();
    });

    it('does nothing when gmail is not initialized', async () => {
      const channel = new EmailChannel(createTestOpts());
      // gmail is null by default
      await channel._pollOnce();
      expect(gmailMock.users.messages.list).not.toHaveBeenCalled();
    });

    it('extracts sender from bare email (no angle brackets)', async () => {
      setupGroupConfig('achosa', SAMPLE_YAML);

      const opts = createTestOpts();
      const channel = new EmailChannel(opts);
      (channel as any).gmail = gmailMock;

      gmailMock.users.messages.list.mockResolvedValueOnce({
        data: { messages: [{ id: 'msg-1' }] },
      });
      gmailMock.users.messages.get.mockResolvedValueOnce(makeGmailMessage({
        from: 'stephen@test.com',
      }));

      await channel._pollOnce();

      expect(opts.onMessage).toHaveBeenCalledWith(
        'email:achosa',
        expect.objectContaining({ sender: 'stephen@test.com' }),
      );
    });
  });

  // --- Outbound sending ---

  describe('outbound sending', () => {
    it('sends to primary and cc contacts', async () => {
      setupGroupConfig('achosa', SAMPLE_YAML);

      const channel = new EmailChannel(createTestOpts());
      (channel as any).gmail = gmailMock;

      await channel.sendMessage('email:achosa', 'Hello from bot');

      expect(gmailMock.users.messages.send).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: expect.objectContaining({
          raw: expect.any(String),
        }),
      });

      // Decode the raw message and check headers
      const call = gmailMock.users.messages.send.mock.calls[0][0];
      const raw = Buffer.from(call.requestBody.raw, 'base64url').toString('utf-8');
      expect(raw).toContain('To: stephen@test.com');
      expect(raw).toContain('Cc: ben@test.com');
      expect(raw).toContain('Hello from bot');
    });

    it('uses thread state for replies', async () => {
      setupGroupConfig('achosa', SAMPLE_YAML);

      const channel = new EmailChannel(createTestOpts());
      (channel as any).gmail = gmailMock;

      // Simulate stored thread from inbound
      (channel as any).threads.set('achosa', {
        threadId: 'thread-42',
        messageId: '<original@test.com>',
        subject: 'Important Topic',
      });

      await channel.sendMessage('email:achosa', 'Reply text');

      const call = gmailMock.users.messages.send.mock.calls[0][0];
      expect(call.requestBody.threadId).toBe('thread-42');

      const raw = Buffer.from(call.requestBody.raw, 'base64url').toString('utf-8');
      expect(raw).toContain('In-Reply-To: <original@test.com>');
      expect(raw).toContain('References: <original@test.com>');
      expect(raw).toContain('Subject: Re: Important Topic');
    });

    it('does not double-prefix Re: in subject', async () => {
      setupGroupConfig('achosa', SAMPLE_YAML);

      const channel = new EmailChannel(createTestOpts());
      (channel as any).gmail = gmailMock;

      (channel as any).threads.set('achosa', {
        threadId: 'thread-42',
        messageId: '<orig@test.com>',
        subject: 'Re: Already a reply',
      });

      await channel.sendMessage('email:achosa', 'More reply');

      const call = gmailMock.users.messages.send.mock.calls[0][0];
      const raw = Buffer.from(call.requestBody.raw, 'base64url').toString('utf-8');
      expect(raw).toContain('Subject: Re: Already a reply');
      // Should NOT contain "Re: Re:"
      expect(raw).not.toContain('Re: Re:');
    });

    it('skips unknown groups', async () => {
      // No config for 'nonexistent' group
      const channel = new EmailChannel(createTestOpts());
      (channel as any).gmail = gmailMock;

      await channel.sendMessage('email:nonexistent', 'Hello');

      expect(gmailMock.users.messages.send).not.toHaveBeenCalled();
    });

    it('does nothing when gmail is not initialized', async () => {
      const channel = new EmailChannel(createTestOpts());
      // gmail is null by default
      await channel.sendMessage('email:achosa', 'No gmail');
      expect(gmailMock.users.messages.send).not.toHaveBeenCalled();
    });

    it('handles send failure gracefully', async () => {
      setupGroupConfig('achosa', SAMPLE_YAML);

      const channel = new EmailChannel(createTestOpts());
      (channel as any).gmail = gmailMock;

      gmailMock.users.messages.send.mockRejectedValueOnce(new Error('Send failed'));

      // Should not throw
      await expect(
        channel.sendMessage('email:achosa', 'Will fail'),
      ).resolves.toBeUndefined();
    });

    it('updates thread state after sending', async () => {
      setupGroupConfig('achosa', SAMPLE_YAML);

      const channel = new EmailChannel(createTestOpts());
      (channel as any).gmail = gmailMock;

      gmailMock.users.messages.send.mockResolvedValueOnce({
        data: { id: 'sent-99', threadId: 'thread-new' },
      });

      await channel.sendMessage('email:achosa', 'First message');

      const thread = (channel as any).threads.get('achosa');
      expect(thread).toBeDefined();
      expect(thread.threadId).toBe('thread-new');
    });
  });

  // --- Threading ---

  describe('threading', () => {
    it('stores thread from inbound message', async () => {
      setupGroupConfig('achosa', SAMPLE_YAML);

      const channel = new EmailChannel(createTestOpts());
      (channel as any).gmail = gmailMock;

      gmailMock.users.messages.list.mockResolvedValueOnce({
        data: { messages: [{ id: 'msg-1' }] },
      });
      gmailMock.users.messages.get.mockResolvedValueOnce(makeGmailMessage({
        threadId: 'thread-abc',
        messageId: '<inbound@test.com>',
        subject: 'Original Subject',
      }));

      await channel._pollOnce();

      const thread = (channel as any).threads.get('achosa');
      expect(thread).toEqual({
        threadId: 'thread-abc',
        messageId: '<inbound@test.com>',
        subject: 'Original Subject',
      });
    });

    it('uses stored thread for outbound replies', async () => {
      setupGroupConfig('achosa', SAMPLE_YAML);

      const channel = new EmailChannel(createTestOpts());
      (channel as any).gmail = gmailMock;

      // Store a thread state
      (channel as any).threads.set('achosa', {
        threadId: 'thread-xyz',
        messageId: '<prev@test.com>',
        subject: 'Thread Subject',
      });

      await channel.sendMessage('email:achosa', 'Reply');

      const call = gmailMock.users.messages.send.mock.calls[0][0];
      expect(call.requestBody.threadId).toBe('thread-xyz');
    });
  });

  // --- Connection lifecycle ---

  describe('connection lifecycle', () => {
    it('isConnected returns false before connect', () => {
      const channel = new EmailChannel(createTestOpts());
      expect(channel.isConnected()).toBe(false);
    });

    it('isConnected returns true after connect', async () => {
      setupGmailCreds();
      const channel = new EmailChannel(createTestOpts());
      await channel.connect();
      expect(channel.isConnected()).toBe(true);
    });

    it('disconnect stops polling and sets connected to false', async () => {
      setupGmailCreds();
      const channel = new EmailChannel(createTestOpts());
      await channel.connect();

      expect(channel.isConnected()).toBe(true);

      await channel.disconnect();

      expect(channel.isConnected()).toBe(false);
    });

    it('connect starts polling interval', async () => {
      setupGmailCreds();
      const channel = new EmailChannel(createTestOpts());
      await channel.connect();

      // The poll timer should exist
      expect((channel as any).pollTimer).not.toBeNull();

      await channel.disconnect();
    });
  });

  // --- setTyping ---

  describe('setTyping', () => {
    it('is a no-op', async () => {
      const channel = new EmailChannel(createTestOpts());

      // Should not throw
      await expect(
        channel.setTyping('email:achosa', true),
      ).resolves.toBeUndefined();

      await expect(
        channel.setTyping('email:achosa', false),
      ).resolves.toBeUndefined();
    });
  });
});
