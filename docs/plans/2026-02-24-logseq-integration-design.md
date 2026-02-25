# Logseq Integration Skill — Design

## Summary

NanoClaw skill that gives agents read-write access to a Logseq graph via direct file system mount. No external dependencies — agents use shell tools already in the container.

## Decisions

- **Access method:** Direct file mount (not HTTP API or MCP). Works offline, zero deps.
- **Access level:** Read-write for all groups.
- **Config:** Single env var `LOGSEQ_GRAPH_PATH` in `.env`. No-op when empty.
- **Mount point:** `/workspace/logseq` inside every container.

## Skill Structure

```
.claude/skills/add-logseq/
├── manifest.yaml
├── SKILL.md                              # User-facing install guide
├── add/
│   └── container/skills/logseq/SKILL.md  # Agent-facing docs
└── modify/
    ├── src/config.ts                     # + LOGSEQ_GRAPH_PATH export
    ├── src/config.ts.intent.md
    ├── src/container-runner.ts            # + volume mount in buildVolumeMounts()
    └── src/container-runner.ts.intent.md
```

## Modifications

### src/config.ts

- Add `'LOGSEQ_GRAPH_PATH'` to `readEnvFile()` array
- Export: `export const LOGSEQ_GRAPH_PATH = process.env.LOGSEQ_GRAPH_PATH || envConfig.LOGSEQ_GRAPH_PATH || '';`

### src/container-runner.ts

- Import `LOGSEQ_GRAPH_PATH` from config
- In `buildVolumeMounts()`, after the existing mounts and before `additionalMounts` validation, add:

```typescript
if (LOGSEQ_GRAPH_PATH) {
  mounts.push({
    hostPath: LOGSEQ_GRAPH_PATH,
    containerPath: '/workspace/logseq',
    readonly: false,
  });
}
```

### Container skill doc

Teaches agents:
- Logseq folder layout: `pages/`, `journals/`, `logseq/`
- Reading: `cat`, `grep -r`, `find`
- Writing: bullet format (`- `), properties (`key:: value`), wikilinks (`[[Page]]`)
- Journal naming: `YYYY_MM_DD.md`
- Rules: don't touch `logseq/` config dir, don't delete content without being asked

## Data Flow

```
.env: LOGSEQ_GRAPH_PATH=~/Documents/MyGraph
  → config.ts reads and exports
  → container-runner.ts mounts at /workspace/logseq
  → Agent reads/writes .md files with shell tools
  → Logseq desktop app picks up changes on next sync
```

## Non-goals

- No Logseq HTTP API integration
- No MCP server
- No per-group access control (use mount allowlist manually if needed)
- No startup validation of path
