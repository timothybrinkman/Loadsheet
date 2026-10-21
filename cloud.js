// Load Sheet crew sync.
// The app keeps working from its on-device copy (localStorage). This module mirrors that copy
// to the crew database and pulls changes made on the driver's other devices.
// - Local change  -> stamp updatedAt/driver, upload the records whose content changed, delete removed ones
// - Remote change -> newer updatedAt wins; deletes made on another device are applied here
// - No signal     -> Firestore queues the writes on the device and sends them when service comes back
import { firebaseConfig, ORG } from "./config.js";

const App = window.LoadSheetApp;
const SYNC_KEY = "loadsheet_synced_v1";         // {recordId: hash of what the server last had}
const META = ["updatedAt", "driverUid", "driverName", "driverEmail"];

let backend = null, user = null, member = null, unsub = null;
let ready = false, swept = false, pending = 0, checkingQueue = false, lastErr = "", state = "off";

// ---------- helpers ----------
function readMap() { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; } }
function writeMap(m) { try { localStorage.setItem(SYNC_KEY, JSON.stringify(m)); } catch (e) {} }
function clean(o) { return JSON.parse(JSON.stringify(o)); }
function stable(v) {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
function baseHash(rec) {
  const b = clean(rec);
  META.forEach(k => delete b[k]);
  return stable(b);
}
function unsyncedCount() {
  const map = readMap();
  return App.getLoads().filter(r => map[r.id] !== baseHash(r)).length;
}
function track(p) {
  pending++; render();
  p.then(() => { pending--; lastErr = ""; render(); })
   .catch(err => { pending--; lastErr = (err && err.code) || "error"; render(); });
}

// ---------- local -> cloud ----------
function onLocalChange() {
  if (!ready || !user) return;
  const map = readMap();
  const loads = App.getLoads();
  const now = new Date().toISOString();
  const ids = new Set();
  let stamped = false;
  loads.forEach(r => {
    ids.add(r.id);
    const hb = baseHash(r);
    if (map[r.id] === hb) return;
    r.updatedAt = now; r.driverUid = user.uid; r.driverName = user.name; r.driverEmail = user.email;
    map[r.id] = hb; stamped = true;
    track(backend.put(r.id, clean(r)));
  });
  Object.keys(map).forEach(id => {
    if (!ids.has(id)) { delete map[id]; track(backend.del(id)); }
  });
  writeMap(map);
  if (stamped) App.persistQuiet();
}

// ---------- cloud -> local ----------
function onRemote(snap) {
  const map = readMap();
  const byId = new Map(App.getLoads().map(l => [l.id, l]));
  let dirty = false;
  snap.changes.forEach(ch => {
    if (ch.pending) return;                                     // echo of our own write
    if (ch.type === "removed") {
      if (byId.has(ch.id) && map[ch.id] !== undefined) { byId.delete(ch.id); delete map[ch.id]; dirty = true; }
      return;
    }
    const r = ch.data, l = byId.get(ch.id);
    const hb = baseHash(r);
    // newest change wins; an edit on this device that hasn't uploaded yet beats an older or equal server copy
    const localUnsent = l && map[ch.id] !== baseHash(l);
    const rT = r.updatedAt || "", lT = (l && l.updatedAt) || "";
    if (!l || rT > lT || (rT === lT && !localUnsent)) {
      if (!l || baseHash(l) !== hb || lT !== rT) { byId.set(ch.id, r); dirty = true; }
      map[ch.id] = hb;
    }
  });
  // records deleted on another device while this one was away (only trust a server answer)
  if (!swept && !snap.fromCache) {
    const server = new Set(snap.ids);
    for (const id of Array.from(byId.keys())) {
      if (map[id] !== undefined && !server.has(id)) { byId.delete(id); delete map[id]; dirty = true; }
    }
    swept = true;
  }
  writeMap(map);
  if (dirty) App.setLoads(Array.from(byId.values()));
  if (!ready) {
    ready = true;
    onLocalChange();                                            // upload anything made on this device first
    checkingQueue = true;
    backend.waitSynced().then(() => { checkingQueue = false; render(); }).catch(() => { checkingQueue = false; render(); });
  }
  render();
}

// ---------- sign-in / devices shared between drivers ----------
function clearDevice() {
  writeMap({});
  App.setLoads([]);
}
async function handleUser(u) {
  if (unsub) { unsub(); unsub = null; }
  ready = false; swept = false; user = u; member = null;
  if (!u) { state = "signedout"; render(); return; }
  state = "checking"; render();

  const st = App.getSettings();
  if (st.cloudUid && st.cloudUid !== u.uid && App.getLoads().length) {
    const n = unsyncedCount();
    if (n) {
      const ok = confirm("This device has " + n + " load record" + (n === 1 ? "" : "s") + " from " + (st.cloudName || "another driver") +
        " that haven't uploaded yet.\n\nOK: save a backup file of them, then switch to " + u.name + ".\nCancel: stay signed out.");
      if (!ok) { await backend.signOut(); return; }
      App.downloadBackup();
    }
    clearDevice();
    App.flash("Switched to " + u.name + ". " + (st.cloudName || "The last driver") + "'s loads are safe in the cloud.");
  }

  try {
    member = await backend.getMember(u.email);
    if (!member) {
      // the owner's first sign-in creates their own admin entry; the security rules refuse anyone else
      try { await backend.setMember(u.email, { role: "admin", name: u.name }); member = { role: "admin" }; } catch (e) {}
    }
  } catch (e) {
    if (st.cloudUid === u.uid && st.cloudRole) member = { role: st.cloudRole };  // no signal: trust the last answer
  }
  if (!member) { state = "notmember"; render(); return; }

  App.saveSettings({ cloudUid: u.uid, cloudName: u.name, cloudRole: member.role });
  if (!App.getSettings().driver) App.saveSettings({ driver: u.name });
  state = "on";
  unsub = backend.watchMine(u.uid, onRemote, err => { lastErr = (err && err.code) || "error"; render(); });
  render();
}

async function signIn() {
  try { await backend.signIn(); }
  catch (e) { App.flash("Sign-in didn't finish: " + ((e && e.code) || "unknown error").replace("auth/", "")); }
}
async function signOut() {
  const n = unsyncedCount();
  const msg = n
    ? n + " load record" + (n === 1 ? " hasn't" : "s haven't") + " uploaded yet (no signal?).\n\nOK: save a backup file, sign out and clear this device.\nCancel: stay signed in."
    : "Sign out and clear this device?\n\nYour loads are saved in the cloud and come back when you sign in again.";
  if (!confirm(msg)) return;
  if (n) App.downloadBackup();
  if (unsub) { unsub(); unsub = null; }
  ready = false;
  clearDevice();
  App.saveSettings({ cloudUid: null, cloudName: null, cloudRole: null, driver: "" });
  await backend.signOut();
}

// ---------- status UI ----------
function render() {
  const line = document.getElementById("syncLine");
  const block = document.getElementById("cloudBlock");
  if (!line || !block) return;
  const online = navigator.onLine;
  const waiting = pending + (checkingQueue ? 1 : 0);
  let txt = "", cls = "", detail = "";
  if (state === "signedout") { txt = "Not signed in · tap to sync"; cls = "warn"; detail = "Sign in so your loads reach the office and your other devices."; }
  else if (state === "checking") { txt = "Signing in…"; detail = "Checking the crew list…"; }
  else if (state === "notmember") {
    txt = "Not on the crew list"; cls = "bad";
    detail = (user ? user.email : "This account") + " isn't on the crew list yet. Ask the office to add it, then tap Check again. Your loads stay on this device and upload once you're added.";
  } else if (state === "on") {
    if (lastErr === "permission-denied") { txt = "Sync blocked"; cls = "bad"; detail = "The database refused an upload. Ask the office to check your crew list role."; }
    else if (!online) { txt = "No signal" + (waiting ? " · " + (pending || "some") + " waiting" : ""); cls = "warn"; detail = "Loads are saved on this device and upload automatically when you get service."; }
    else if (waiting) { txt = "Syncing…"; detail = "Uploading your changes."; }
    else { txt = "Synced"; cls = "ok"; detail = "Everything on this device is saved to the crew database."; }
  }
  line.textContent = txt;
  line.className = "sync-line show " + cls;
  block.style.display = "";
  document.getElementById("cloudText").textContent = (user && state !== "signedout" ? "Signed in as " + user.name + " (" + user.email + "). " : "") + detail;
  const si = document.getElementById("cloudSignIn");
  si.style.display = state === "signedout" || state === "notmember" ? "" : "none";
  si.textContent = state === "notmember" ? "Check again" : "Sign in with Google";
  document.getElementById("cloudSignOut").style.display = user ? "" : "none";
  const off = document.getElementById("officeLink");
  off.style.display = member && (member.role === "office" || member.role === "admin") ? "" : "none";
}

// ---------- start ----------
async function start() {
  if (!firebaseConfig) return;                                  // not set up: device-only mode
  const { createBackend } = await import("./backend-firebase.js");
  backend = await createBackend(firebaseConfig, ORG);
  window.LoadSheetCloud = { onLocalChange, signIn, signOut, status: () => ({ state, pending, ready, lastErr, user, member }) };
  document.getElementById("cloudSignIn").addEventListener("click", () => state === "notmember" && user ? handleUser(user) : signIn());
  document.getElementById("cloudSignOut").addEventListener("click", signOut);
  document.getElementById("syncLine").addEventListener("click", () => {
    if (state === "signedout") signIn(); else App.openData();
  });
  window.addEventListener("online", () => { if (state === "notmember" && user) handleUser(user); else render(); });
  setInterval(() => { if (state === "notmember" && user && navigator.onLine) handleUser(user); }, 60000);
  window.addEventListener("offline", render);
  state = "signedout"; render();
  backend.onAuth(handleUser);
}
start().catch(e => { console.error("[LoadSheet sync]", e); });
