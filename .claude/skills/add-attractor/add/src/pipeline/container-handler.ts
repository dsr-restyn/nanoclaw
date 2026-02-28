import type { Node, Graph } from './types.js';
import { getStringAttr } from './types.js';
import { Context } from './context.js';
import { createOutcome, StageStatus, type Outcome } from './outcome.js';

/** Handler function that processes a node and returns an outcome. */
export type NodeHandler = (node: Node, context: Context, graph: Graph) => Promise<Outcome>;

export function buildNodePrompt(node: Node, context: Context): string {
  const prompt = getStringAttr(node.attributes, 'prompt');
  const label = getStringAttr(node.attributes, 'label', node.id);
  const goal = context.getString('graph.goal');

  let text = prompt || `Complete this task: ${label}`;

  // Variable expansion
  text = text.replace(/\$goal/g, goal);

  const parts = [`## Pipeline Task: ${label}\n`];
  if (goal) parts.push(`**Goal:** ${goal}\n`);
  parts.push(text);
  parts.push('\n---');
  parts.push('When done, end your response with `[outcome:success]` if the task succeeded or `[outcome:fail]` if it failed.');
  parts.push('If you recommend a specific next step, add `[preferred_label:YourChoice]`.');

  return parts.join('\n');
}

export function parseOutcome(response: string): Outcome {
  const outcomeMatch = response.match(/\[outcome:(success|fail|partial_success|retry|skipped)\]/);
  const status = outcomeMatch?.[1] as StageStatus ?? StageStatus.SUCCESS;

  const labelMatch = response.match(/\[preferred_label:([^\]]+)\]/);
  const preferredLabel = labelMatch?.[1] ?? '';

  return createOutcome({ status, preferredLabel });
}

export function createContainerHandler(
  runPrompt: (prompt: string, node: Node) => Promise<string>,
): NodeHandler {
  return async (node: Node, context: Context, _graph: Graph): Promise<Outcome> => {
    const prompt = buildNodePrompt(node, context);
    const response = await runPrompt(prompt, node);
    return parseOutcome(response);
  };
}

export function createToolHandler(
  runPrompt: (prompt: string, node: Node) => Promise<string>,
): NodeHandler {
  return async (node: Node, context: Context, _graph: Graph): Promise<Outcome> => {
    const command = getStringAttr(node.attributes, 'tool_command');
    if (!command) {
      return createOutcome({ status: StageStatus.FAIL, failureReason: 'No tool_command attribute' });
    }
    const prompt = `Run this command and report the result:\n\`\`\`\n${command}\n\`\`\`\nReport the outcome with [outcome:success] or [outcome:fail].`;
    const response = await runPrompt(prompt, node);
    return parseOutcome(response);
  };
}
