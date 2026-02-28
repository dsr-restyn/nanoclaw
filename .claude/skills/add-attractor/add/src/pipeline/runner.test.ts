import { describe, it, expect } from 'vitest';
import { startPipelineRun, type PipelineRunDeps } from './runner.js';

describe('startPipelineRun', () => {
  it('parses DOT and emits events via sendMessage', async () => {
    const messages: string[] = [];
    const deps: PipelineRunDeps = {
      sendMessage: async (_jid, text) => { messages.push(text); },
      runContainerPrompt: async (_prompt, _node, _groupFolder, _chatJid) => {
        return 'Done.\n[outcome:success]';
      },
      chatJid: 'test@jid',
      groupFolder: 'test-group',
      verbosity: 'standard',
    };

    const dot = `digraph G {
      graph [goal="Test run"]
      start [shape=Mdiamond]
      work [label="Do Work", prompt="Do it"]
      exit [shape=Msquare]
      start -> work -> exit
    }`;

    const result = await startPipelineRun(dot, deps);
    expect(result.status).toBe('completed');
    expect(messages.some(m => m.includes('Test run'))).toBe(true);
    expect(messages.some(m => m.includes('Complete'))).toBe(true);
  });

  it('returns failed for invalid DOT', async () => {
    const deps: PipelineRunDeps = {
      sendMessage: async () => {},
      runContainerPrompt: async () => '[outcome:success]',
      chatJid: 'test@jid',
      groupFolder: 'test-group',
      verbosity: 'standard',
    };

    const result = await startPipelineRun('digraph G { }', deps);
    expect(result.status).toBe('failed');
  });
});
