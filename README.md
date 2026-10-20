# Load Sheet

Track loads, tickets and hours from the truck. Installs to the home screen on iPad and Android and works with no signal.

- **One tap per load** (+1 Load), fixed amounts or a ticket per load, one ticket across several loads
- **Hourly jobs** with a start/stop clock
- **End-of-day report** to text or email the office, **CSV export** for Excel, **backup/restore**

All data stays on the device (browser storage). Nothing is uploaded.

## Install
- **Android (Chrome):** open the link → ⋮ menu → **Install app** (or *Add to Home screen*)
- **iPad / iPhone (Safari):** open the link → Share → **Add to Home Screen**

## Releasing an update
Edit `index.html`, bump `VERSION` in `sw.js` (and the matching version in `index.html`), commit and push. Installed copies pick up the new version the next time they're opened with signal, then on the following launch.
