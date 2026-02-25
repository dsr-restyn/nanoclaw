import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { getRuntimeUpdate, resolveRuntimeUpdate } from './db.js';
import { logger } from './logger.js';
import { RuntimeUpdate } from './types.js';

const APPROVAL_PATTERN = /^(approve|deny)\s+(\d+)$/i;

export function matchApprovalCommand(
  text: string,
): { action: 'approve' | 'deny'; id: number } | null {
  const match = text.trim().match(APPROVAL_PATTERN);
  if (!match) return null;
  return {
    action: match[1].toLowerCase() as 'approve' | 'deny',
    id: parseInt(match[2], 10),
  };
}

const REQUIRES_RESTART = new Set(['git_pull', 'apply_skill', 'rebuild_container']);

export async function processApproval(
  id: number,
  action: 'approve' | 'deny',
): Promise<{ message: string; restart: boolean }> {
  const update = getRuntimeUpdate(id);
  if (!update) {
    return { message: `Runtime update #${id} not found.`, restart: false };
  }
  if (update.status !== 'pending') {
    return { message: `Runtime update #${id} already ${update.status}.`, restart: false };
  }

  if (action === 'deny') {
    resolveRuntimeUpdate(id, 'denied');
    logToFile(id, update, 'DENIED');
    return {
      message: `Denied runtime update #${id} (\`${update.action}\` from ${update.group_folder}).`,
      restart: false,
    };
  }

  try {
    const result = executeAction(update);
    resolveRuntimeUpdate(id, 'approved', result);
    logToFile(id, update, result);

    const needsRestart = REQUIRES_RESTART.has(update.action);
    return {
      message: `Approved runtime update #${id} (\`${update.action}\`): ${result}${needsRestart ? '\nRestarting...' : ''}`,
      restart: needsRestart,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    resolveRuntimeUpdate(id, 'failed', errorMsg);
    logToFile(id, update, `FAILED — ${errorMsg}`);
    return {
      message: `Runtime update #${id} failed: ${errorMsg}`,
      restart: false,
    };
  }
}

function logToFile(id: number, update: RuntimeUpdate, result: string): void {
  const logLine = `[${new Date().toISOString()}] #${id} ${update.action} from ${update.group_folder}: ${result}\n`;
  try {
    fs.appendFileSync(path.join(DATA_DIR, 'runtime-updates.log'), logLine);
  } catch {
    logger.warn('Failed to write to runtime-updates.log');
  }
}

function executeAction(update: RuntimeUpdate): string {
  const cwd = process.cwd();

  switch (update.action) {
    case 'git_pull': {
      execFileSync('git', ['pull', '--rebase'], { cwd, timeout: 60000 });
      execFileSync('npm', ['install', '--silent'], { cwd, timeout: 120000 });
      execFileSync('npm', ['run', 'build'], { cwd, timeout: 60000 });
      return 'Pulled, installed, and built successfully.';
    }

    case 'apply_skill': {
      const { skill } = JSON.parse(update.params);
      execFileSync('npx', ['tsx', 'scripts/apply-skill.ts', skill], { cwd, timeout: 60000 });
      execFileSync('npm', ['run', 'build'], { cwd, timeout: 60000 });
      return `Applied skill ${skill} and rebuilt.`;
    }

    case 'update_config': {
      const { key, value } = JSON.parse(update.params);
      const envPath = path.join(cwd, '.env');

      let existing = '';
      try { existing = fs.readFileSync(envPath, 'utf-8'); } catch { /* no .env yet */ }

      const existingKeys = new Set(
        existing.split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'))
          .map((l) => l.split('=')[0].trim()),
      );

      if (existingKeys.has(key)) {
        throw new Error(`Key "${key}" already exists in .env. Overwrites are not allowed.`);
      }

      fs.appendFileSync(envPath, `\n${key}=${value}\n`);
      return `Added ${key} to .env.`;
    }

    case 'rebuild_container': {
      execFileSync('bash', ['./container/build.sh'], { cwd, timeout: 300000 });
      return 'Container image rebuilt.';
    }

    default:
      throw new Error(`Unknown action: ${update.action}`);
  }
}
