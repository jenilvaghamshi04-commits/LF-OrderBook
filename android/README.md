# LF OrderBook Android

Native Android WebView wrapper for the LF/USDT orderbook monitor.

## Install

Install the generated `LF-OrderBook-debug.apk` on Android 7.0 or newer. Android may ask you to allow installation from your browser or file manager.

## Notes

- The app requires an internet connection and loads the live Render monitor.
- Enable **Sound on** inside the monitor before expecting audible alarms.
- Version 2 includes a native foreground service that checks depth every 15 seconds after the app is swiped away.
- Keep the permanent **LF OrderBook monitoring active** notification enabled. Android requires it for background monitoring.
- Allow notification permission when first opening the app. Force-stopping the app disables monitoring until it is opened again.
- This debug APK is intended for direct testing. A signed Android App Bundle is required for Google Play publication.
