---
name: alpaca-trading
description: Trade stocks, crypto, and options via Alpaca's REST API. Use for checking positions, placing orders, getting market data, and managing the portfolio.
---

# Alpaca Trading API

Trade stocks, crypto, and options using environment variables `$ALPACA_API_KEY`, `$ALPACA_SECRET_KEY`, and `$ALPACA_PAPER`.

## Base URL

```bash
# Determine base URL from paper mode flag
if [ "$ALPACA_PAPER" = "true" ]; then
  ALPACA_BASE="https://paper-api.alpaca.markets"
  ALPACA_DATA="https://data.alpaca.markets"
else
  ALPACA_BASE="https://api.alpaca.markets"
  ALPACA_DATA="https://data.alpaca.markets"
fi
```

All requests need these headers:

```bash
-H "APCA-API-KEY-ID: $ALPACA_API_KEY" \
-H "APCA-API-SECRET-KEY: $ALPACA_SECRET_KEY"
```

## Account

```bash
# Get account info (buying power, equity, cash)
curl -s "$ALPACA_BASE/v2/account" \
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: $ALPACA_SECRET_KEY" | jq .
```

## Positions

```bash
# List all open positions
curl -s "$ALPACA_BASE/v2/positions" \
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: $ALPACA_SECRET_KEY" | jq .

# Get position for a specific symbol
curl -s "$ALPACA_BASE/v2/positions/AAPL" \
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: $ALPACA_SECRET_KEY" | jq .
```

## Orders

```bash
# Place a market buy order
curl -s -X POST "$ALPACA_BASE/v2/orders" \
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: $ALPACA_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"AAPL","qty":"1","side":"buy","type":"market","time_in_force":"day"}' | jq .

# Place a limit buy order
curl -s -X POST "$ALPACA_BASE/v2/orders" \
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: $ALPACA_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"AAPL","qty":"1","side":"buy","type":"limit","limit_price":"150.00","time_in_force":"gtc"}' | jq .

# Place a market sell order
curl -s -X POST "$ALPACA_BASE/v2/orders" \
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: $ALPACA_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"AAPL","qty":"1","side":"sell","type":"market","time_in_force":"day"}' | jq .

# List recent orders
curl -s "$ALPACA_BASE/v2/orders?status=all&limit=10" \
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: $ALPACA_SECRET_KEY" | jq .

# Cancel an order
curl -s -X DELETE "$ALPACA_BASE/v2/orders/{order_id}" \
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: $ALPACA_SECRET_KEY"
```

## Market Data

```bash
# Latest quote for a stock
curl -s "$ALPACA_DATA/v2/stocks/AAPL/quotes/latest" \
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: $ALPACA_SECRET_KEY" | jq .

# Latest bar (OHLCV)
curl -s "$ALPACA_DATA/v2/stocks/AAPL/bars/latest" \
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: $ALPACA_SECRET_KEY" | jq .

# Historical bars (daily, last 5 days)
curl -s "$ALPACA_DATA/v2/stocks/AAPL/bars?timeframe=1Day&limit=5" \
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: $ALPACA_SECRET_KEY" | jq .

# Snapshot (quote + bar + trade in one call)
curl -s "$ALPACA_DATA/v2/stocks/AAPL/snapshot" \
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: $ALPACA_SECRET_KEY" | jq .

# Crypto latest quote
curl -s "$ALPACA_DATA/v1beta3/crypto/us/latest/quotes?symbols=BTC/USD" \
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: $ALPACA_SECRET_KEY" | jq .
```

## Market Clock

```bash
# Check if market is open
curl -s "$ALPACA_BASE/v2/clock" \
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: $ALPACA_SECRET_KEY" | jq .
```

## Portfolio History

```bash
# Portfolio value over time (1 month, daily)
curl -s "$ALPACA_BASE/v2/account/portfolio/history?period=1M&timeframe=1D" \
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: $ALPACA_SECRET_KEY" | jq .
```

## When to Use

- User asks about their portfolio, positions, or account balance
- User wants to buy or sell stocks/crypto
- User asks for stock prices or market data
- User wants to check if the market is open
- Scheduled tasks for portfolio monitoring or alerts

## When NOT to Use

- General financial advice (you're not a financial advisor)
- Analyzing complex derivatives without user confirmation
- Placing large orders without explicit user approval — always confirm first

## Important

- Always confirm order details with the user before placing trades
- Check `$ALPACA_PAPER` — if `true`, this is a paper (simulated) account
- Use `jq` to parse JSON responses for clean output
