# Intent: src/container-runner.ts modifications

## What changed
Added Logseq knowledge graph as a conditional volume mount so agents can read/write the user's Logseq graph.

## Key sections

### Import block
- Added `LOGSEQ_GRAPH_PATH` to the config import (alphabetically between `IDLE_TIMEOUT` and `NTFY_TOPIC`)

### buildVolumeMounts function
- Added conditional volume mount block before the `additionalMounts` section
- Mounts `LOGSEQ_GRAPH_PATH` to `/workspace/logseq` (read-write)
- Only added when `LOGSEQ_GRAPH_PATH` is non-empty

## Invariants
- All existing volume mounts remain unchanged
- The mount is read-write so agents can create pages and journal entries
- Mount applies to all groups (not just main)
- The Logseq mount is placed before `additionalMounts` (which is always last)

## Must-keep
- All existing mounts (project root, group folder, global, sessions, IPC, agent-runner)
- The secrets mechanism (readSecrets/stdin) — Logseq path is NOT a secret
- The full `buildVolumeMounts` and `buildContainerArgs` function structures
- The `additionalMounts` block must remain last in `buildVolumeMounts`
