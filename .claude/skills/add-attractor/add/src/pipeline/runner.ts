import { tokenize } from './lexer.js';
import { parseTokens, ParseError } from './parser.js';
import { LexerError } from './lexer.js';
import { PipelineOrchestrator, type PipelineResult } from './orchestrator.js';
import { createContainerHandler, createToolHandler } from './container-handler.js';
import { formatEvent, type PipelineEvent, type Verbosity } from './events.js';
import type { Node } from './types.js';

export interface PipelineRunDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  runContainerPrompt: (prompt: string, node: Node, groupFolder: string, chatJid: string) => Promise<string>;
  chatJid: string;
  groupFolder: string;
  verbosity: Verbosity;
  checkpointDir?: string;
}

export async function startPipelineRun(
  dot: string,
  deps: PipelineRunDeps,
): Promise<PipelineResult> {
  let graph;
  try {
    const tokens = tokenize(dot);
    graph = parseTokens(tokens);
  } catch (err) {
    const reason = err instanceof ParseError || err instanceof LexerError
      ? err.message
      : 'Invalid DOT syntax';
    await deps.sendMessage(deps.chatJid, `[Pipeline] Failed to parse: ${reason}`);
    return { status: 'failed', completedNodes: [], failureReason: reason };
  }

  const runPrompt = (prompt: string, node: Node) =>
    deps.runContainerPrompt(prompt, node, deps.groupFolder, deps.chatJid);

  const codergenHandler = createContainerHandler(runPrompt);
  const toolHandler = createToolHandler(runPrompt);

  const onEvent = async (event: PipelineEvent) => {
    const text = formatEvent(event, deps.verbosity);
    if (text) {
      await deps.sendMessage(deps.chatJid, text);
    }
  };

  const orchestrator = new PipelineOrchestrator({
    handlers: {
      codergen: codergenHandler,
      tool: toolHandler,
    },
    onEvent,
    checkpointDir: deps.checkpointDir,
    verbosity: deps.verbosity,
  });

  return orchestrator.run(graph);
}
