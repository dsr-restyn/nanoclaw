# Intent: src/container-runner.ts modifications

## What changed
Added conditional mount of autoIntel context repo into agent containers.

## Key sections

### Imports (top of file)
- Added: `AUTOINTEL_PATH` to the imports from `./config.js`

### buildVolumeMounts()
- Added: autoIntel mount block before `return mounts`, after additionalMounts validation:
  ```typescript
  if (AUTOINTEL_PATH && fs.existsSync(AUTOINTEL_PATH)) {
    mounts.push({
      hostPath: AUTOINTEL_PATH,
      containerPath: '/workspace/extra/autoIntel',
      readonly: true,
    });
  }
  ```

## Invariants
- All existing mounts unchanged
- Mount is always read-only
- Mount only added when AUTOINTEL_PATH is set AND directory exists
- containerPath is always `/workspace/extra/autoIntel`
- `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` (already enabled in settings.json) auto-discovers the mounted CLAUDE.md
