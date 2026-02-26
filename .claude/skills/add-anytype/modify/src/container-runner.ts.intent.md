# Intent: src/container-runner.ts modifications

## What changed
Added Docker host networking bridge and Anytype API key passthrough so containers can reach the Anytype headless server.

## Key sections

### Import block
- Added `ANYTYPE_API_KEY` to the config import (alphabetical, first in list)

### buildContainerArgs function — `--add-host` flag
- Added `--add-host=host.docker.internal:host-gateway` immediately after the `run -i --rm --name` args
- This lets containers resolve `host.docker.internal` to the Docker host IP
- Required for any integration that talks to a host-local service (Anytype at 172.17.0.1:31012)
- Safe: only adds a /etc/hosts entry, does NOT change network isolation

### buildContainerArgs function — env var passthrough
- Added conditional block that passes `ANYTYPE_API_KEY` as container env var
- Only passed when the key is non-empty (skill not configured = no env var)
- Placed after the runtime-updates env passthrough block, before the user/GID block

## Invariants
- All existing container args remain unchanged
- `--add-host` is a no-op for containers that don't use it
- ANYTYPE_API_KEY is NOT a secret in the stdin sense — it's scoped to a bot account with limited space access
- The env var is only added when ANYTYPE_API_KEY is configured (non-empty)

## Must-keep
- All existing `-e` env var passes (TZ, runtime passthrough, HOME)
- The secrets mechanism (readSecrets/stdin) — Anytype key does NOT go through this
- The full buildContainerArgs function structure
- The `--add-host` flag must be before volume mounts (Docker arg ordering)
