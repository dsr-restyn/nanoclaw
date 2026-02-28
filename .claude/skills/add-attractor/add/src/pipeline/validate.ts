import type { Graph } from './types.js';
import { getStringAttr, incomingEdges, outgoingEdges } from './types.js';

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export function validateGraph(graph: Graph): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const startNodes: string[] = [];
  const exitNodes: string[] = [];
  for (const [id, node] of graph.nodes) {
    const shape = getStringAttr(node.attributes, 'shape', 'box');
    if (shape === 'Mdiamond') startNodes.push(id);
    if (shape === 'Msquare') exitNodes.push(id);
  }

  if (startNodes.length === 0) {
    errors.push('Graph must have exactly one start node (shape=Mdiamond)');
  } else if (startNodes.length > 1) {
    errors.push(`Graph has ${startNodes.length} start nodes, expected exactly one: ${startNodes.join(', ')}`);
  }

  if (exitNodes.length === 0) {
    errors.push('Graph must have at least one exit node (shape=Msquare)');
  }

  for (const startId of startNodes) {
    if (incomingEdges(graph, startId).length > 0) {
      errors.push(`Start node "${startId}" must not have incoming edges`);
    }
  }

  for (const exitId of exitNodes) {
    if (outgoingEdges(graph, exitId).length > 0) {
      errors.push(`Exit node "${exitId}" must not have outgoing edges`);
    }
  }

  for (const edge of graph.edges) {
    if (!graph.nodes.has(edge.from)) {
      errors.push(`Edge references unknown source node: "${edge.from}"`);
    }
    if (!graph.nodes.has(edge.to)) {
      errors.push(`Edge references unknown target node: "${edge.to}"`);
    }
  }

  if (startNodes.length === 1) {
    const reachable = new Set<string>();
    const queue = [startNodes[0]!];
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (reachable.has(nodeId)) continue;
      reachable.add(nodeId);
      for (const edge of outgoingEdges(graph, nodeId)) {
        queue.push(edge.to);
      }
    }
    for (const nodeId of graph.nodes.keys()) {
      if (!reachable.has(nodeId)) {
        errors.push(`Node "${nodeId}" is not reachable from start`);
      }
    }
  }

  for (const [id, node] of graph.nodes) {
    const shape = getStringAttr(node.attributes, 'shape', 'box');
    if (shape === 'box' || shape === '') {
      const prompt = getStringAttr(node.attributes, 'prompt');
      const label = getStringAttr(node.attributes, 'label');
      if (!prompt && !label) {
        warnings.push(`Codergen node "${id}" has no prompt or label`);
      }
    }
  }

  for (const [id, node] of graph.nodes) {
    const goalGate = getStringAttr(node.attributes, 'goal_gate');
    if (goalGate === 'true') {
      const retryTarget = getStringAttr(node.attributes, 'retry_target');
      const graphRetry = getStringAttr(graph.attributes, 'retry_target');
      if (!retryTarget && !graphRetry) {
        warnings.push(`Goal gate node "${id}" has no retry_target`);
      }
    }
  }

  return { errors, warnings };
}
