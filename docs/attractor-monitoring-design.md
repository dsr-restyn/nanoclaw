# Attractor Pipeline Monitoring Design

## Problem Statement

Currently, when Andy uses the Attractor autonomous pipeline system, there is zero visibility into:
- Whether the pipeline is actually running
- What node is currently executing
- If the pipeline gets stuck in loops
- When/why the pipeline fails or aborts
- What decisions the agent makes during execution

This makes it impossible to debug issues, monitor progress, or understand the agent's workflow execution process.

## Solution: Anytype + Telegram Monitoring

Implement a dual-channel monitoring system:
1. **Anytype**: Structured, persistent execution logs and event history
2. **Telegram**: Real-time notifications for key milestones and errors

---

## Data Model (Anytype)

### Type: Pipeline Run

**Purpose:** Track a single Attractor pipeline execution from start to finish.

**Properties:**
- **Name** (text): "RSI Implementation (Attractor)" - human-readable title
- **Status** (select): Not Started | Running | Completed | Failed | Aborted
- **Start Time** (date): When pipeline execution began
- **End Time** (date): When pipeline execution finished
- **Duration** (number): Total execution time in seconds
- **Goal** (text): The `graph [goal="..."]` from DOT file
- **Workflow File** (text): Path to .dot file (e.g., `/tmp/implement-rsi.dot`)
- **Total Nodes** (number): Total nodes in the workflow graph
- **Completed Nodes** (number): How many nodes finished successfully
- **Current Node** (text): Which node is currently executing
- **Exit Status** (text): Success message or failure reason
- **Checkpoint Directory** (text): Path to checkpoint logs
- **Agent Model** (text): Which Claude model executed the pipeline
- **Token Usage** (number): Total tokens consumed across all LLM calls
- **Events** (objects): Backlinks to Pipeline Event objects

### Type: Pipeline Event

**Purpose:** Log individual events during pipeline execution for detailed audit trail.

**Properties:**
- **Pipeline Run** (object): Link back to parent Pipeline Run
- **Timestamp** (date): When this event occurred
- **Event Type** (select):
  - Pipeline Started
  - Pipeline Completed
  - Pipeline Failed
  - Stage Started
  - Stage Completed
  - Edge Selected
  - LLM Call
  - Tool Execution
  - Loop Detected
  - Error
- **Node ID** (text): Technical node identifier
- **Node Label** (text): Human-readable node name
- **Status** (select): Running | Success | Fail | Skipped
- **Details** (text): Error messages, tool output, LLM response snippets
- **Tokens Used** (number): For LLM Call events
- **Duration** (number): How long this event took (seconds)
- **Stage Number** (number): Which stage in sequence (1, 2, 3...)

---

## Telegram Notifications

### Notification Format Examples

**Pipeline Started:**
```
🚀 Attractor Pipeline Started
   RSI Implementation
   11 nodes • claude-sonnet-4
   /workspace/group/paca-lite
```

**Stage Started:**
```
▶️  Stage: Analyze Codebase
   Node 1/11 • Running...
```

**Stage Completed (Success):**
```
✅ Stage: Analyze Codebase
   Node 1/11 • Completed (2m 15s)
   1,247 tokens
```

**Stage Completed (Fail):**
```
❌ Stage: Run Tests
   Node 8/11 • Failed (0m 3s)
   Error: pytest command not found
```

**Edge Selected (Routing Decision):**
```
↪️  Route: Fix Test Failures
   Following "Fail" edge
```

**Loop Detected:**
```
🔄 Loop Detected
   run_tests executed 15 times
   Possible infinite loop!
```

**Pipeline Completed:**
```
✨ Pipeline Completed
   RSI Implementation
   10/11 nodes • 18m 42s
   12,543 tokens
```

**Pipeline Failed:**
```
❌ Pipeline Failed
   RSI Implementation
   Stuck in test loop after node 8
   Agent aborting, switching to manual
```

### Notification Rules

**Always Notify:**
- Pipeline start
- Pipeline end (success/fail/abort)
- Errors
- Loop detection
- Agent decision to abort

**Conditionally Notify:**
- Stage start (only if expected duration >30s)
- Stage completion (always)
- Edge selection (only for conditional branches)
- Progress updates (every 5 minutes if still running)

**Notification Verbosity Levels:**

**Level 1 - Minimal** (3-5 messages per run)
- Pipeline start
- Errors only
- Final result

**Level 2 - Moderate** (10-15 messages per run) *[RECOMMENDED DEFAULT]*
- Pipeline start/end
- Each major stage completion
- Errors and loop detection
- Routing decisions

**Level 3 - Verbose** (20-30 messages per run)
- Pipeline start/end
- Every single node start/completion
- All edge selections
- All LLM calls with token counts
- Tool executions

---

## Implementation Architecture

### Component 1: Anytype Event Logger

**File:** `attractor-monitoring/anytype-logger.ts`

```typescript
interface PipelineRunConfig {
  name: string;
  goal: string;
  workflowFile: string;
  totalNodes: number;
  checkpointDir: string;
  agentModel: string;
}

class AnytypeLogger {
  private runId: string | null = null;
  private spaceId: string;

  async startPipeline(config: PipelineRunConfig): Promise<string> {
    // Create Pipeline Run object in Anytype
    const run = await anytype.createObject({
      type: "pipeline_run",
      name: config.name,
      status: "Running",
      start_time: new Date(),
      goal: config.goal,
      workflow_file: config.workflowFile,
      total_nodes: config.totalNodes,
      completed_nodes: 0,
      checkpoint_directory: config.checkpointDir,
      agent_model: config.agentModel,
    });

    this.runId = run.id;
    return run.id;
  }

  async logEvent(event: PipelineEventData): Promise<void> {
    // Create Pipeline Event object linked to run
    await anytype.createObject({
      type: "pipeline_event",
      pipeline_run: this.runId,
      timestamp: new Date(),
      event_type: event.type,
      node_id: event.nodeId,
      node_label: event.nodeLabel,
      status: event.status,
      details: event.details,
      tokens_used: event.tokensUsed,
      duration: event.duration,
    });

    // Update Pipeline Run current state
    await anytype.updateObject(this.runId, {
      current_node: event.nodeLabel,
      completed_nodes: event.completedCount,
    });
  }

  async completePipeline(status: "Completed" | "Failed" | "Aborted", reason?: string): Promise<void> {
    await anytype.updateObject(this.runId, {
      status,
      end_time: new Date(),
      exit_status: reason || status,
    });
  }
}
```

### Component 2: Telegram Notifier

**File:** `attractor-monitoring/telegram-notifier.ts`

```typescript
type NotificationLevel = "minimal" | "moderate" | "verbose";

class TelegramNotifier {
  private level: NotificationLevel = "moderate";
  private lastProgressUpdate: Date | null = null;

  shouldNotify(event: PipelineEventData): boolean {
    // Always notify
    if (["error", "loop_detected", "pipeline_completed", "pipeline_failed"].includes(event.type)) {
      return true;
    }

    // Level-based rules
    if (this.level === "minimal") {
      return event.type === "pipeline_started";
    }

    if (this.level === "moderate") {
      return ["pipeline_started", "stage_completed", "edge_selected"].includes(event.type);
    }

    // Verbose = everything
    return true;
  }

  formatMessage(event: PipelineEventData): string {
    switch (event.type) {
      case "pipeline_started":
        return `🚀 Attractor Pipeline Started\n   ${event.pipelineName}\n   ${event.totalNodes} nodes • ${event.agentModel}`;

      case "stage_started":
        return `▶️  Stage: ${event.nodeLabel}\n   Node ${event.stageNum}/${event.totalNodes} • Running...`;

      case "stage_completed":
        const icon = event.status === "success" ? "✅" : "❌";
        const tokens = event.tokensUsed ? `\n   ${event.tokensUsed.toLocaleString()} tokens` : "";
        return `${icon} Stage: ${event.nodeLabel}\n   Node ${event.stageNum}/${event.totalNodes} • ${event.status} (${event.duration})${tokens}`;

      case "loop_detected":
        return `🔄 Loop Detected\n   ${event.nodeLabel} executed ${event.loopCount} times\n   Possible infinite loop!`;

      case "pipeline_completed":
        return `✨ Pipeline Completed\n   ${event.pipelineName}\n   ${event.completedNodes}/${event.totalNodes} nodes • ${event.duration}\n   ${event.totalTokens.toLocaleString()} tokens`;

      // ... more cases
    }
  }

  async notify(event: PipelineEventData): Promise<void> {
    if (!this.shouldNotify(event)) return;

    const message = this.formatMessage(event);
    await sendTelegramMessage(message);
  }
}
```

### Component 3: Attractor Integration

**File:** `attractor-monitoring/monitored-runner.ts`

Wrap the existing Attractor PipelineRunner:

```typescript
class MonitoredPipelineRunner {
  private runner: PipelineRunner;
  private anytypeLogger: AnytypeLogger;
  private telegramNotifier: TelegramNotifier;
  private loopDetector: LoopDetector;

  async run(graph: Graph): Promise<PipelineResult> {
    // Start monitoring
    const runId = await this.anytypeLogger.startPipeline({
      name: graph.attributes.get("goal") || "Unnamed Pipeline",
      goal: graph.attributes.get("goal") || "",
      workflowFile: this.workflowPath,
      totalNodes: graph.nodes.size,
      checkpointDir: this.logsRoot,
      agentModel: "claude-sonnet-4",
    });

    await this.telegramNotifier.notify({
      type: "pipeline_started",
      pipelineName: graph.attributes.get("goal"),
      totalNodes: graph.nodes.size,
      agentModel: "claude-sonnet-4",
    });

    // Set up event listeners
    for await (const event of this.emitter.events()) {
      // Log to Anytype
      await this.anytypeLogger.logEvent(this.convertEvent(event));

      // Notify via Telegram
      await this.telegramNotifier.notify(this.convertEvent(event));

      // Check for loops
      if (this.loopDetector.detectLoop(event)) {
        await this.telegramNotifier.notify({
          type: "loop_detected",
          nodeLabel: event.data.nodeId,
          loopCount: this.loopDetector.getLoopCount(),
        });
      }

      if (event.kind === PipelineEventKind.PIPELINE_COMPLETED) {
        break;
      }
    }

    // Run the pipeline
    const result = await this.runner.run(graph);

    // Log completion
    await this.anytypeLogger.completePipeline(
      result.outcome.status === "success" ? "Completed" : "Failed",
      result.outcome.failureReason
    );

    await this.telegramNotifier.notify({
      type: result.outcome.status === "success" ? "pipeline_completed" : "pipeline_failed",
      pipelineName: graph.attributes.get("goal"),
      completedNodes: result.completedNodes.length,
      totalNodes: graph.nodes.size,
      duration: this.calculateDuration(),
    });

    return result;
  }
}
```

### Component 4: Loop Detector

**File:** `attractor-monitoring/loop-detector.ts`

```typescript
class LoopDetector {
  private nodeExecutionCount: Map<string, number> = new Map();
  private lastNodes: string[] = [];
  private readonly MAX_SAME_NODE = 10;
  private readonly PATTERN_LENGTH = 5;

  detectLoop(event: PipelineEvent): boolean {
    if (event.kind !== PipelineEventKind.STAGE_STARTED) return false;

    const nodeId = event.data.nodeId;

    // Count executions of same node
    const count = (this.nodeExecutionCount.get(nodeId) || 0) + 1;
    this.nodeExecutionCount.set(nodeId, count);

    // Track sequence
    this.lastNodes.push(nodeId);
    if (this.lastNodes.length > this.PATTERN_LENGTH * 2) {
      this.lastNodes.shift();
    }

    // Detect: Same node too many times
    if (count > this.MAX_SAME_NODE) {
      return true;
    }

    // Detect: Repeating pattern (e.g., A->B->C->A->B->C->A->B->C)
    if (this.hasRepeatingPattern()) {
      return true;
    }

    return false;
  }

  private hasRepeatingPattern(): boolean {
    // Check if last N nodes repeat
    if (this.lastNodes.length < this.PATTERN_LENGTH * 2) return false;

    const pattern = this.lastNodes.slice(0, this.PATTERN_LENGTH);
    const recent = this.lastNodes.slice(-this.PATTERN_LENGTH);

    return JSON.stringify(pattern) === JSON.stringify(recent);
  }

  getLoopCount(): number {
    return Math.max(...Array.from(this.nodeExecutionCount.values()));
  }
}
```

---

## Usage Example

**Modified run-rsi-workflow.ts:**

```typescript
import { MonitoredPipelineRunner } from "./attractor-monitoring/monitored-runner.js";

const runner = new MonitoredPipelineRunner({
  handlerRegistry: registry,
  backend,
  interviewer: new AutoApproveInterviewer(),
  logsRoot: "/tmp/attractor-rsi-logs",

  // Monitoring config
  anytypeSpaceId: "bafyreiegui6jhkgh2zc2z5ant6nwb6aab7y6gxrx33dt5omhczqzred5kq",
  notificationLevel: "moderate", // or "minimal" / "verbose"
  workflowPath: "/tmp/implement-rsi-indicator.dot",
});

const result = await runner.run(graph);
```

---

## File Structure

```
attractor-monitoring/
├── README.md                 # This design document
├── anytype-logger.ts         # Anytype integration
├── telegram-notifier.ts      # Telegram notifications
├── monitored-runner.ts       # Wrapper for PipelineRunner
├── loop-detector.ts          # Infinite loop detection
├── types.ts                  # TypeScript type definitions
└── tests/
    ├── anytype-logger.test.ts
    ├── telegram-notifier.test.ts
    └── loop-detector.test.ts
```

---

## Anytype Setup

### Creating Custom Types

1. **Create "Pipeline Run" type:**
   - Go to Anytype
   - Create new Type
   - Add properties as listed above
   - Set icon to 🔄

2. **Create "Pipeline Event" type:**
   - Create new Type
   - Add properties as listed above
   - Set icon to 📝

3. **Create "Attractor Pipelines" Set:**
   - Filter: Type = Pipeline Run
   - View: Table with Status, Start Time, Completed Nodes columns
   - Sort: Start Time descending

---

## Configuration

**Environment Variables:**
- `ANYTYPE_SPACE_ID` - Default space for pipeline logs
- `ATTRACTOR_NOTIFICATION_LEVEL` - minimal | moderate | verbose
- `ATTRACTOR_TELEGRAM_ENABLED` - true | false

**Config File (optional):**
```json
{
  "monitoring": {
    "anytype": {
      "enabled": true,
      "spaceId": "bafyreiegui6..."
    },
    "telegram": {
      "enabled": true,
      "level": "moderate"
    },
    "loopDetection": {
      "maxSameNode": 10,
      "patternLength": 5
    }
  }
}
```

---

## Open Questions

1. **Anytype Space Structure:**
   - Should Pipeline Runs go in a dedicated "Attractor Pipelines" collection?
   - Or just add to main space with tag/filter?

2. **Notification Verbosity:**
   - What's the right default level? (Minimal/Moderate/Verbose)
   - Should it be configurable per-pipeline or global?

3. **Event Retention:**
   - Keep all Pipeline Event objects forever?
   - Archive/delete after pipeline completion?
   - Keep only failed pipelines for debugging?

4. **Code Artifacts:**
   - Should Pipeline Run link to generated code files?
   - Save diffs of what was changed?
   - Track which files were created/modified?

5. **Integration Point:**
   - Should this be built into the Attractor skill itself?
   - Or remain a separate monitoring layer?
   - Make it opt-in or always-on?

6. **Performance:**
   - Will Anytype API calls slow down pipeline execution?
   - Should events be batched/queued?
   - Async logging vs synchronous?

---

## Next Steps

1. Get design review and feedback (Opus 4.6)
2. Create Anytype custom types
3. Implement core monitoring components
4. Test with simple workflow
5. Test with RSI implementation workflow
6. Document usage patterns
7. Add to Attractor skill documentation

---

## Success Criteria

**For User (Dakota):**
- ✅ Can see real-time pipeline progress in Telegram
- ✅ Can review full execution history in Anytype
- ✅ Gets alerted immediately when pipelines fail or loop
- ✅ Can understand why agent made decisions (edge routing)
- ✅ Has visibility into token usage and costs

**For Agent (Andy):**
- ✅ Monitoring doesn't significantly slow down execution
- ✅ Can detect and break out of infinite loops
- ✅ Logs are detailed enough for debugging
- ✅ Easy to integrate with existing Attractor workflows

---

*Design Document Version: 1.0*
*Author: Andy (Claude Sonnet 4.5)*
*Date: 2026-02-28*
*Status: Awaiting Review (Opus 4.6)*
