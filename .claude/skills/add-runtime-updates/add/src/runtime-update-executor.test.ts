import { describe, it, expect, beforeEach } from 'vitest';
import {
  _initTestDatabase,
  createRuntimeUpdate,
  getRuntimeUpdate,
} from './db.js';
import { matchApprovalCommand, processApproval } from './runtime-update-executor.js';

beforeEach(() => {
  _initTestDatabase();
});

describe('matchApprovalCommand', () => {
  it('matches "approve 7"', () => {
    expect(matchApprovalCommand('approve 7')).toEqual({ action: 'approve', id: 7 });
  });

  it('matches "deny 3"', () => {
    expect(matchApprovalCommand('deny 3')).toEqual({ action: 'deny', id: 3 });
  });

  it('returns null for non-matching text', () => {
    expect(matchApprovalCommand('hello world')).toBeNull();
    expect(matchApprovalCommand('approve')).toBeNull();
    expect(matchApprovalCommand('approve abc')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(matchApprovalCommand('Approve 5')).toEqual({ action: 'approve', id: 5 });
    expect(matchApprovalCommand('DENY 2')).toEqual({ action: 'deny', id: 2 });
  });
});

describe('processApproval', () => {
  it('denies a pending request', async () => {
    const id = createRuntimeUpdate({
      group_folder: 'trading',
      action: 'git_pull',
      params: '{}',
      reason: 'test',
    });

    const result = await processApproval(id!, 'deny');
    expect(result.message).toContain('Denied');
    expect(getRuntimeUpdate(id!)!.status).toBe('denied');
  });

  it('returns error for non-existent ID', async () => {
    const result = await processApproval(999, 'approve');
    expect(result.message).toContain('not found');
  });

  it('returns error for already-resolved request', async () => {
    const id = createRuntimeUpdate({
      group_folder: 'trading',
      action: 'git_pull',
      params: '{}',
      reason: 'test',
    });

    await processApproval(id!, 'deny');
    const result = await processApproval(id!, 'approve');
    expect(result.message).toContain('already');
  });
});
