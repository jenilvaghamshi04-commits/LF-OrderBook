# V15 — DEX Price and Telegram Orderbook

## New display

- Shows the LF DEX price from DexScreener, with CoinGecko fallback.
- Clearly labels **DEX price** and **Orderbook mid price**.
- Shows the percentage difference between the two prices.
- Keeps Gate.io bid, ask, spread, depth, history, and verified-median alerts.

## Telegram commands

- `/price` — DEX price, orderbook mid price, and difference.
- `/orderbook` — top 20 buy and sell levels.
- `/orderbook 50` — top 50 buy and sell levels.
- `/orderbook all` — every order level returned by Gate.io.
- `/buybook`, `/buybook 50`, `/buybook all` — buy side only.
- `/sellbook`, `/sellbook 50`, `/sellbook all` — sell side only.

Large results are automatically divided into safe Telegram messages. Each row contains price, LF amount, and USDT value.

## Deployment

Upload the extracted project files to the repository root. Render uses `node server.js` through the included `render.yaml`.
