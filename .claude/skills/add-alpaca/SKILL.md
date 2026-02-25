---
name: add-alpaca
description: Add Alpaca trading API integration. Agents can check account, positions, place orders, and get market data. Reads ALPACA_API_KEY, ALPACA_SECRET_KEY, and ALPACA_PAPER from .env.
---

# Add Alpaca Trading API

Gives all agents the ability to interact with Alpaca's trading API via curl.
Supports stocks, crypto, and options. No npm dependencies.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `alpaca` is in `applied_skills`, skip to Phase 3.

### Verify build

```bash
npm run build
```

Fix any errors before continuing.

## Phase 2: Apply Code Changes

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-alpaca
```

This deterministically:
- Three-way merges `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`, `ALPACA_PAPER` config into `src/config.ts`
- Three-way merges env var passthrough into `src/container-runner.ts`
- Adds `container/skills/alpaca-trading/SKILL.md` (agent-facing docs)
- Appends env vars to `.env.example`

If the apply reports merge conflicts, read the intent files:
- `modify/src/config.ts.intent.md` — Alpaca config exports
- `modify/src/container-runner.ts.intent.md` — container env var passthrough

### Validate

```bash
npm run build
```

Build must be clean before proceeding.

## Phase 3: Configure

Add Alpaca credentials to `.env`:

```bash
ALPACA_API_KEY=your-api-key
ALPACA_SECRET_KEY=your-secret-key
ALPACA_PAPER=true
```

Set `ALPACA_PAPER=false` for live trading (use with caution).

Then rebuild and restart:

```bash
npm run build
systemctl --user restart nanoclaw    # Linux
# or: launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
```

Optionally add trading guidance to `groups/global/CLAUDE.md` so agents
know trading policies and risk limits.

## Phase 4: Done

Tell the user:

> Alpaca trading API enabled. All agents can now check positions, place orders,
> and get market data using curl.
>
> Paper trading is ${ALPACA_PAPER === 'true' ? 'enabled' : 'disabled'}.
>
> Test it: ask Andy to "check my Alpaca account balance".
