import { describe, it, expect } from 'vitest';
import { PipelineOrchestrator, type NodeHandler } from './orchestrator.js';
import { tokenize } from './lexer.js';
import { parseTokens } from './parser.js';
import { createOutcome, StageStatus } from './outcome.js';
import type { PipelineEvent } from './events.js';

function parse(dot: string) { return parseTokens(tokenize(dot)); }

function stubHandler(status: string = 'success'): NodeHandler {
  return async (_node, _context, _graph) => createOutcome({ status: status as any });
}

describe('PipelineOrchestrator', () => {
  it('runs a linear pipeline to completion', async () => {
    const graph = parse(`digraph G {
      graph [goal="Test"]
      start [shape=Mdiamond]
      work [label="Do Work", prompt="Do the thing"]
      exit [shape=Msquare]
      start -> work -> exit
    }`);
    const events: PipelineEvent[] = [];
    const orch = new PipelineOrchestrator({
      handlers: { codergen: stubHandler() },
      onEvent: (e) => { events.push(e); },
    });
    const result = await orch.run(graph);
    expect(result.status).toBe('completed');
    expect(events.some(e => e.kind === 'pipeline_started')).toBe(true);
    expect(events.some(e => e.kind === 'pipeline_completed')).toBe(true);
  });

  it('follows conditional edges', async () => {
    const graph = parse(`digraph G {
      graph [goal="Test conditions"]
      start [shape=Mdiamond]
      test_node [label="Run Tests", prompt="test"]
      pass_node [label="Done", prompt="done"]
      fail_node [label="Fix", prompt="fix"]
      exit [shape=Msquare]
      start -> test_node
      test_node -> pass_node [condition="outcome=success"]
      test_node -> fail_node [condition="outcome=fail"]
      pass_node -> exit
      fail_node -> exit
    }`);
    const visited: string[] = [];
    const failHandler: NodeHandler = async (node, _ctx, _graph) => {
      visited.push(node.id);
      return createOutcome({ status: StageStatus.FAIL });
    };
    const orch = new PipelineOrchestrator({
      handlers: { codergen: failHandler },
      onEvent: () => {},
    });
    await orch.run(graph);
    expect(visited).toContain('test_node');
    expect(visited).toContain('fail_node');
    expect(visited).not.toContain('pass_node');
  });

  it('retries on failure when retry edge exists', async () => {
    const graph = parse(`digraph G {
      graph [goal="Test retry"]
      start [shape=Mdiamond]
      work [label="Work", prompt="do", max_retries=2]
      exit [shape=Msquare]
      start -> work
      work -> exit [condition="outcome=success"]
      work -> work [condition="outcome!=success"]
    }`);
    let callCount = 0;
    const retryHandler: NodeHandler = async (_node, _ctx, _graph) => {
      callCount++;
      if (callCount < 3) return createOutcome({ status: StageStatus.FAIL });
      return createOutcome({ status: StageStatus.SUCCESS });
    };
    const orch = new PipelineOrchestrator({
      handlers: { codergen: retryHandler },
      onEvent: () => {},
    });
    const result = await orch.run(graph);
    expect(result.status).toBe('completed');
    expect(callCount).toBe(3);
  });
});
