# Intent: src/container-runtime.ts modifications

## What changed
Added host gateway constants and platform-aware networking for credential proxy communication.

## Key sections

### New imports (top of file)
- Added: `fs from 'fs'`
- Added: `os from 'os'`

### New exports (after CONTAINER_RUNTIME_BIN)
- `CONTAINER_HOST_GATEWAY` — `'host.docker.internal'`, hostname containers use to reach host services
- `PROXY_BIND_HOST` — address the credential proxy binds to, platform-aware:
  - macOS/WSL: `127.0.0.1` (Docker Desktop routes host.docker.internal to loopback)
  - Linux: docker0 bridge IP (so only containers can reach it), falls back to `0.0.0.0`

### New function: `detectProxyBindHost()`
- Private helper for PROXY_BIND_HOST
- Checks platform, WSL, and docker0 interface

### New function: `hostGatewayArgs()`
- Returns `['--add-host=host.docker.internal:host-gateway']` on Linux
- Returns `[]` on other platforms (Docker Desktop has it built-in)
- Used by container-runner to ensure containers can resolve host.docker.internal

## Invariants
- All existing exports unchanged (CONTAINER_RUNTIME_BIN, readonlyMountArgs, stopContainer, ensureContainerRuntimeRunning, cleanupOrphans)
- New exports are additive only
