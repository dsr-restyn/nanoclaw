import fs from 'fs';
import path from 'path';
import type { ContextValue } from './context.js';

export interface Checkpoint {
  pipelineId: string;
  timestamp: string;
  currentNode: string;
  completedNodes: string[];
  nodeRetries: Record<string, number>;
  nodeOutcomes: Record<string, string>;
  contextValues: Record<string, ContextValue>;
  logs: string[];
}

export function saveCheckpoint(dir: string, checkpoint: Checkpoint): void {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'checkpoint.json');
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(checkpoint, null, 2));
  fs.renameSync(tempPath, filePath);
}

export function loadCheckpoint(dir: string): Checkpoint | null {
  const filePath = path.join(dir, 'checkpoint.json');
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as Checkpoint;
  } catch {
    return null;
  }
}
