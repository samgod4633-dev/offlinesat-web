# OfflineSat (web)

A satellite map with live GPS that keeps working with no signal. It installs to the iPhone Home Screen and needs no App Store, Apple ID, or sideloading.

**Open:** https://samgod4633-dev.github.io/offlinesat-web/

## Install on iPhone
1. Open the link in **Safari**, then tap **Share › Add to Home Screen**.
2. Open **OfflineSat from the Home Screen** and allow location.
3. Do your downloads **inside the Home Screen app**. Its storage is separate from Safari's.

## Use
- **Follow Me** (arrow button) keeps the map on you. Dragging the map turns it off. **Center** (crosshair) recentres once.
- **Status card:** latitude/longitude, altitude, and GPS accuracy (green under 10 m, yellow under 30 m, red otherwise). Tap the card to copy your coordinates.
- **Offline maps** (download button):
  - Download the area on screen for a chosen zoom range.
  - Import raster `.mbtiles` files.
  - Clear saved tiles.
  - Change the tile source.
- With **Save tiles while browsing** on (the default), every tile you view online is also kept for offline use.
- When you zoom in past what you've saved, the app enlarges the nearest saved tile instead of showing blank map.

## Notes
- GPS only updates while the app is open on screen. That's an iOS rule for web apps.
- The default imagery is Esri World Imagery. Check its terms before saving large areas.
- Everything runs on the device. There is no server-side code or tracking.
