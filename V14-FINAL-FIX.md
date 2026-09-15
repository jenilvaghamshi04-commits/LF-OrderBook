# V14 final depth-alarm fix

- Website depth uses the median of the latest 21 snapshots (about one minute).
- Telegram monitoring uses the median of the latest five server checks.
- Android background monitoring uses the median of the latest five checks.
- Verified depth must then remain below the configured target for 60 seconds before alerting.
- Large-buy events remain visible but no longer play the depth alarm sound.
- Only verified buy, sell, or total depth shortages can ring.
- Gate.io requests continue to load up to 1,000 orderbook levels.
- The PWA cache is upgraded to v14 so old JavaScript is replaced.

Extract this ZIP and upload all extracted files to the GitHub repository root.
