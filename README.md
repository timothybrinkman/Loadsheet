# Load Sheet

Track loads, tickets and hours from the truck. Installs to the home screen on iPad and Android and works with no signal.

- **One tap per load** (+1 Load), fixed amounts or a ticket per load, one ticket across several loads
- **Hourly jobs** with a start/stop clock
- **Trucks:** pick the truck you're in; every load and clock entry is stamped with it
- **Auto-count:** pin a job's drop-off or pickup; Auto mode counts a load each time you pull in (app open on screen), or use the job's auto-add link with a background geofence app like MacroDroid (`?add=<job>`, hourly: `?start=` / `?stop=`)
- **Driver log (Log tab):** one tap for Off duty / On duty / Driving / Sleeper, stamped with the time, truck, trailer and GPS location (named after the nearest town, offline). Live clocks for 11-hour driving, the 14-hour window, 30-minute break and the 70/8 (or 60/7) cycle. Paper-log style 24-hour grid, short-haul time record or full log per day, odometer miles per truck, flags for loads hauled while off duty and for days that break the short-haul limits (14 hours / 150 air miles), sign each day, print or save as PDF, CSV export. Not a registered ELD: it replaces a paper log or the short-haul time record
- **Pre-trip / post-trip inspections:** tap only what's wrong; defects go to the office page's shop list, the office marks them repaired, and the driver sees the repair on the next pre-trip
- **End-of-day report** to text or email the office, **CSV export** for Excel, **backup/restore**

Data lives on the device. With **crew sync** turned on (Firebase, Google sign-in), each driver's loads also sync to a shared database: they save offline and upload when the truck gets signal, and the **office page** (`office.html`) shows every driver and truck live.

## Crew sync setup
1. Create a Firebase project; enable Google sign-in; add this site's domain under Authentication → Authorized domains; create a Firestore database.
2. Put the web app config in `config.js`.
3. Paste `firestore.rules` (again after any update that adds a kind of record, e.g. the driver log) into Firestore → Rules, with `OWNER_EMAIL` replaced by the owner's Google email.
4. The owner signs in first (becomes admin), then adds drivers on the office page's crew list.

## Install
- **Android (Chrome):** open the link → ⋮ menu → **Install app** (or *Add to Home screen*)
- **iPad / iPhone (Safari):** open the link → Share → **Add to Home Screen**

## Releasing an update
Edit `index.html`, bump `VERSION` in `sw.js` (and the matching version in `index.html`), commit and push. Installed copies pick up the new version the next time they're opened with signal, then on the following launch.
