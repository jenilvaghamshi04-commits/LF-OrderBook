# LF Orderbook — Render version

The monitor compares the Gate.io orderbook mid price with the LF DEX price and supports full orderbook viewing through Telegram. See `V15-DEX-TELEGRAM-ORDERBOOK.md` for the new commands.

Lightweight LF/USDT depth monitor built for Render's free Web Service tier. It has no npm dependencies and no build step.

## Render settings

- Service type: **Web Service**
- Runtime: **Node**
- Build command: `npm install`
- Start command: `npm start`

The server automatically uses Render's `PORT` environment variable.

## Telegram alerts

In Render, open **Environment** and add:

- `TELEGRAM_BOT_TOKEN` — token received from Telegram's BotFather
- `TELEGRAM_CHAT_ID` — your private numeric Telegram chat ID
- `TELEGRAM_BUY_THRESHOLD` — server-side buy alert amount, for example `400`
- `TELEGRAM_SELL_THRESHOLD` — server-side sell alert amount, for example `400`
- `TELEGRAM_TOTAL_THRESHOLD` — server-side total alert amount, for example `800`

Redeploy the service, open the monitor settings, enable **Telegram alerts**, and press **Send test**.

The Render server checks depth every 15 seconds and repeats a low-depth Telegram alert after one minute. On Render's free plan, the service may sleep during inactivity; an always-on paid instance is required for guaranteed alerts while the site is closed.

Telegram commands are restricted to `TELEGRAM_CHAT_ID`:

- `/status` — monitor health and target status
- `/depth` — live buy, sell, total, and mid-price values
- `/setbuy 400` — change the buy-side minimum
- `/setsell 300` — change the sell-side minimum
- `/settotal 700` — change the combined minimum
- `/setdepth 400 300 700` — change buy, sell, and total together
- `/setdepth buy 400` — change one target using the combined command
- `/mute` — toggle alerts (`/mute on` and `/mute off` are also supported)
- `/settings` — show server-side alert thresholds

The bot uses a Telegram webhook so commands can wake a sleeping Render service. Thresholds and the mute state are stored with the bot and restored after a restart. `/mute on` remains muted until `/mute off` is sent.

## Shared settings

The website and Telegram use one server-side setting. Changing buy, sell, or total depth in the website updates `/settings` in Telegram. Telegram `/setbuy`, `/setsell`, `/settotal`, and `/setdepth` changes are automatically reflected on the website within five seconds. The initial shared targets are buy `500`, sell `300`, and total `1000` USDT.

## Added features

- Installable PWA for Android, iPhone, and desktop
- Local buy/sell depth history chart with 5, 15, 30, and 60-minute views
- Server-side Telegram low-depth alerts without exposing the bot token
- Five selectable alarm tones with an in-settings preview button
