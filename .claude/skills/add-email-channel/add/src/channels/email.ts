import fs from 'fs';
import os from 'os';
import path from 'path';

import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

import { EMAIL_POLL_INTERVAL, EMAIL_INBOX_ADDRESS, GROUPS_DIR } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import { Channel } from '../types.js';

interface ThreadState {
  threadId: string;
  messageId: string;
  subject: string;
}

interface RouteEntry {
  groupFolder: string;
  jid: string;
}

export interface EmailChannelOpts {
  onMessage: ChannelOpts['onMessage'];
  onChatMetadata: ChannelOpts['onChatMetadata'];
}

export class EmailChannel implements Channel {
  name = 'email';

  private gmail: gmail_v1.Gmail | null = null;
  private auth: OAuth2Client | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private opts: EmailChannelOpts;
  private threads = new Map<string, ThreadState>();

  constructor(opts: EmailChannelOpts) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    const homedir = os.homedir();
    const keysPath = path.join(homedir, '.gmail-mcp', 'gcp-oauth.keys.json');
    const credPath = path.join(homedir, '.gmail-mcp', 'credentials.json');

    const keysRaw = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
    const oauthKey = keysRaw.installed || keysRaw.web;
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));

    this.auth = new google.auth.OAuth2(
      oauthKey.client_id,
      oauthKey.client_secret,
      oauthKey.redirect_uris?.[0],
    );
    this.auth.setCredentials(creds);

    // Auto-save refreshed tokens
    this.auth.on('tokens', (tokens) => {
      try {
        const existing = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
        const merged = { ...existing, ...tokens };
        fs.writeFileSync(credPath, JSON.stringify(merged, null, 2));
        logger.debug('Email: refreshed tokens saved');
      } catch (err) {
        logger.error({ err }, 'Email: failed to save refreshed tokens');
      }
    });

    this.gmail = google.gmail({ version: 'v1', auth: this.auth });
    this.connected = true;

    // Start polling
    this.pollTimer = setInterval(() => {
      this._pollOnce().catch((err) => {
        logger.error({ err }, 'Email: poll error');
      });
    }, EMAIL_POLL_INTERVAL);

    logger.info({ interval: EMAIL_POLL_INTERVAL }, 'Email channel connected');
    console.log(`\n  Email channel: polling every ${EMAIL_POLL_INTERVAL / 1000}s`);
    console.log(`  Inbox: ${EMAIL_INBOX_ADDRESS}\n`);
  }

  async _pollOnce(): Promise<void> {
    if (!this.gmail) return;

    const routingTable = this._buildRoutingTable();

    // Fetch unread messages
    const listRes = await this.gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
    });

    const messages = listRes.data.messages || [];

    for (const msgRef of messages) {
      try {
        const msgRes = await this.gmail.users.messages.get({
          userId: 'me',
          id: msgRef.id!,
          format: 'full',
        });

        const msg = msgRes.data;
        const headers = msg.payload?.headers || [];

        const fromHeader = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || '';
        const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || '(no subject)';
        const dateHeader = headers.find((h) => h.name?.toLowerCase() === 'date')?.value || '';
        const messageIdHeader = headers.find((h) => h.name?.toLowerCase() === 'message-id')?.value || '';

        // Extract email address from "Name <email>" format
        const senderEmail = this._extractEmail(fromHeader).toLowerCase();
        const senderName = this._extractName(fromHeader);

        const route = routingTable.get(senderEmail);

        if (!route) {
          logger.debug({ sender: senderEmail }, 'Email from unknown sender, ignoring');
          // Mark as read
          await this.gmail.users.messages.modify({
            userId: 'me',
            id: msgRef.id!,
            requestBody: { removeLabelIds: ['UNREAD'] },
          });
          continue;
        }

        // Extract body text
        const body = this._extractBody(msg);
        const timestamp = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();

        // Store thread state for replies
        this.threads.set(route.groupFolder, {
          threadId: msg.threadId || '',
          messageId: messageIdHeader,
          subject,
        });

        // Deliver message
        this.opts.onChatMetadata(route.jid, timestamp, senderName, 'email', false);
        this.opts.onMessage(route.jid, {
          id: msgRef.id!,
          chat_jid: route.jid,
          sender: senderEmail,
          sender_name: senderName,
          content: body,
          timestamp,
          is_from_me: false,
        });

        logger.info({ sender: senderEmail, group: route.groupFolder }, 'Email delivered');

        // Mark as read
        await this.gmail.users.messages.modify({
          userId: 'me',
          id: msgRef.id!,
          requestBody: { removeLabelIds: ['UNREAD'] },
        });
      } catch (err) {
        logger.error({ err, msgId: msgRef.id }, 'Email: failed to process message');
      }
    }
  }

  _buildRoutingTable(): Map<string, RouteEntry> {
    const table = new Map<string, RouteEntry>();

    let groupDirs: string[];
    try {
      groupDirs = fs.readdirSync(GROUPS_DIR);
    } catch {
      return table;
    }

    for (const folder of groupDirs) {
      const configPath = path.join(GROUPS_DIR, folder, 'client', 'config.yaml');
      let content: string;
      try {
        content = fs.readFileSync(configPath, 'utf-8');
      } catch {
        continue;
      }

      const contacts = this._parseContacts(content);
      const jid = `email:${folder}`;

      for (const contact of contacts) {
        table.set(contact.email.toLowerCase(), { groupFolder: folder, jid });
      }
    }

    return table;
  }

  _parseContacts(yaml: string): Array<{ email: string; role: string }> {
    const contacts: Array<{ email: string; role: string }> = [];
    const lines = yaml.split('\n');
    let inContacts = false;
    let currentContact: { email?: string; role?: string } = {};

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === 'contacts:') {
        inContacts = true;
        continue;
      }

      if (inContacts) {
        // A non-indented, non-empty line that's not a list item ends the contacts block
        if (trimmed && !trimmed.startsWith('-') && !trimmed.startsWith('email:') && !trimmed.startsWith('role:') && !line.startsWith(' ') && !line.startsWith('\t')) {
          break;
        }

        if (trimmed.startsWith('- email:') || trimmed.startsWith('-  email:')) {
          // Flush previous contact
          if (currentContact.email) {
            contacts.push({
              email: currentContact.email,
              role: currentContact.role || 'primary',
            });
          }
          currentContact = {
            email: trimmed.replace(/^-\s*email:\s*/, '').trim(),
          };
        } else if (trimmed.startsWith('email:')) {
          currentContact.email = trimmed.replace(/^email:\s*/, '').trim();
        } else if (trimmed.startsWith('role:')) {
          currentContact.role = trimmed.replace(/^role:\s*/, '').trim();
        } else if (trimmed.startsWith('- ')) {
          // New list item without email: key — skip
        }
      }
    }

    // Flush last contact
    if (currentContact.email) {
      contacts.push({
        email: currentContact.email,
        role: currentContact.role || 'primary',
      });
    }

    return contacts;
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.gmail) {
      logger.warn('Email: Gmail API not initialized');
      return;
    }

    const groupFolder = jid.replace(/^email:/, '');
    const configPath = path.join(GROUPS_DIR, groupFolder, 'client', 'config.yaml');

    let content: string;
    try {
      content = fs.readFileSync(configPath, 'utf-8');
    } catch {
      logger.warn({ jid }, 'Email: config not found for group');
      return;
    }

    const contacts = this._parseContacts(content);
    if (contacts.length === 0) {
      logger.warn({ jid }, 'Email: no contacts found for group');
      return;
    }

    const toAddrs = contacts.filter((c) => c.role === 'primary').map((c) => c.email);
    const ccAddrs = contacts.filter((c) => c.role === 'cc').map((c) => c.email);

    // If no primary, send to all as To:
    const to = toAddrs.length > 0 ? toAddrs : contacts.map((c) => c.email);
    const cc = toAddrs.length > 0 ? ccAddrs : [];

    const thread = this.threads.get(groupFolder);
    const subject = thread?.subject || 'Message from assistant';

    // Build RFC 2822 message
    const lines: string[] = [];
    lines.push(`To: ${to.join(', ')}`);
    if (cc.length > 0) lines.push(`Cc: ${cc.join(', ')}`);
    lines.push(`From: ${EMAIL_INBOX_ADDRESS}`);
    lines.push(`Subject: ${subject.startsWith('Re:') ? subject : `Re: ${subject}`}`);
    if (thread?.messageId) {
      lines.push(`In-Reply-To: ${thread.messageId}`);
      lines.push(`References: ${thread.messageId}`);
    }
    lines.push('Content-Type: text/plain; charset=utf-8');
    lines.push('');
    lines.push(text);

    const raw = Buffer.from(lines.join('\r\n')).toString('base64url');

    try {
      const res = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw,
          threadId: thread?.threadId,
        },
      });

      // Update thread state with sent message info
      if (res.data.threadId) {
        this.threads.set(groupFolder, {
          threadId: res.data.threadId,
          messageId: res.data.id || '',
          subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
        });
      }

      logger.info({ jid, to, cc }, 'Email sent');
    } catch (err) {
      logger.error({ jid, err }, 'Email: failed to send');
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
    this.auth = null;
    logger.info('Email channel disconnected');
  }

  async setTyping(_jid: string, _isTyping: boolean): Promise<void> {
    // No-op: email has no typing indicator
  }

  private _extractEmail(from: string): string {
    const match = from.match(/<([^>]+)>/);
    return match ? match[1] : from.trim();
  }

  private _extractName(from: string): string {
    const match = from.match(/^"?([^"<]+)"?\s*</);
    return match ? match[1].trim() : this._extractEmail(from);
  }

  private _extractBody(msg: gmail_v1.Schema$Message): string {
    const payload = msg.payload;
    if (!payload) return '';

    // Simple single-part message
    if (payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64url').toString('utf-8').trim();
    }

    // Multipart — find text/plain
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64url').toString('utf-8').trim();
        }
      }
      // Fallback to first part with data
      for (const part of payload.parts) {
        if (part.body?.data) {
          return Buffer.from(part.body.data, 'base64url').toString('utf-8').trim();
        }
      }
    }

    return '';
  }
}

registerChannel('email', (opts: ChannelOpts) => {
  const env = readEnvFile(['EMAIL_ENABLED', 'EMAIL_INBOX_ADDRESS']);
  const enabled = (process.env.EMAIL_ENABLED || env.EMAIL_ENABLED) === 'true';
  if (!enabled) return null;

  const credPath = path.join(os.homedir(), '.gmail-mcp', 'credentials.json');
  if (!fs.existsSync(credPath)) {
    logger.warn('Email: Gmail credentials not found at ~/.gmail-mcp/');
    return null;
  }

  return new EmailChannel(opts);
});
