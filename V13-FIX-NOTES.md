# V13 depth stability fix

Depth and price are different: the market price can stay unchanged while traders cancel or replace orders. This version prevents those short changes from creating false alarms.

- Sudden drops greater than 35% are held for 60 seconds before they are shown.
- Buy, sell, and total depth must stay below their thresholds continuously for 60 seconds before sound or Telegram alerts.
- Any recovery during that minute cancels the pending alert timer.
- Android background notifications use the same 60-second confirmation rule.
- The app continues to request up to 1,000 Gate.io orderbook levels.
- Web/PWA cache was advanced to v13.

Extract the ZIP and upload all extracted contents to the GitHub repository root.
