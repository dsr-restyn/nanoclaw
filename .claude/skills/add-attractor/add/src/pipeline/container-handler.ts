import type { Node, Graph } from './types.js';
import { getStringAttr } from './types.js';
import { Context } from './context.js';
import { createOutcome, StageStatus, type Outcome } from './outcome.js';
import type { NodeHandler } from './orchestrator.js';

const SUMMARY_TAIL_CHARS = 1200;
const PRIOR_WORK_BUDGET = 6000;

export function extractSummary(response: string): string {
  const cleaned = response
    .replace(/\[outcome:[^\]]*\]/g, '')
    .replace(/\[preferred_label:[^\]]*\]/g, '')
    .trim();
  if (cleaned.length <= SUMMARY_TAIL_CHARS) return cleaned;
  return cleaned.slice(-SUMMARY_TAIL_CHARS);
}

function buildPriorWorkSection(context: Context): string {
  const summaries: { id: string; label: string; text: string }[] = [];
  for (const key of context.keys()) {
    if (!key.startsWith('node_summary.')) continue;
    const entry = context.get(key) as { label: string; text: string } | undefined;
    if (!entry) continue;
    summaries.push({ id: key.slice('node_summary.'.length), label: entry.label, text: entry.text });
  }
  if (summaries.length === 0) return '';

  const header = '## Prior Pipeline Work\nThe following steps have already been completed in this pipeline.\nMaintain consistency with APIs, types, and patterns established below.\n';

  let total = header.length;
  const sections: string[] = [];
  for (const s of summaries) {
    const section = `### ${s.label}\n${s.text}`;
    if (total + section.length + 2 <= PRIOR_WORK_BUDGET) {
      sections.push(section);
      total += section.length + 2;
    } else {
      // Trim: keep first and last line of the text
      const lines = s.text.split('\n');
      const trimmed = lines.length <= 2
        ? s.text
        : `${lines[0]}\n[...trimmed...]\n${lines[lines.length - 1]}`;
      const section = `### ${s.label}\n${trimmed}`;
      sections.push(section);
      total += section.length + 2;
    }
  }

  return header + '\n' + sections.join('\n\n');
}

export function buildNodePrompt(node: Node, context: Context): string {
  const prompt = getStringAttr(node.attributes, 'prompt');
  const label = getStringAttr(node.attributes, 'label', node.id);
  const goal = context.getString('graph.goal');

  let text = prompt || `Complete this task: ${label}`;

  // Variable expansion
  text = text.replace(/\$goal/g, goal);

  const parts = [`## Pipeline Task: ${label}\n`];
  if (goal) parts.push(`**Goal:** ${goal}\n`);

  const priorWork = buildPriorWorkSection(context);
  if (priorWork) parts.push(priorWork + '\n');

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

    // Store summary for subsequent nodes
    const label = getStringAttr(node.attributes, 'label', node.id);
    context.set(`node_summary.${node.id}`, { label, text: extractSummary(response) });

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
