# Attractor Host-Level Pipeline Orchestration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move attractor pipeline orchestration from inside agent containers to the NanoClaw host, providing native visibility into pipeline execution across all channels.

**Architecture:** Port attractor's pure-logic modules (parser, context, conditions, edge selection) into `src/pipeline/`, build a host-side orchestrator that drives DAG traversal by sending prompts to containers via `runContainerAgent`, and emit formatted events through the existing router. Agents become dumb executors — they receive prompts and report outcomes.

**Tech Stack:** TypeScript, Node.js (no Bun), existing NanoClaw container runner + IPC + router.

---

### Task 1: Port DOT Parser Foundation (types, tokens, utilities)

Port the pure data types and utilities from attractor upstream. These have zero dependencies on Bun.

**Files:**
- Create: `src/pipeline/types.ts`
- Create: `src/pipeline/tokens.ts`
- Create: `src/pipeline/duration.ts`
- Create: `src/pipeline/label.ts`
- Test: `src/pipeline/duration.test.ts`

**Step 1: Write duration utility tests**

```typescript
// src/pipeline/duration.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, isDurationString } from './duration.js';

describe('parseDuration', () => {
  it('parses milliseconds', () => assert.equal(parseDuration('500ms'), 500));
  it('parses seconds', () => assert.equal(parseDuration('30s'), 30000));
  it('parses minutes', () => assert.equal(parseDuration('5m'), 300000));
  it('parses hours', () => assert.equal(parseDuration('2h'), 7200000));
  it('parses days', () => assert.equal(parseDuration('1d'), 86400000));
  it('throws on invalid', () => assert.throws(() => parseDuration('abc')));
});

describe('isDurationString', () => {
  it('recognizes durations', () => assert.equal(isDurationString('30s'), true));
  it('rejects non-durations', () => assert.equal(isDurationString('hello'), false));
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/pipeline/duration.test.ts`
Expected: FAIL — modules don't exist

**Step 3: Create types, tokens, duration, label**

Copy from attractor upstream with these changes:
- Replace `.js` import extensions (already correct for Node ESM)
- No other changes needed — these are pure TypeScript

Source files to port verbatim:
- `tokens.ts` from `attractor/src/parser/tokens.ts` (34 lines)
- `types.ts` from `attractor/src/types/graph.ts` (153 lines) — the `Graph`, `Node`, `Edge`, `AttributeValue` types and helpers
- `duration.ts` from `attractor/src/utils/duration.ts` (26 lines)
- `label.ts` from `attractor/src/utils/label.ts` (68 lines)

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/pipeline/duration.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/
git commit -m "feat(pipeline): port DOT parser foundation types and utilities"
```

---

### Task 2: Port DOT Lexer and Parser

Port the lexer and parser. These are pure functions with no external dependencies.

**Files:**
- Create: `src/pipeline/lexer.ts`
- Create: `src/pipeline/parser.ts`
- Test: `src/pipeline/parser.test.ts`

**Step 1: Write parser tests**

```typescript
// src/pipeline/parser.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from './lexer.js';
import { parseTokens } from './parser.js';

function parse(dot: string) {
  return parseTokens(tokenize(dot));
}

describe('DOT parser', () => {
  it('parses minimal graph', () => {
    const graph = parse('digraph G { start [shape=Mdiamond]; exit [shape=Msquare]; start -> exit }');
    assert.equal(graph.name, 'G');
    assert.equal(graph.nodes.size, 2);
    assert.equal(graph.edges.length, 1);
  });

  it('parses graph attributes', () => {
    const graph = parse('digraph G { graph [goal="Test pipeline"] }');
    const goal = graph.attributes.get('goal');
    assert.ok(goal);
    assert.equal(goal.kind, 'string');
    assert.equal(goal.value, 'Test pipeline');
  });

  it('parses node with prompt', () => {
    const graph = parse('digraph G { analyze [label="Analyze", prompt="Review the code"] }');
    const node = graph.nodes.get('analyze');
    assert.ok(node);
    assert.equal(node.attributes.get('prompt')?.value, 'Review the code');
  });

  it('parses edge conditions', () => {
    const graph = parse('digraph G { a -> b [condition="outcome=success"] }');
    assert.equal(graph.edges[0]?.attributes.get('condition')?.value, 'outcome=success');
  });

  it('parses chained edges', () => {
    const graph = parse('digraph G { a -> b -> c }');
    assert.equal(graph.edges.length, 2);
    assert.equal(graph.edges[0]?.from, 'a');
    assert.equal(graph.edges[0]?.to, 'b');
    assert.equal(graph.edges[1]?.from, 'b');
    assert.equal(graph.edges[1]?.to, 'c');
  });

  it('rejects non-digraph', () => {
    assert.throws(() => parse('graph G { a -> b }'));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/pipeline/parser.test.ts`
Expected: FAIL

**Step 3: Port lexer and parser**

Copy from attractor upstream:
- `lexer.ts` from `attractor/src/parser/lexer.ts` (337 lines)
- `parser.ts` from `attractor/src/parser/parser.ts` (439 lines)

Update imports to reference local `./tokens.js`, `./types.js`, `./duration.js`, `./label.js`.

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/pipeline/parser.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/lexer.ts src/pipeline/parser.ts src/pipeline/parser.test.ts
git commit -m "feat(pipeline): port DOT lexer and parser"
```

---

### Task 3: Port Context Store and Outcome Types

**Files:**
- Create: `src/pipeline/context.ts`
- Create: `src/pipeline/outcome.ts`
- Test: `src/pipeline/context.test.ts`

**Step 1: Write context tests**

```typescript
// src/pipeline/context.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from './context.js';

describe('Context', () => {
  it('set and get', () => {
    const ctx = new Context();
    ctx.set('key', 'value');
    assert.equal(ctx.getString('key'), 'value');
  });

  it('getString returns default for missing', () => {
    const ctx = new Context();
    assert.equal(ctx.getString('missing', 'default'), 'default');
  });

  it('clone creates independent copy', () => {
    const ctx = new Context();
    ctx.set('a', 'original');
    const clone = ctx.clone();
    clone.set('a', 'modified');
    assert.equal(ctx.getString('a'), 'original');
    assert.equal(clone.getString('a'), 'modified');
  });

  it('snapshot serializes values', () => {
    const ctx = new Context();
    ctx.set('x', 1);
    ctx.set('y', 'two');
    const snap = ctx.snapshot();
    assert.equal(snap['x'], 1);
    assert.equal(snap['y'], 'two');
  });

  it('applyUpdates merges values', () => {
    const ctx = new Context();
    ctx.set('a', 'old');
    ctx.applyUpdates({ a: 'new', b: 'added' });
    assert.equal(ctx.getString('a'), 'new');
    assert.equal(ctx.getString('b'), 'added');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/pipeline/context.test.ts`
Expected: FAIL

**Step 3: Port context and outcome**

Copy verbatim from attractor upstream:
- `context.ts` from `attractor/src/types/context.ts` (79 lines)
- `outcome.ts` from `attractor/src/types/outcome.ts` (32 lines)

No import changes needed — these are self-contained.

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/pipeline/context.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/context.ts src/pipeline/outcome.ts src/pipeline/context.test.ts
git commit -m "feat(pipeline): port context store and outcome types"
```

---

### Task 4: Port Condition Evaluator

**Files:**
- Create: `src/pipeline/conditions.ts`
- Test: `src/pipeline/conditions.test.ts`

**Step 1: Write condition evaluator tests**

```typescript
// src/pipeline/conditions.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCondition } from './conditions.js';
import { Context } from './context.js';
import { createOutcome, StageStatus } from './outcome.js';

function makeOutcome(status: string, preferredLabel = '') {
  return createOutcome({ status: status as any, preferredLabel });
}

describe('evaluateCondition', () => {
  it('empty condition is true', () => {
    assert.equal(evaluateCondition('', makeOutcome('success'), new Context()), true);
  });

  it('outcome=success matches', () => {
    assert.equal(evaluateCondition('outcome=success', makeOutcome('success'), new Context()), true);
  });

  it('outcome=success does not match fail', () => {
    assert.equal(evaluateCondition('outcome=success', makeOutcome('fail'), new Context()), false);
  });

  it('outcome!=success matches fail', () => {
    assert.equal(evaluateCondition('outcome!=success', makeOutcome('fail'), new Context()), true);
  });

  it('AND clauses both must pass', () => {
    const ctx = new Context();
    ctx.set('context.ready', 'true');
    assert.equal(evaluateCondition('outcome=success && context.ready=true', makeOutcome('success'), ctx), true);
    assert.equal(evaluateCondition('outcome=success && context.ready=false', makeOutcome('success'), ctx), false);
  });

  it('resolves context keys', () => {
    const ctx = new Context();
    ctx.set('my_flag', 'yes');
    assert.equal(evaluateCondition('my_flag=yes', makeOutcome('success'), ctx), true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/pipeline/conditions.test.ts`
Expected: FAIL

**Step 3: Port condition evaluator**

Copy from `attractor/src/conditions/evaluator.ts` (104 lines). Update imports to reference local `./outcome.js` and `./context.js`.

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/pipeline/conditions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/conditions.ts src/pipeline/conditions.test.ts
git commit -m "feat(pipeline): port condition expression evaluator"
```

---

### Task 5: Port Edge Selection Algorithm

**Files:**
- Create: `src/pipeline/edge-selection.ts`
- Test: `src/pipeline/edge-selection.test.ts`

**Step 1: Write edge selection tests**

```typescript
// src/pipeline/edge-selection.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectEdge } from './edge-selection.js';
import { Context } from './context.js';
import { createOutcome, StageStatus } from './outcome.js';
import type { Graph, Node, Edge } from './types.js';
import { stringAttr, integerAttr } from './types.js';

function makeGraph(nodes: Node[], edges: Edge[]): Graph {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  return { name: 'Test', attributes: new Map(), nodes: nodeMap, edges };
}

function makeNode(id: string): Node {
  return { id, attributes: new Map() };
}

function makeEdge(from: string, to: string, attrs: Record<string, any> = {}): Edge {
  const attrMap = new Map<string, any>();
  for (const [k, v] of Object.entries(attrs)) {
    attrMap.set(k, typeof v === 'string' ? stringAttr(v) : integerAttr(v));
  }
  return { from, to, attributes: attrMap };
}

describe('selectEdge', () => {
  it('selects condition-matching edge', () => {
    const graph = makeGraph(
      [makeNode('a'), makeNode('b'), makeNode('c')],
      [
        makeEdge('a', 'b', { condition: 'outcome=success' }),
        makeEdge('a', 'c', { condition: 'outcome=fail' }),
      ],
    );
    const outcome = createOutcome({ status: StageStatus.SUCCESS });
    const edge = selectEdge(graph.nodes.get('a')!, outcome, new Context(), graph);
    assert.equal(edge?.to, 'b');
  });

  it('falls back to unconditional edge', () => {
    const graph = makeGraph(
      [makeNode('a'), makeNode('b')],
      [makeEdge('a', 'b')],
    );
    const outcome = createOutcome({ status: StageStatus.SUCCESS });
    const edge = selectEdge(graph.nodes.get('a')!, outcome, new Context(), graph);
    assert.equal(edge?.to, 'b');
  });

  it('uses weight for tiebreaking', () => {
    const graph = makeGraph(
      [makeNode('a'), makeNode('b'), makeNode('c')],
      [
        makeEdge('a', 'b', { weight: 1 }),
        makeEdge('a', 'c', { weight: 10 }),
      ],
    );
    const outcome = createOutcome({ status: StageStatus.SUCCESS });
    const edge = selectEdge(graph.nodes.get('a')!, outcome, new Context(), graph);
    assert.equal(edge?.to, 'c');
  });

  it('returns undefined when no edges', () => {
    const graph = makeGraph([makeNode('a')], []);
    const outcome = createOutcome({ status: StageStatus.SUCCESS });
    const edge = selectEdge(graph.nodes.get('a')!, outcome, new Context(), graph);
    assert.equal(edge, undefined);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/pipeline/edge-selection.test.ts`
Expected: FAIL

**Step 3: Port edge selection**

Copy from `attractor/src/engine/edge-selection.ts` (102 lines). Update imports to local modules. Replace `import { evaluateCondition } from "../conditions/index.js"` with `import { evaluateCondition } from "./conditions.js"`.

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/pipeline/edge-selection.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/edge-selection.ts src/pipeline/edge-selection.test.ts
git commit -m "feat(pipeline): port 5-step edge selection algorithm"
```

---

### Task 6: Graph Validation

**Files:**
- Create: `src/pipeline/validate.ts`
- Test: `src/pipeline/validate.test.ts`

**Step 1: Write validation tests**

```typescript
// src/pipeline/validate.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateGraph } from './validate.js';
import { tokenize } from './lexer.js';
import { parseTokens } from './parser.js';

function parse(dot: string) {
  return parseTokens(tokenize(dot));
}

describe('validateGraph', () => {
  it('accepts valid graph', () => {
    const graph = parse(`digraph G {
      start [shape=Mdiamond]
      exit [shape=Msquare]
      start -> exit
    }`);
    const result = validateGraph(graph);
    assert.equal(result.errors.length, 0);
  });

  it('rejects missing start node', () => {
    const graph = parse(`digraph G { exit [shape=Msquare] }`);
    const result = validateGraph(graph);
    assert.ok(result.errors.some(e => e.includes('start')));
  });

  it('rejects missing exit node', () => {
    const graph = parse(`digraph G { start [shape=Mdiamond] }`);
    const result = validateGraph(graph);
    assert.ok(result.errors.some(e => e.includes('exit')));
  });

  it('rejects start with incoming edges', () => {
    const graph = parse(`digraph G {
      start [shape=Mdiamond]
      exit [shape=Msquare]
      a -> start
      start -> exit
    }`);
    const result = validateGraph(graph);
    assert.ok(result.errors.some(e => e.includes('incoming')));
  });

  it('warns on missing prompt for codergen node', () => {
    const graph = parse(`digraph G {
      start [shape=Mdiamond]
      work [shape=box]
      exit [shape=Msquare]
      start -> work -> exit
    }`);
    const result = validateGraph(graph);
    assert.ok(result.warnings.some(w => w.includes('prompt') || w.includes('label')));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/pipeline/validate.test.ts`
Expected: FAIL

**Step 3: Implement validation**

```typescript
// src/pipeline/validate.ts
import type { Graph } from './types.js';
import { getStringAttr, incomingEdges, outgoingEdges } from './types.js';

interface ValidationResult {
  errors: string[];
  warnings: string[];
}

const SHAPE_MAP: Record<string, string> = {
  Mdiamond: 'start',
  Msquare: 'exit',
  box: 'codergen',
  hexagon: 'wait.human',
  diamond: 'conditional',
  parallelogram: 'tool',
  component: 'parallel',
  tripleoctagon: 'fan_in',
};

export function validateGraph(graph: Graph): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Find start and exit nodes
  const startNodes: string[] = [];
  const exitNodes: string[] = [];
  for (const [id, node] of graph.nodes) {
    const shape = getStringAttr(node.attributes, 'shape', 'box');
    if (shape === 'Mdiamond') startNodes.push(id);
    if (shape === 'Msquare') exitNodes.push(id);
  }

  // Exactly one start
  if (startNodes.length === 0) {
    errors.push('Graph must have exactly one start node (shape=Mdiamond)');
  } else if (startNodes.length > 1) {
    errors.push(`Graph has ${startNodes.length} start nodes, expected exactly one: ${startNodes.join(', ')}`);
  }

  // At least one exit
  if (exitNodes.length === 0) {
    errors.push('Graph must have at least one exit node (shape=Msquare)');
  }

  // Start has no incoming edges
  for (const startId of startNodes) {
    if (incomingEdges(graph, startId).length > 0) {
      errors.push(`Start node "${startId}" must not have incoming edges`);
    }
  }

  // Exit has no outgoing edges
  for (const exitId of exitNodes) {
    if (outgoingEdges(graph, exitId).length > 0) {
      errors.push(`Exit node "${exitId}" must not have outgoing edges`);
    }
  }

  // All edge targets reference existing nodes
  for (const edge of graph.edges) {
    if (!graph.nodes.has(edge.from)) {
      errors.push(`Edge references unknown source node: "${edge.from}"`);
    }
    if (!graph.nodes.has(edge.to)) {
      errors.push(`Edge references unknown target node: "${edge.to}"`);
    }
  }

  // All nodes reachable from start
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

  // Warnings: codergen nodes should have prompt or label
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

  // Warnings: goal_gate nodes should have retry targets
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
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/pipeline/validate.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/validate.ts src/pipeline/validate.test.ts
git commit -m "feat(pipeline): add graph validation with error and warning lint rules"
```

---

### Task 7: Checkpoint System

**Files:**
- Create: `src/pipeline/checkpoint.ts`
- Test: `src/pipeline/checkpoint.test.ts`

**Step 1: Write checkpoint tests**

```typescript
// src/pipeline/checkpoint.test.ts
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { saveCheckpoint, loadCheckpoint, type Checkpoint } from './checkpoint.js';

describe('checkpoint', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves and loads checkpoint', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
    const cp: Checkpoint = {
      pipelineId: 'test-123',
      timestamp: new Date().toISOString(),
      currentNode: 'analyze',
      completedNodes: ['start'],
      nodeRetries: {},
      nodeOutcomes: { start: 'success' },
      contextValues: { 'graph.goal': 'Test' },
      logs: [],
    };
    saveCheckpoint(tmpDir, cp);
    const loaded = loadCheckpoint(tmpDir);
    assert.ok(loaded);
    assert.equal(loaded.pipelineId, 'test-123');
    assert.equal(loaded.currentNode, 'analyze');
    assert.deepEqual(loaded.completedNodes, ['start']);
  });

  it('returns null for missing checkpoint', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
    const loaded = loadCheckpoint(tmpDir);
    assert.equal(loaded, null);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/pipeline/checkpoint.test.ts`
Expected: FAIL

**Step 3: Implement checkpoint**

```typescript
// src/pipeline/checkpoint.ts
import fs from 'fs';
import path from 'path';
import type { ContextValue } from './context.js';

export interface Checkpoint {
  pipelineId: string;
  timestamp: string;
  currentNode: string;
  completedNodes: string[];
  nodeRetries: Record<string, number>;
  nodeOutcomes: Record<string, string>;
  contextValues: Record<string, ContextValue>;
  logs: string[];
}

export function saveCheckpoint(dir: string, checkpoint: Checkpoint): void {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'checkpoint.json');
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(checkpoint, null, 2));
  fs.renameSync(tempPath, filePath);
}

export function loadCheckpoint(dir: string): Checkpoint | null {
  const filePath = path.join(dir, 'checkpoint.json');
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as Checkpoint;
  } catch {
    return null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/pipeline/checkpoint.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/checkpoint.ts src/pipeline/checkpoint.test.ts
git commit -m "feat(pipeline): add checkpoint save/load for crash recovery"
```

---

### Task 8: Event Formatting and Verbosity

**Files:**
- Create: `src/pipeline/events.ts`
- Test: `src/pipeline/events.test.ts`

**Step 1: Write event formatting tests**

```typescript
// src/pipeline/events.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
    assert.ok(text);
    assert.ok(text.includes('Add RSI indicator'));
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
    assert.ok(text);
    assert.ok(text.includes('Analyze Codebase'));
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
    assert.equal(text, null);
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
    assert.ok(text);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/pipeline/events.test.ts`
Expected: FAIL

**Step 3: Implement events module**

```typescript
// src/pipeline/events.ts

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
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/pipeline/events.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/events.ts src/pipeline/events.test.ts
git commit -m "feat(pipeline): add event types, formatting, and verbosity filtering"
```

---

### Task 9: Pipeline Orchestrator Core

This is the main engine. It drives DAG traversal, calls handlers, manages context and retries, emits events, and saves checkpoints.

**Files:**
- Create: `src/pipeline/orchestrator.ts`
- Test: `src/pipeline/orchestrator.test.ts`

**Step 1: Write orchestrator tests**

Test with a stub handler that returns success/fail without touching containers.

```typescript
// src/pipeline/orchestrator.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PipelineOrchestrator, type NodeHandler, type OrchestratorConfig } from './orchestrator.js';
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
    assert.equal(result.status, 'completed');
    assert.ok(events.some(e => e.kind === 'pipeline_started'));
    assert.ok(events.some(e => e.kind === 'pipeline_completed'));
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
    assert.ok(visited.includes('test_node'));
    assert.ok(visited.includes('fail_node'));
    assert.ok(!visited.includes('pass_node'));
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
    assert.equal(result.status, 'completed');
    assert.equal(callCount, 3);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/pipeline/orchestrator.test.ts`
Expected: FAIL

**Step 3: Implement orchestrator**

This is the largest piece. The orchestrator:

1. Validates the graph
2. Finds the start node, initializes context from graph attributes
3. Traverses: for each node, resolves handler from shape, calls it, updates context, saves checkpoint, emits event, selects next edge
4. Handles retries (checks `max_retries`, tracks in `internal.retry_count.{nodeId}`)
5. Enforces goal gates at exit nodes
6. Emits events via `onEvent` callback

```typescript
// src/pipeline/orchestrator.ts
import type { Graph, Node } from './types.js';
import { getStringAttr, getIntegerAttr, getBooleanAttr, outgoingEdges } from './types.js';
import { Context } from './context.js';
import { createOutcome, StageStatus, type Outcome } from './outcome.js';
import { selectEdge } from './edge-selection.js';
import { validateGraph } from './validate.js';
import { saveCheckpoint, loadCheckpoint, type Checkpoint } from './checkpoint.js';
import type { PipelineEvent, Verbosity } from './events.js';

export type NodeHandler = (
  node: Node,
  context: Context,
  graph: Graph,
) => Promise<Outcome>;

export interface OrchestratorConfig {
  handlers: Record<string, NodeHandler>;
  onEvent: (event: PipelineEvent) => void;
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

const DEFAULT_MAX_RETRY = 50;

export class PipelineOrchestrator {
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config = config;
  }

  async run(graph: Graph): Promise<PipelineResult> {
    // Phase 1-2: Validate
    const validation = validateGraph(graph);
    if (validation.errors.length > 0) {
      return { status: 'failed', completedNodes: [], failureReason: validation.errors.join('; ') };
    }

    // Phase 3: Initialize
    const pipelineId = `pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const context = new Context();
    const goal = getStringAttr(graph.attributes, 'goal', '');
    context.set('graph.goal', goal);
    context.set('run_id', pipelineId);

    // Mirror graph attributes into context
    for (const [key, attr] of graph.attributes) {
      context.set(`graph.${key}`, attr.kind === 'string' ? attr.value : String(attr.value));
    }

    const completedNodes: string[] = [];
    const nodeRetries: Record<string, number> = {};
    const nodeOutcomes: Record<string, string> = {};
    const startTime = Date.now();

    // Find start node
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

    // Count executable nodes (excluding start/exit for display)
    const totalNodes = graph.nodes.size;
    let stageNum = 0;

    this.config.onEvent({
      kind: 'pipeline_started',
      pipelineId,
      goal,
      totalNodes,
      timestamp: new Date(),
    });

    // Phase 4: Execute
    const maxIterations = 1000; // safety limit
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
        // Goal gate enforcement
        const failedGates = this.checkGoalGates(graph, completedNodes, nodeOutcomes);
        if (failedGates.length > 0) {
          const retryTarget = this.findRetryTarget(failedGates[0]!, graph);
          if (retryTarget) {
            currentNodeId = retryTarget;
            continue;
          }
          this.config.onEvent({
            kind: 'pipeline_failed',
            pipelineId,
            goal,
            reason: `Goal gate(s) failed: ${failedGates.join(', ')}`,
            timestamp: new Date(),
          });
          return { status: 'failed', completedNodes, failureReason: `Goal gate failed: ${failedGates.join(', ')}` };
        }

        completedNodes.push(currentNodeId);
        this.config.onEvent({
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
      this.config.onEvent({
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
        this.config.onEvent({
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

      // Update context from outcome
      context.set('outcome', outcome.status);
      context.set('preferred_label', outcome.preferredLabel);
      if (Object.keys(outcome.contextUpdates).length > 0) {
        context.applyUpdates(outcome.contextUpdates);
      }

      nodeOutcomes[currentNodeId] = outcome.status;
      completedNodes.push(currentNodeId);

      this.config.onEvent({
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
          this.config.onEvent({
            kind: 'stage_retrying',
            pipelineId,
            nodeId: currentNodeId,
            nodeLabel,
            retryCount: retryCount + 1,
            maxRetries,
            timestamp: new Date(),
          });
          // Stay on same node (don't advance currentNodeId)
          completedNodes.pop(); // remove from completed since we're retrying
          stageNum--; // don't increment stage counter
          continue;
        }
      }

      // Select next edge
      const edge = selectEdge(node, outcome, context, graph);
      if (!edge) {
        // No edge — check failure routing cascade
        if (outcome.status === StageStatus.FAIL) {
          const retryTarget = this.findRetryTarget(currentNodeId, graph);
          if (retryTarget) {
            currentNodeId = retryTarget;
            continue;
          }
        }
        this.config.onEvent({
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
        this.config.onEvent({
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
      this.config.onEvent({
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
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/pipeline/orchestrator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/orchestrator.ts src/pipeline/orchestrator.test.ts
git commit -m "feat(pipeline): add core orchestrator with DAG traversal, retries, goal gates"
```

---

### Task 10: Container Handler (connect orchestrator to runContainerAgent)

This wires the orchestrator to NanoClaw's container runner. The handler sends node prompts to the agent and parses outcome tags from the response.

**Files:**
- Create: `src/pipeline/container-handler.ts`
- Test: `src/pipeline/container-handler.test.ts`

**Step 1: Write container handler tests**

```typescript
// src/pipeline/container-handler.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildNodePrompt, parseOutcome } from './container-handler.js';
import { Context } from './context.js';
import type { Node } from './types.js';
import { stringAttr } from './types.js';

describe('buildNodePrompt', () => {
  it('builds prompt from node prompt attribute', () => {
    const node: Node = { id: 'test', attributes: new Map([['prompt', stringAttr('Review the code')]]) };
    const ctx = new Context();
    ctx.set('graph.goal', 'Add feature X');
    const prompt = buildNodePrompt(node, ctx);
    assert.ok(prompt.includes('Review the code'));
    assert.ok(prompt.includes('Add feature X'));
  });

  it('falls back to label when no prompt', () => {
    const node: Node = { id: 'test', attributes: new Map([['label', stringAttr('Analyze')]]) };
    const prompt = buildNodePrompt(node, new Context());
    assert.ok(prompt.includes('Analyze'));
  });

  it('expands $goal variable', () => {
    const node: Node = { id: 'test', attributes: new Map([['prompt', stringAttr('Work toward $goal')]]) };
    const ctx = new Context();
    ctx.set('graph.goal', 'shipping');
    const prompt = buildNodePrompt(node, ctx);
    assert.ok(prompt.includes('Work toward shipping'));
  });
});

describe('parseOutcome', () => {
  it('parses success tag', () => {
    const result = parseOutcome('Done! Everything works.\n[outcome:success]');
    assert.equal(result.status, 'success');
  });

  it('parses fail tag', () => {
    const result = parseOutcome('Tests failed.\n[outcome:fail]');
    assert.equal(result.status, 'fail');
  });

  it('parses preferred_label', () => {
    const result = parseOutcome('[outcome:success]\n[preferred_label:Approve]');
    assert.equal(result.preferredLabel, 'Approve');
  });

  it('defaults to success when no tag', () => {
    const result = parseOutcome('All done, looks good.');
    assert.equal(result.status, 'success');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/pipeline/container-handler.test.ts`
Expected: FAIL

**Step 3: Implement container handler**

```typescript
// src/pipeline/container-handler.ts
import type { Node, Graph } from './types.js';
import { getStringAttr } from './types.js';
import { Context } from './context.js';
import { createOutcome, StageStatus, type Outcome } from './outcome.js';
import type { NodeHandler } from './orchestrator.js';

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

/**
 * Create a NodeHandler that sends prompts to a container and parses outcomes.
 * `runPrompt` is the function that sends a prompt to the container and returns the response text.
 */
export function createContainerHandler(
  runPrompt: (prompt: string, node: Node) => Promise<string>,
): NodeHandler {
  return async (node: Node, context: Context, _graph: Graph): Promise<Outcome> => {
    const prompt = buildNodePrompt(node, context);
    const response = await runPrompt(prompt, node);
    return parseOutcome(response);
  };
}

/**
 * Create a tool handler that sends the tool_command as a prompt for the agent to execute.
 */
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
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/pipeline/container-handler.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/container-handler.ts src/pipeline/container-handler.test.ts
git commit -m "feat(pipeline): add container handler with prompt building and outcome parsing"
```

---

### Task 11: IPC Integration (start_pipeline type + human gate replies)

Wire the pipeline into NanoClaw's IPC system so agents can request pipelines and users can respond to human gates.

**Files:**
- Modify: `src/ipc.ts` — add `start_pipeline` case
- Modify: `src/types.ts` — add pipeline-related types to IpcDeps
- Create: `src/pipeline/runner.ts` — high-level entry point that creates an orchestrator with real container handlers
- Test: `src/pipeline/runner.test.ts`

**Step 1: Write runner tests**

Test the high-level `startPipelineRun` function with a mock sendMessage and a mock container runner.

```typescript
// src/pipeline/runner.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startPipelineRun, type PipelineRunDeps } from './runner.js';

describe('startPipelineRun', () => {
  it('parses DOT and emits events via sendMessage', async () => {
    const messages: string[] = [];
    const deps: PipelineRunDeps = {
      sendMessage: async (_jid, text) => { messages.push(text); },
      runContainerPrompt: async (prompt, _node, _groupFolder, _chatJid) => {
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
    assert.equal(result.status, 'completed');
    assert.ok(messages.some(m => m.includes('Test run')));
    assert.ok(messages.some(m => m.includes('Complete')));
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
    assert.equal(result.status, 'failed');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/pipeline/runner.test.ts`
Expected: FAIL

**Step 3: Implement runner**

```typescript
// src/pipeline/runner.ts
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
  // Parse
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

  // Create prompt runner bound to this group
  const runPrompt = (prompt: string, node: Node) =>
    deps.runContainerPrompt(prompt, node, deps.groupFolder, deps.chatJid);

  // Build handlers
  const codergenHandler = createContainerHandler(runPrompt);
  const toolHandler = createToolHandler(runPrompt);

  // Create orchestrator
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
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/pipeline/runner.test.ts`
Expected: PASS

**Step 5: Add `start_pipeline` case to ipc.ts**

Add a new case in the `processTaskIpc` switch statement. Add `dot` and `verbosity` to the data parameter type. The handler calls `startPipelineRun` asynchronously (fire-and-forget, not blocking the IPC poll loop).

Also add `startPipelineRun` dependency to `IpcDeps` or pass it directly.

**Step 6: Run build to verify compilation**

Run: `npm run build`
Expected: Clean build

**Step 7: Commit**

```bash
git add src/pipeline/runner.ts src/pipeline/runner.test.ts src/ipc.ts src/types.ts
git commit -m "feat(pipeline): add pipeline runner and IPC start_pipeline integration"
```

---

### Task 12: Index Integration (hook pipeline into main process)

Wire the pipeline runner into `src/index.ts` so that:
1. The IPC watcher can trigger pipelines
2. The container runner is available to the pipeline for sending prompts

**Files:**
- Modify: `src/index.ts` — pass pipeline deps when starting IPC watcher
- Modify: `src/ipc.ts` — add start_pipeline case using deps

**Step 1: Read current index.ts to identify exact integration points**

Find where `startIpcWatcher(deps)` is called and what deps are passed. Add a `startPipeline` function that creates `PipelineRunDeps` from the existing `runAgent` / `runContainerAgent` infrastructure.

**Step 2: Implement the integration**

The key function: `runContainerPrompt(prompt, node, groupFolder, chatJid)` needs to:
1. Create a `ContainerInput` with the prompt
2. Call `runContainerAgent` (or use `GroupQueue.enqueueTask`)
3. Return the result text

This reuses the existing container machinery. The pipeline's `runContainerPrompt` should go through the `GroupQueue` to respect concurrency limits.

**Step 3: Run build and tests**

Run: `npm run build && npx tsx --test src/pipeline/*.test.ts`
Expected: All pass

**Step 4: Commit**

```bash
git add src/index.ts src/ipc.ts
git commit -m "feat(pipeline): integrate pipeline runner into main process"
```

---

### Task 13: Update Add-Attractor Skill

Update the skill to reflect the new architecture. The container CLAUDE.md shrinks to DOT syntax reference. The skill manifest adds the new `src/pipeline/` files.

**Files:**
- Modify: `.claude/skills/add-attractor/manifest.yaml` — add new source files
- Modify: `.claude/skills/add-attractor/SKILL.md` — update setup phases
- Rewrite: `.claude/skills/add-attractor/add/container/skills/attractor/CLAUDE.md` — DOT syntax reference only, no engine setup

**Step 1: Rewrite container CLAUDE.md**

Remove all engine setup instructions (Bun, git clone, PipelineRunner). Replace with:
- DOT syntax reference (node shapes, edge attributes, conditions)
- How to request a pipeline via IPC: `{type: "start_pipeline", dot: "...", goal: "..."}`
- Example workflow patterns
- Outcome reporting instructions (the `[outcome:success]` / `[outcome:fail]` tags the agent should use)

**Step 2: Update manifest.yaml**

Add new files to the `adds` list:
```yaml
adds:
  - src/pipeline/types.ts
  - src/pipeline/tokens.ts
  - src/pipeline/duration.ts
  - src/pipeline/label.ts
  - src/pipeline/lexer.ts
  - src/pipeline/parser.ts
  - src/pipeline/context.ts
  - src/pipeline/outcome.ts
  - src/pipeline/conditions.ts
  - src/pipeline/edge-selection.ts
  - src/pipeline/validate.ts
  - src/pipeline/checkpoint.ts
  - src/pipeline/events.ts
  - src/pipeline/orchestrator.ts
  - src/pipeline/container-handler.ts
  - src/pipeline/runner.ts
  - container/skills/attractor/CLAUDE.md
modifies:
  - src/ipc.ts
  - src/index.ts
```

**Step 3: Update SKILL.md**

Update phase descriptions to reflect that this now adds host-side pipeline orchestration code rather than just container-side docs.

**Step 4: Run build**

Run: `npm run build`
Expected: Clean

**Step 5: Commit**

```bash
git add .claude/skills/add-attractor/
git commit -m "feat(skills): update add-attractor skill for host-level orchestration"
```

---

### Task 14: Run All Tests and Final Verification

**Step 1: Run all pipeline tests**

Run: `npx tsx --test src/pipeline/*.test.ts`
Expected: All pass

**Step 2: Run full project build**

Run: `npm run build`
Expected: Clean

**Step 3: Run existing project tests**

Run: `npm test`
Expected: No regressions

**Step 4: Manual smoke test**

Send a message to NanoClaw that triggers the agent to create and request a pipeline. Verify:
- Events appear in configured channels
- Pipeline completes or fails gracefully
- Checkpoint file is created

**Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(pipeline): address test/build issues from integration"
```
