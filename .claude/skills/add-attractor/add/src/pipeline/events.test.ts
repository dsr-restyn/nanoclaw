import { describe, it, expect } from 'vitest';
import { formatEvent, type PipelineEvent, type Verbosity } from './events.js';

describe('formatEvent', () => {
  it('formats pipeline started', () => {
    const event: PipelineEvent = {
      kind: 'pipeline_started',
      pipelineId: 'p1',
      goal: 'Add RSI indicator',
      totalNodes: 5,
      timestamp: new Date(),
    };
    const text = formatEvent(event, 'standard');
    expect(text).toBeTruthy();
    expect(text).toContain('Add RSI indicator');
  });

  it('formats stage completed success', () => {
    const event: PipelineEvent = {
      kind: 'stage_completed',
      pipelineId: 'p1',
      nodeId: 'analyze',
      nodeLabel: 'Analyze Codebase',
      stageNum: 1,
      totalNodes: 5,
      status: 'success',
      durationMs: 45000,
      timestamp: new Date(),
    };
    const text = formatEvent(event, 'standard');
    expect(text).toBeTruthy();
    expect(text).toContain('Analyze Codebase');
  });

  it('minimal verbosity suppresses stage_started', () => {
    const event: PipelineEvent = {
      kind: 'stage_started',
      pipelineId: 'p1',
      nodeId: 'analyze',
      nodeLabel: 'Analyze',
      stageNum: 1,
      totalNodes: 5,
      timestamp: new Date(),
    };
    const text = formatEvent(event, 'minimal');
    expect(text).toBeNull();
  });

  it('standard verbosity shows stage_started', () => {
    const event: PipelineEvent = {
      kind: 'stage_started',
      pipelineId: 'p1',
      nodeId: 'analyze',
      nodeLabel: 'Analyze',
      stageNum: 1,
      totalNodes: 5,
      timestamp: new Date(),
    };
    const text = formatEvent(event, 'standard');
    expect(text).toBeTruthy();
  });
});
