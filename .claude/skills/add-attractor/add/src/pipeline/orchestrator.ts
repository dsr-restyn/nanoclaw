import type { Graph, Node } from './types.js';
import { getStringAttr, getIntegerAttr, getBooleanAttr, outgoingEdges } from './types.js';
import { Context } from './context.js';
import { createOutcome, StageStatus, type Outcome } from './outcome.js';
import { selectEdge } from './edge-selection.js';
import { validateGraph } from './validate.js';
import { saveCheckpoint, type Checkpoint } from './checkpoint.js';
import type { PipelineEvent, Verbosity } from './events.js';

export type NodeHandler = (
  node: Node,
  context: Context,
  graph: Graph,
) => Promise<Outcome>;

export interface OrchestratorConfig {
  handlers: Record<string, NodeHandler>;
  onEvent: (event: PipelineEvent) => void | Promise<void>;
  checkpointDir?: string;
  verbosity?: Verbosity;
}

export interface PipelineResult {
  status: 'completed' | 'failed';
  completedNodes: string[];
  failureReason?: string;
}

const SHAPE_TO_HANDLER: Record<string, string> = {
  Mdiamond: 'start',
  Msquare: 'exit',
  box: 'codergen',
  hexagon: 'wait.human',
  diamond: 'conditional',
  parallelogram: 'tool',
  component: 'parallel',
  tripleoctagon: 'fan_in',
};

function retryDelay(attempt: number): number {
  const base = 200;
  const factor = 2;
  const max = 60_000;
  const delay = Math.min(base * factor ** attempt, max);
  return delay * (0.5 + Math.random() * 0.5);
}

export class PipelineOrchestrator {
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config = config;
  }

  async run(graph: Graph): Promise<PipelineResult> {
    const validation = validateGraph(graph);
    if (validation.errors.length > 0) {
      return { status: 'failed', completedNodes: [], failureReason: validation.errors.join('; ') };
    }

    const pipelineId = `pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const context = new Context();
    const goal = getStringAttr(graph.attributes, 'goal', '');
    context.set('graph.goal', goal);
    context.set('run_id', pipelineId);

    for (const [key, attr] of graph.attributes) {
      context.set(`graph.${key}`, attr.kind === 'string' ? attr.value : String(attr.value));
    }

    const completedNodes: string[] = [];
    const nodeRetries: Record<string, number> = {};
    const nodeOutcomes: Record<string, string> = {};
    const startTime = Date.now();

    let currentNodeId: string | null = null;
    for (const [id, node] of graph.nodes) {
      if (getStringAttr(node.attributes, 'shape') === 'Mdiamond') {
        currentNodeId = id;
        break;
      }
    }
    if (!currentNodeId) {
      return { status: 'failed', completedNodes: [], failureReason: 'No start node' };
    }

    const totalNodes = graph.nodes.size;
    let stageNum = 0;

    await this.config.onEvent({
      kind: 'pipeline_started',
      pipelineId,
      goal,
      totalNodes,
      timestamp: new Date(),
    });

    const maxIterations = 1000;
    let iterations = 0;

    while (currentNodeId && iterations < maxIterations) {
      iterations++;
      const node = graph.nodes.get(currentNodeId);
      if (!node) {
        return { status: 'failed', completedNodes, failureReason: `Node not found: ${currentNodeId}` };
      }

      context.set('current_node', currentNodeId);
      const shape = getStringAttr(node.attributes, 'shape', 'box');
      const handlerType = getStringAttr(node.attributes, 'type') || SHAPE_TO_HANDLER[shape] || 'codergen';
      const nodeLabel = getStringAttr(node.attributes, 'label', currentNodeId);

      // Handle exit node
      if (handlerType === 'exit') {
        const failedGates = this.checkGoalGates(graph, completedNodes, nodeOutcomes);
        if (failedGates.length > 0) {
          const retryTarget = this.findRetryTarget(failedGates[0]!, graph);
          if (retryTarget) {
            currentNodeId = retryTarget;
            continue;
          }
          await this.config.onEvent({
            kind: 'pipeline_failed',
            pipelineId,
            goal,
            reason: `Goal gate(s) failed: ${failedGates.join(', ')}`,
            timestamp: new Date(),
          });
          return { status: 'failed', completedNodes, failureReason: `Goal gate failed: ${failedGates.join(', ')}` };
        }

        completedNodes.push(currentNodeId);
        await this.config.onEvent({
          kind: 'pipeline_completed',
          pipelineId,
          goal,
          completedNodes: completedNodes.length,
          totalNodes,
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
        });
        return { status: 'completed', completedNodes };
      }

      // Handle start node (no-op)
      if (handlerType === 'start') {
        completedNodes.push(currentNodeId);
        const outcome = createOutcome({ status: StageStatus.SUCCESS });
        context.set('outcome', outcome.status);
        const edge = selectEdge(node, outcome, context, graph);
        currentNodeId = edge?.to ?? null;
        continue;
      }

      // Handle conditional node (no-op, just route)
      if (handlerType === 'conditional') {
        completedNodes.push(currentNodeId);
        const outcome = createOutcome({ status: StageStatus.SUCCESS });
        context.set('outcome', outcome.status);
        const edge = selectEdge(node, outcome, context, graph);
        currentNodeId = edge?.to ?? null;
        continue;
      }

      // Execute handler
      stageNum++;
      await this.config.onEvent({
        kind: 'stage_started',
        pipelineId,
        nodeId: currentNodeId,
        nodeLabel,
        stageNum,
        totalNodes,
        timestamp: new Date(),
      });

      const handler = this.config.handlers[handlerType];
      if (!handler) {
        await this.config.onEvent({
          kind: 'error',
          pipelineId,
          nodeId: currentNodeId,
          message: `No handler for type: ${handlerType}`,
          timestamp: new Date(),
        });
        return { status: 'failed', completedNodes, failureReason: `No handler for type: ${handlerType}` };
      }

      const stageStart = Date.now();
      let outcome: Outcome;
      try {
        outcome = await handler(node, context, graph);
      } catch (err) {
        outcome = createOutcome({
          status: StageStatus.FAIL,
          failureReason: err instanceof Error ? err.message : String(err),
        });
      }

      context.set('outcome', outcome.status);
      context.set('preferred_label', outcome.preferredLabel);
      if (Object.keys(outcome.contextUpdates).length > 0) {
        context.applyUpdates(outcome.contextUpdates);
      }

      nodeOutcomes[currentNodeId] = outcome.status;
      completedNodes.push(currentNodeId);

      await this.config.onEvent({
        kind: 'stage_completed',
        pipelineId,
        nodeId: currentNodeId,
        nodeLabel,
        stageNum,
        totalNodes,
        status: outcome.status,
        durationMs: Date.now() - stageStart,
        timestamp: new Date(),
      });

      // Save checkpoint
      if (this.config.checkpointDir) {
        saveCheckpoint(this.config.checkpointDir, {
          pipelineId,
          timestamp: new Date().toISOString(),
          currentNode: currentNodeId,
          completedNodes: [...completedNodes],
          nodeRetries: { ...nodeRetries },
          nodeOutcomes: { ...nodeOutcomes },
          contextValues: context.snapshot(),
          logs: [...context.logs()],
        });
      }

      // Handle retry
      if (outcome.status === StageStatus.FAIL || outcome.status === StageStatus.RETRY) {
        const retryCount = (nodeRetries[currentNodeId] ?? 0);
        const maxRetries = getIntegerAttr(node.attributes, 'max_retries',
          getIntegerAttr(graph.attributes, 'default_max_retry', 0));

        if (retryCount < maxRetries) {
          nodeRetries[currentNodeId] = retryCount + 1;
          context.set(`internal.retry_count.${currentNodeId}`, retryCount + 1);
          await this.config.onEvent({
            kind: 'stage_retrying',
            pipelineId,
            nodeId: currentNodeId,
            nodeLabel,
            retryCount: retryCount + 1,
            maxRetries,
            timestamp: new Date(),
          });
          const delay = retryDelay(retryCount);
          await new Promise(resolve => setTimeout(resolve, delay));
          completedNodes.pop();
          stageNum--;
          continue;
        }
      }

      // Select next edge
      const edge = selectEdge(node, outcome, context, graph);
      if (!edge) {
        if (outcome.status === StageStatus.FAIL) {
          const retryTarget = this.findRetryTarget(currentNodeId, graph);
          if (retryTarget) {
            currentNodeId = retryTarget;
            continue;
          }
        }
        await this.config.onEvent({
          kind: 'pipeline_failed',
          pipelineId,
          goal,
          reason: `No outgoing edge from "${currentNodeId}" with outcome "${outcome.status}"`,
          timestamp: new Date(),
        });
        return { status: 'failed', completedNodes, failureReason: `Dead end at ${currentNodeId}` };
      }

      const edgeLabel = getStringAttr(edge.attributes, 'label');
      if (edgeLabel) {
        await this.config.onEvent({
          kind: 'edge_selected',
          pipelineId,
          fromNode: currentNodeId,
          toNode: edge.to,
          edgeLabel,
          timestamp: new Date(),
        });
      }

      currentNodeId = edge.to;
    }

    if (iterations >= maxIterations) {
      await this.config.onEvent({
        kind: 'pipeline_failed',
        pipelineId,
        goal,
        reason: 'Max iterations exceeded (possible infinite loop)',
        timestamp: new Date(),
      });
      return { status: 'failed', completedNodes, failureReason: 'Max iterations exceeded' };
    }

    return { status: 'failed', completedNodes, failureReason: 'Traversal ended without reaching exit' };
  }

  private checkGoalGates(graph: Graph, completedNodes: string[], nodeOutcomes: Record<string, string>): string[] {
    const failed: string[] = [];
    for (const nodeId of completedNodes) {
      const node = graph.nodes.get(nodeId);
      if (!node) continue;
      if (getBooleanAttr(node.attributes, 'goal_gate')) {
        if (nodeOutcomes[nodeId] !== StageStatus.SUCCESS) {
          failed.push(nodeId);
        }
      }
    }
    return failed;
  }

  private findRetryTarget(nodeId: string, graph: Graph): string | null {
    const node = graph.nodes.get(nodeId);
    if (node) {
      const nodeTarget = getStringAttr(node.attributes, 'retry_target');
      if (nodeTarget && graph.nodes.has(nodeTarget)) return nodeTarget;
      const nodeFallback = getStringAttr(node.attributes, 'fallback_retry_target');
      if (nodeFallback && graph.nodes.has(nodeFallback)) return nodeFallback;
    }
    const graphTarget = getStringAttr(graph.attributes, 'retry_target');
    if (graphTarget && graph.nodes.has(graphTarget)) return graphTarget;
    const graphFallback = getStringAttr(graph.attributes, 'fallback_retry_target');
    if (graphFallback && graph.nodes.has(graphFallback)) return graphFallback;
    return null;
  }
}
