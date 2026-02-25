# Intent: src/config.ts modifications

## What changed
Added Alpaca trading API configuration: API key, secret key, and paper trading flag.

## Key sections

### readEnvFile call
- Added keys: `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`, `ALPACA_PAPER`

### New exports (appended at end of file)
- `ALPACA_API_KEY` — string, defaults to empty string (disabled when empty)
- `ALPACA_SECRET_KEY` — string, defaults to empty string
- `ALPACA_PAPER` — string, defaults to `'true'` (paper trading by default for safety)

## Invariants
- All existing config exports remain unchanged
- New keys are added to the `readEnvFile` call alongside existing keys
- Both `process.env` and `envConfig` are checked (same pattern as other config vars)
- ALPACA_PAPER defaults to `'true'` — live trading requires explicit opt-in

## Must-keep
- All existing exports
- The `readEnvFile` pattern — ALL config read from `.env` must go through this function
