import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';

// Read config values from .env (falls back to process.env).
// Secrets are NOT read here — they stay on disk and are loaded only
// where needed (container-runner.ts) to avoid leaking to child processes.
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'HTTP_CHANNEL_ENABLED',
  'HTTP_PORT',
  'WHATSAPP_ENABLED',
  'VOICE_ENABLED',
  'VOICE_PORT',
  'NTFY_TOPIC',
  'LOGSEQ_GRAPH_PATH',
  'ALPACA_API_KEY',
  'ALPACA_SECRET_KEY',
  'ALPACA_PAPER',
]);

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Andy';
export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER || envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || os.homedir();

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'nanoclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '1800000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(
  process.env.IDLE_TIMEOUT || '1800000',
  10,
); // 30min default — how long to keep container alive after last result
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// Channel flags
export const WHATSAPP_ENABLED =
  (process.env.WHATSAPP_ENABLED || envConfig.WHATSAPP_ENABLED) !== 'false';
export const HTTP_CHANNEL_ENABLED =
  (process.env.HTTP_CHANNEL_ENABLED || envConfig.HTTP_CHANNEL_ENABLED) === 'true';
export const HTTP_PORT = parseInt(
  process.env.HTTP_PORT || envConfig.HTTP_PORT || '4080',
  10,
);

// Voice settings (R1 PTT)
export const VOICE_ENABLED =
  (process.env.VOICE_ENABLED || envConfig.VOICE_ENABLED) === 'true';
export const VOICE_PORT = parseInt(
  process.env.VOICE_PORT || envConfig.VOICE_PORT || '443',
  10,
);

// Ntfy.sh push notifications
export const NTFY_TOPIC =
  process.env.NTFY_TOPIC || envConfig.NTFY_TOPIC || '';

// Logseq knowledge graph
export const LOGSEQ_GRAPH_PATH =
  process.env.LOGSEQ_GRAPH_PATH || envConfig.LOGSEQ_GRAPH_PATH || '';

// Alpaca trading API
export const ALPACA_API_KEY =
  process.env.ALPACA_API_KEY || envConfig.ALPACA_API_KEY || '';
export const ALPACA_SECRET_KEY =
  process.env.ALPACA_SECRET_KEY || envConfig.ALPACA_SECRET_KEY || '';
export const ALPACA_PAPER =
  (process.env.ALPACA_PAPER || envConfig.ALPACA_PAPER || 'true');
