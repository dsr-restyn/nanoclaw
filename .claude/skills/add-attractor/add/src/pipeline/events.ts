export type Verbosity = 'minimal' | 'standard' | 'verbose';

export type PipelineEvent =
  | { kind: 'pipeline_started'; pipelineId: string; goal: string; totalNodes: number; timestamp: Date }
  | { kind: 'pipeline_completed'; pipelineId: string; goal: string; completedNodes: number; totalNodes: number; durationMs: number; timestamp: Date }
  | { kind: 'pipeline_failed'; pipelineId: string; goal: string; reason: string; timestamp: Date }
  | { kind: 'stage_started'; pipelineId: string; nodeId: string; nodeLabel: string; stageNum: number; totalNodes: number; timestamp: Date }
  | { kind: 'stage_completed'; pipelineId: string; nodeId: string; nodeLabel: string; stageNum: number; totalNodes: number; status: string; durationMs: number; timestamp: Date }
  | { kind: 'stage_retrying'; pipelineId: string; nodeId: string; nodeLabel: string; retryCount: number; maxRetries: number; timestamp: Date }
  | { kind: 'edge_selected'; pipelineId: string; fromNode: string; toNode: string; edgeLabel: string; timestamp: Date }
  | { kind: 'human_gate'; pipelineId: string; nodeId: string; nodeLabel: string; choices: string[]; timestamp: Date }
  | { kind: 'error'; pipelineId: string; nodeId: string; message: string; timestamp: Date };

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

const MINIMAL_KINDS = new Set(['pipeline_started', 'pipeline_completed', 'pipeline_failed', 'error']);
const STANDARD_KINDS = new Set([...MINIMAL_KINDS, 'stage_started', 'stage_completed', 'stage_retrying', 'edge_selected', 'human_gate']);

export function shouldEmit(event: PipelineEvent, verbosity: Verbosity): boolean {
  if (verbosity === 'verbose') return true;
  if (verbosity === 'standard') return STANDARD_KINDS.has(event.kind);
  return MINIMAL_KINDS.has(event.kind);
}

export function formatEvent(event: PipelineEvent, verbosity: Verbosity): string | null {
  if (!shouldEmit(event, verbosity)) return null;

  switch (event.kind) {
    case 'pipeline_started':
      return `[Pipeline] ${event.goal}\n  ${event.totalNodes} nodes`;
    case 'pipeline_completed':
      return `[Pipeline] Complete — ${event.completedNodes}/${event.totalNodes} nodes — ${formatDuration(event.durationMs)}`;
    case 'pipeline_failed':
      return `[Pipeline] Failed — ${event.reason}`;
    case 'stage_started':
      return `  → ${event.nodeLabel} (${event.stageNum}/${event.totalNodes})`;
    case 'stage_completed': {
      const icon = event.status === 'success' ? '✓' : '✗';
      return `  ${icon} ${event.nodeLabel} — ${formatDuration(event.durationMs)}`;
    }
    case 'stage_retrying':
      return `  ↻ Retry ${event.nodeLabel} (${event.retryCount}/${event.maxRetries})`;
    case 'edge_selected':
      return `  ↪ ${event.edgeLabel || event.toNode}`;
    case 'human_gate':
      return `  ⏸ Awaiting approval: ${event.nodeLabel}\n  Choices: ${event.choices.join(' | ')}`;
    case 'error':
      return `  ✗ Error at ${event.nodeId}: ${event.message}`;
  }
}
