# Attractor Host-Level Pipeline Orchestration

## Problem

NanoClaw agents can run multi-step workflows using the Attractor pipeline engine, but there's zero visibility into execution. The current architecture has the agent clone a separate TypeScript engine (requiring Bun), run it as a subprocess inside the container, and manually report progress via IPC. Events stay trapped inside the container, the agent can forget to report, and debugging pipeline failures is blind.

## Solution

Move pipeline orchestration from inside the container to the NanoClaw host. The host parses DOT workflow graphs, drives DAG traversal, manages retries and routing, and emits events natively to all configured channels. Agents become simple executors — they receive prompts and do work without knowing they're part of a pipeline.

This eliminates the Bun dependency, the attractor clone step, the IPC event bridge, and the reliance on agents to self-report. The host owns the full execution state, so visibility is free.

## Architecture

```
User/Agent triggers pipeline
            ↓
   Host: Parse DOT → Validate → Build DAG
            ↓
   ┌────────────────────────────────┐
   │   Pipeline Orchestrator (host) │
   │                                │
   │   For each node:               │
   │    1. Resolve fidelity/session │
   │    2. Build prompt from node   │
   │    3. Send to container        │
   │    4. Read result + outcome    │
   │    5. Update context           │
   │    6. Save checkpoint          │
   │    7. Emit event to channels   │
   │    8. Select next edge         │
   └────────────────────────────────┘
            ↓
   Agent container receives normal
   prompts, does work, reports outcome
```

## Spec Compliance

The orchestrator implements StrongDM's attractor nlspec. Key requirements and how they map:

### Execution Lifecycle

Five phases: PARSE → VALIDATE → INITIALIZE → EXECUTE → FINALIZE.

- **Parse**: DOT string to in-memory graph model. Adapt attractor's parser (~200 LOC) or use a minimal graphviz parser.
- **Validate**: Run error-level lint rules before execution. Reject graphs that fail (missing start node, unreachable nodes, bad conditions, etc.). Warn on non-fatal issues.
- **Initialize**: Create run directory under group data, build initial context from graph attributes, apply variable expansion.
- **Execute**: Traverse from start node. Single-threaded at the top level.
- **Finalize**: Write final checkpoint, emit completion event, clean up.

### Node Types

Shape-to-handler mapping. Each shape triggers different host behavior:

| Shape | Handler | Host Behavior |
|-------|---------|---------------|
| `Mdiamond` | start | No-op. Begin traversal. |
| `Msquare` | exit | Check goal gates. If all pass, emit completion. If any failed, jump to retry target. |
| `box` (default) | codergen | Build prompt from node attributes + context. Send to agent container. Read result. |
| `parallelogram` | tool | Send `tool_command` as agent prompt. Agent executes and reports. |
| `hexagon` | wait.human | Emit choices (from outgoing edge labels) to channels. Pause. Wait for user reply. Route based on selection. |
| `diamond` | conditional | No agent call. Host evaluates edge conditions against context and routes. |
| `component` | parallel | Fan-out: spawn concurrent container sessions per branch with isolated context clones. |
| `tripleoctagon` | fan_in | Wait for all branches. Merge results. |

**Deferred to v2:** `house` (manager loop / supervisor pattern), model stylesheet.

### Edge Selection

Five-step deterministic algorithm (spec section 3.5):

1. Condition-matching edges (evaluate against context/outcome, select by weight then lexical)
2. Preferred label match (from handler outcome)
3. Suggested next IDs (from handler outcome)
4. Highest weight among unconditional edges
5. Lexical tiebreak on target node ID

### Context Store

Key-value store flowing through the pipeline. Host maintains it, passes relevant context into each node's prompt.

Built-in keys set by the engine:
- `outcome` — last handler result (success/fail)
- `preferred_label` — last handler's preferred edge
- `graph.goal` — from graph `goal` attribute
- `current_node` — currently executing node ID
- `internal.retry_count.<node_id>` — per-node retry counter

Handlers return `contextUpdates` in their outcome. Host applies them after each node.

### Context Fidelity

Controls how much prior state carries into the next node's session. Maps to NanoClaw's container session model:

| Mode | NanoClaw Behavior |
|------|-------------------|
| `full` | Reuse existing container session. Agent retains full conversation history. |
| `truncate` | Fresh container. Minimal prompt (goal + node prompt only). |
| `compact` (default) | Fresh container. Host constructs structured summary of completed nodes as opening context. |
| `summary:low` | Fresh container. Brief summary (~600 tokens). |
| `summary:medium` | Fresh container. Moderate summary (~1500 tokens). |
| `summary:high` | Fresh container. Detailed summary (~3000 tokens). |

Resolution precedence: edge `fidelity` → node `fidelity` → graph `default_fidelity` → `compact`.

For `full` fidelity, the host sends follow-up prompts to the same container session via IPC input. For all others, the host spawns a fresh container (or reuses with a summary preamble).

Nodes can also set `isolated=true` to force a fresh container regardless of fidelity.

### Checkpoint and Resume

After every node completes, the host writes a checkpoint JSON to `{DATA_DIR}/pipelines/{run_id}/checkpoint.json`:

```json
{
  "run_id": "pipeline-1709123456-abc123",
  "graph_dot": "<original DOT source>",
  "current_node": "implement",
  "completed_nodes": ["start", "analyze", "design"],
  "context": { "outcome": "success", "graph.goal": "Add RSI indicator" },
  "node_retries": { "test": 1 },
  "session_id": "sess-abc123",
  "started_at": "2026-02-28T10:00:00Z",
  "chat_jid": "group@jid",
  "group_folder": "main",
  "verbosity": "standard"
}
```

On NanoClaw restart, the orchestrator scans for incomplete checkpoints and resumes. If the previous node used `full` fidelity, the first resumed node degrades to `summary:high` (in-memory session state can't be serialized).

### Goal Gate Enforcement

Nodes with `goal_gate=true` must succeed before the pipeline can exit. When traversal reaches an exit node:

1. Check all visited goal gate nodes
2. If any has non-success outcome, do NOT exit
3. Jump to: node `retry_target` → graph `retry_target` → graph `fallback_retry_target`
4. If no retry target exists, pipeline FAILS

### Retry Logic

- `max_retries` on a node = additional attempts beyond initial (e.g., `max_retries=3` = 4 total)
- Graph `default_max_retry` = fallback ceiling (default: 50)
- Exponential backoff with jitter (200ms initial, 2x factor, 60s max)
- SUCCESS/PARTIAL_SUCCESS reset the retry counter

Failure routing cascade:
1. Fail edge (outgoing edge with `condition="outcome=fail"`)
2. Node `retry_target` attribute
3. Graph `retry_target` attribute
4. Graph `fallback_retry_target` attribute
5. Pipeline termination

### Validation Rules

**Error (reject pipeline):**
- Exactly one start node (Mdiamond)
- At least one exit node (Msquare)
- Start has no incoming edges
- Exit has no outgoing edges
- All nodes reachable from start
- All edge targets reference existing nodes
- Edge conditions must parse correctly

**Warning (proceed but log):**
- Unknown node type values
- Invalid fidelity values
- retry_target/fallback_retry_target must reference existing nodes
- goal_gate nodes should have retry targets
- Codergen nodes should have prompt or label

### Condition Expressions

Minimal boolean language for edge conditions:

```
ConditionExpr ::= Clause ( '&&' Clause )*
Clause        ::= Key Operator Literal
Operator      ::= '=' | '!='
```

- `outcome` resolves to handler status
- `context.*` keys look up context values
- Missing keys = empty string
- String comparison is exact, case-sensitive

### Event Emission

The host emits events natively since it's the orchestrator. Event types:

- **Pipeline**: `PipelineStarted`, `PipelineCompleted`, `PipelineFailed`
- **Stage**: `StageStarted`, `StageCompleted`, `StageFailed`, `StageRetrying`
- **Parallel**: `ParallelStarted`, `ParallelBranchStarted`, `ParallelBranchCompleted`, `ParallelCompleted`
- **Human**: `InterviewStarted`, `InterviewCompleted`, `InterviewTimeout`
- **Checkpoint**: `CheckpointSaved`

Events are formatted and routed to all configured channels via `routeOutbound`.

### Human-in-the-Loop

The `wait.human` handler (hexagon nodes) uses NanoClaw's existing channel infrastructure:

1. Host extracts choices from outgoing edge labels (with accelerator key parsing: `[A] Approve` → key `A`)
2. Host formats and sends choices to the group's channels
3. Pipeline pauses, waiting for user reply
4. User replies via any channel. Host matches the reply to the pipeline and routes accordingly.
5. Freeform edges (`freeform="true"`) allow free-text input in addition to fixed choices.

## Pipeline Triggering

Two entry points:

### Agent-Initiated

Agent decides a task warrants a pipeline and writes an IPC request:

```json
{
  "type": "start_pipeline",
  "dot": "digraph Feature {\n  graph [goal=\"Add RSI indicator\"]\n  start [shape=Mdiamond]\n  ...\n}",
  "goal": "Add RSI indicator",
  "verbosity": "standard"
}
```

Host validates the DOT, builds the DAG, and starts orchestrating. The agent's current session becomes the execution target for `full` fidelity nodes.

### User-Initiated

User sends a chat command like `/pipeline <dot or reference>`. Host intercepts, spawns a container, and orchestrates.

## Dynamic Workflow Creation

Agents create DOT workflows on the fly. No template library required. The agent's CLAUDE.md includes:

- DOT syntax reference (node shapes, edge attributes, conditions)
- Pattern examples (test loop, human gate, parallel fan-out, retry with goal gates)
- Guidelines for when to use a pipeline vs. direct execution

The agent composes a workflow graph based on the task, submits it inline in the IPC request, and the host takes over.

## Verbosity Levels

Configured per-pipeline (in the IPC request or chat command). Host filters events before routing.

### Minimal (~3-5 messages per run)
- Pipeline start
- Pipeline end (success/fail)
- Errors only

### Standard (default, ~10-15 messages per run)
- Pipeline start/end
- Each node start/complete
- Routing decisions (conditional edges)
- Retries and loop detection
- Errors

### Verbose (~20-30 messages per run)
- Everything in standard
- Agent response summaries
- Context updates
- Checkpoint saves

### Formatting

```
[Pipeline] Feature: Add RSI Indicator
  → Analyze Codebase (1/5)
  ✓ Analyze Codebase — 45s
  → Design Solution (2/5)
  ✓ Design Solution — 1m 12s
  → Implement (3/5)
  ✓ Implement — 2m 30s
  → Run Tests (4/5)
  ✗ Run Tests — 3s — 2 failures
  ↻ Retry: Fix Failures → Run Tests (1/3)
  → Fix Failures (4/5)
  ✓ Fix Failures — 1m 5s
  → Run Tests (4/5)
  ✓ Run Tests — 8s
  → Exit (5/5)
✓ Pipeline complete — 7m 33s
```

## Outcome Reporting

After each node prompt, the host needs to determine success/fail. The node prompt includes a system instruction:

> When you complete this task, end your response with `[outcome:success]` if the task succeeded or `[outcome:fail]` if it failed. Include `[preferred_label:...]` if you recommend a specific next step.

The host parses these structured tags from the container's result output.

## Skill Structure

The add-attractor skill changes:

```
.claude/skills/add-attractor/
├── manifest.yaml                    # adds src/pipeline.ts, modifies src/ipc.ts + src/index.ts
├── SKILL.md                         # updated setup phases
├── add/
│   ├── src/
│   │   ├── pipeline.ts              # host-side orchestrator (core)
│   │   ├── dot-parser.ts            # DOT parsing + validation
│   │   └── pipeline-events.ts       # event formatting + verbosity filtering
│   └── container/skills/attractor/
│       └── CLAUDE.md                # simplified: DOT syntax reference + patterns
└── modify/
    ├── src/index.ts                 # hook pipeline lifecycle into message loop
    └── src/ipc.ts                   # handle start_pipeline + human gate replies
```

The container CLAUDE.md shrinks to DOT syntax reference and workflow patterns. No engine setup, no Bun, no progress reporting instructions.

## Scope

### v1
- Host orchestrator with full nlspec execution lifecycle
- All handler types except `house` (manager loop)
- Context fidelity mapped to session management
- Checkpoint/resume
- Goal gate enforcement
- Retry cascade
- Validation/lint rules
- Dynamic workflow creation (agent writes DOT inline)
- Configurable verbosity (minimal/standard/verbose)
- Events routed to all channels
- Agent-initiated and user-initiated triggers
- Human gates via channel messages

### v2
- `house` handler (supervisor/child pipeline pattern)
- Model stylesheet (per-node LLM configuration)
- Persistent pipeline history (SQLite storage, queryable)
- Pipeline dashboard (HTTP/SSE web UI)
- Artifact tracking (diffs, files created/modified per node)
