# Load Sheet

Track loads, tickets and hours from the truck. Installs to the home screen on iPad and Android and works with no signal.

- **One tap per load** (+1 Load), fixed amounts or a ticket per load, one ticket across several loads
- **Hourly jobs** with a start/stop clock
- **Trucks:** pick the truck you're in; every load and clock entry is stamped with it
- **Auto-count:** pin a job's drop-off or pickup; Auto mode counts a load each time you pull in (app open on screen), or use the job's auto-add link with a background geofence app like MacroDroid (`?add=<job>`, hourly: `?start=` / `?stop=`)
- **End-of-day report** to text or email the office, **CSV export** for Excel, **backup/restore**

Data lives on the device. With **crew sync** turned on (Firebase, Google sign-in), each driver's loads also sync to a shared database: they save offline and upload when the truck gets signal, and the **office page** (`office.html`) shows every driver and truck live.

## Crew sync setup
1. Create a Firebase project; enable Google sign-in; add this site's domain under Authentication → Authorized domains; create a Firestore database.
2. Put the web app config in `config.js`.
3. Paste `firestore.rules` into Firestore → Rules, with `OWNER_EMAIL` replaced by the owner's Google email.
4. The owner signs in first (becomes admin), then adds drivers on the office page's crew list.

## Install
- **Android (Chrome):** open the link → ⋮ menu → **Install app** (or *Add to Home screen*)
- **iPad / iPhone (Safari):** open the link → Share → **Add to Home Screen**

## Releasing an update
Edit `index.html`, bump `VERSION` in `sw.js` (and the matching version in `index.html`), commit and push. Installed copies pick up the new version the next time they're opened with signal, then on the following launch.
