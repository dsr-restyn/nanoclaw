// =============================================================================
// Modification instructions for src/index.ts
// Wires the Attractor pipeline runner into the main process via IPC
// =============================================================================
//
// STEP 1: Add import at the top, after the existing imports (around line 53)
// -------------------------------------------------------------------------
//
// import { startPipelineRun, type PipelineRunDeps } from './pipeline/runner.js';
// import type { Verbosity } from './pipeline/events.js';
// import type { Node } from './pipeline/types.js';
//
//
// STEP 2: Add helper function after the runAgent function (after line 351)
// -------------------------------------------------------------------------
// This bridges the pipeline's runContainerPrompt interface to the existing
// runContainerAgent. Each pipeline node runs as a separate container invocation
// that collects the streamed text result into a single string.
//
// async function runContainerPrompt(
//   prompt: string,
//   _node: Node,
//   groupFolder: string,
//   chatJid: string,
// ): Promise<string> {
//   const groups = registeredGroups;
//   const group = Object.values(groups).find((g) => g.folder === groupFolder);
//   if (!group) throw new Error(`Group not found for folder: ${groupFolder}`);
//
//   const isMain = groupFolder === MAIN_GROUP_FOLDER;
//   const sessionId = sessions[groupFolder];
//
//   let resultText = '';
//   const output = await runContainerAgent(
//     group,
//     {
//       prompt,
//       sessionId,
//       groupFolder,
//       chatJid,
//       isMain,
//       assistantName: ASSISTANT_NAME,
//     },
//     (proc, containerName) =>
//       queue.registerProcess(chatJid, proc, containerName, groupFolder),
//     async (streamed) => {
//       if (streamed.newSessionId) {
//         sessions[groupFolder] = streamed.newSessionId;
//         setSession(groupFolder, streamed.newSessionId);
//       }
//       if (streamed.result) {
//         resultText += typeof streamed.result === 'string'
//           ? streamed.result
//           : JSON.stringify(streamed.result);
//       }
//       if (streamed.status === 'success') {
//         queue.notifyIdle(chatJid);
//       }
//     },
//   );
//
//   if (output.newSessionId) {
//     sessions[groupFolder] = output.newSessionId;
//     setSession(groupFolder, output.newSessionId);
//   }
//
//   if (output.status === 'error') {
//     throw new Error(output.error || 'Container agent error');
//   }
//
//   return resultText;
// }
//
//
// STEP 3: Add startPipeline function after the runContainerPrompt helper
// -----------------------------------------------------------------------
// This function is passed to the IPC watcher. It creates PipelineRunDeps
// and enqueues the pipeline run through GroupQueue to respect concurrency.
//
// function startPipeline(
//   dot: string,
//   groupFolder: string,
//   chatJid: string,
//   verbosity: string,
// ): void {
//   const pipelineId = `pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
//
//   const channel = findChannel(channels, chatJid);
//   if (!channel) {
//     logger.warn({ chatJid, groupFolder }, 'No channel for pipeline, cannot start');
//     return;
//   }
//
//   const deps: PipelineRunDeps = {
//     sendMessage: (jid, text) => channel.sendMessage(jid, text),
//     runContainerPrompt,
//     chatJid,
//     groupFolder,
//     verbosity: verbosity as Verbosity,
//   };
//
//   // Enqueue through GroupQueue so pipeline nodes respect concurrency limits.
//   // Each pipeline run is a single queued task; individual nodes within the
//   // pipeline run sequentially inside that task's container slot.
//   queue.enqueueTask(chatJid, pipelineId, async () => {
//     try {
//       const result = await startPipelineRun(dot, deps);
//       logger.info(
//         { pipelineId, groupFolder, status: result.status, completed: result.completedNodes.length },
//         'Pipeline run completed',
//       );
//     } catch (err) {
//       logger.error({ pipelineId, groupFolder, err }, 'Pipeline run failed');
//       await channel.sendMessage(chatJid, `[Pipeline] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
//     }
//   });
//
//   logger.info({ pipelineId, groupFolder, chatJid }, 'Pipeline enqueued');
// }
//
//
// STEP 4: Pass startPipeline to startIpcWatcher deps (around line 567-583)
// --------------------------------------------------------------------------
// In the main() function, add `startPipeline` to the deps object passed
// to startIpcWatcher. The existing call looks like:
//
//   startIpcWatcher({
//     sendMessage: ...,
//     registeredGroups: ...,
//     registerGroup,
//     unregisterGroup,
//     syncGroupMetadata: ...,
//     getAvailableGroups,
//     writeGroupsSnapshot: ...,
//   });
//
// Change it to:
//
//   startIpcWatcher({
//     sendMessage: ...,
//     registeredGroups: ...,
//     registerGroup,
//     unregisterGroup,
//     syncGroupMetadata: ...,
//     getAvailableGroups,
//     writeGroupsSnapshot: ...,
//     startPipeline,
//   });
//
// (Just add `startPipeline,` as the last property in the object literal.)
