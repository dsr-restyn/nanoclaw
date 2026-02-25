import { describe, it, expect, beforeEach } from 'vitest';
import {
  _initTestDatabase,
  createRuntimeUpdate,
  getRuntimeUpdate,
  getPendingRuntimeUpdate,
  resolveRuntimeUpdate,
  getExpiredRuntimeUpdates,
} from './db.js';

beforeEach(() => {
  _initTestDatabase();
});

describe('runtime update CRUD', () => {
  it('creates and retrieves a runtime update', () => {
    const id = createRuntimeUpdate({
      group_folder: 'trading',
      action: 'git_pull',
      params: '{}',
      reason: 'upstream fix',
    });

    const update = getRuntimeUpdate(id);
    expect(update).toBeDefined();
    expect(update!.group_folder).toBe('trading');
    expect(update!.action).toBe('git_pull');
    expect(update!.status).toBe('pending');
  });

  it('blocks duplicate pending request from same group', () => {
    createRuntimeUpdate({
      group_folder: 'trading',
      action: 'git_pull',
      params: '{}',
      reason: 'first',
    });

    const id2 = createRuntimeUpdate({
      group_folder: 'trading',
      action: 'apply_skill',
      params: '{}',
      reason: 'second',
    });

    expect(id2).toBeNull();
  });

  it('allows request after previous one is resolved', () => {
    const id1 = createRuntimeUpdate({
      group_folder: 'trading',
      action: 'git_pull',
      params: '{}',
      reason: 'first',
    });

    resolveRuntimeUpdate(id1!, 'approved');

    const id2 = createRuntimeUpdate({
      group_folder: 'trading',
      action: 'apply_skill',
      params: '{}',
      reason: 'second',
    });

    expect(id2).not.toBeNull();
  });

  it('getPendingRuntimeUpdate returns null when none exist', () => {
    expect(getPendingRuntimeUpdate('trading')).toBeNull();
  });

  it('resolves a runtime update', () => {
    const id = createRuntimeUpdate({
      group_folder: 'trading',
      action: 'git_pull',
      params: '{}',
      reason: 'fix',
    });

    resolveRuntimeUpdate(id!, 'approved', 'success');

    const update = getRuntimeUpdate(id!);
    expect(update!.status).toBe('approved');
    expect(update!.result).toBe('success');
    expect(update!.resolved_at).toBeTruthy();
  });

  it('finds expired updates', () => {
    const id = createRuntimeUpdate({
      group_folder: 'trading',
      action: 'git_pull',
      params: '{}',
      reason: 'old',
    });

    // 0ms maxAge = everything is expired
    const expired = getExpiredRuntimeUpdates(0);
    expect(expired.length).toBe(1);
    expect(expired[0].id).toBe(id);
  });
});
