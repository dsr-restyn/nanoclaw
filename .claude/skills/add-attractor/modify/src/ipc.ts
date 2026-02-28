// ADD THIS CASE before the `default:` case in processTaskIpc switch statement in src/ipc.ts
//
// Also add to the `data` parameter type:
//   dot?: string;
//   verbosity?: string;
//
// Also add to IpcDeps interface:
//   startPipeline?: (dot: string, groupFolder: string, chatJid: string, verbosity: string) => void;
//
// New case:
//
//     case 'start_pipeline': {
//       if (!data.dot) {
//         logger.warn({ sourceGroup }, 'start_pipeline missing dot field');
//         break;
//       }
//       // Find the chat JID for this group
//       const allGroups = deps.registeredGroups();
//       const chatJid = data.chatJid || Object.entries(allGroups).find(
//         ([, g]) => g.folder === sourceGroup,
//       )?.[0];
//       if (!chatJid) {
//         logger.warn({ sourceGroup }, 'Cannot find chat JID for start_pipeline');
//         break;
//       }
//       const verbosity = data.verbosity || 'standard';
//       if (deps.startPipeline) {
//         deps.startPipeline(data.dot, sourceGroup, chatJid, verbosity);
//       }
//       logger.info({ sourceGroup, chatJid }, 'Pipeline started via IPC');
//       break;
//     }
