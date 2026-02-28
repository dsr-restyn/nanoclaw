import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { saveCheckpoint, loadCheckpoint, type Checkpoint } from './checkpoint.js';

describe('checkpoint', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves and loads checkpoint', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
    const cp: Checkpoint = {
      pipelineId: 'test-123',
      timestamp: new Date().toISOString(),
      currentNode: 'analyze',
      completedNodes: ['start'],
      nodeRetries: {},
      nodeOutcomes: { start: 'success' },
      contextValues: { 'graph.goal': 'Test' },
      logs: [],
    };
    saveCheckpoint(tmpDir, cp);
    const loaded = loadCheckpoint(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.pipelineId).toBe('test-123');
    expect(loaded!.currentNode).toBe('analyze');
    expect(loaded!.completedNodes).toEqual(['start']);
  });

  it('returns null for missing checkpoint', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
    const loaded = loadCheckpoint(tmpDir);
    expect(loaded).toBeNull();
  });
});
