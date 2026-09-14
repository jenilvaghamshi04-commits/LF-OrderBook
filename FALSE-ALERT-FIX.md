# False-alert fix

This release prevents temporary or incomplete orderbook snapshots from triggering false alarms.

- Gate.io depth requests now load up to 1,000 levels instead of 100.
- Buy, sell, and total depth must remain below their targets for three consecutive checks before an alert.
- A sudden depth drop is held until it is confirmed across three snapshots.
- Large-buy alerts identify orders by price and require three confirmations, so quantity updates do not repeatedly ring.
- The web cache version was increased so installed PWAs receive the corrected JavaScript.
- Android background notifications also require three consecutive low-depth checks.

Extract this ZIP and upload its contents to the root of the GitHub repository. Do not upload the ZIP as a single repository file.
