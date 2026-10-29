// Thin wrapper around Firebase so the rest of Load Sheet never touches the SDK directly.
// Data layout:
//   orgs/{org}/members/{email}   { role: "driver" | "office" | "admin", name? }
//   orgs/{org}/records/{id}      one load, or one hourly job (with its time entries)
//   orgs/{org}/hitches/{id}      one trailer hookup: hook time/place/odometer, drop time/place/odometer
//   orgs/{org}/trailers/{id}     the crew's shared trailer list { type, name }
//   orgs/{org}/usage/{id}        one operator's hours on one machine for a day (+ problem for the shop)
//   orgs/{org}/equipment/{id}    the crew's machine list { unit, type, model, serviceEvery, lastService, lastMeter }
//   orgs/{org}/assignments/{id}  a job the office sent to one driver (assignedTo = driver's email)
// records and hitches also carry driverUid / driverName / driverEmail / updatedAt
import {
  initializeApp, getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut, onAuthStateChanged, setPersistence, browserLocalPersistence,
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, getDoc, onSnapshot, query, where, waitForPendingWrites
} from "./vendor/firebase.js";

export async function createBackend(config, org) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  try { await setPersistence(auth, browserLocalPersistence); } catch (e) {}
  getRedirectResult(auth).catch(() => {});

  let db;
  try {
    // keeps a copy on the device and queues writes while there's no signal
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true
    });
  } catch (e) {
    db = initializeFirestore(app, { ignoreUndefinedProperties: true });
  }

  const col = name => collection(db, "orgs", org, name);
  const toUser = u => u && { uid: u.uid, email: (u.email || "").toLowerCase(), name: u.displayName || u.email || "Driver" };

  function snapHandler(cb) {
    let first = true;
    return snap => {
      const changes = snap.docChanges().map(ch => ({
        type: ch.type, id: ch.doc.id, data: ch.doc.data(), pending: ch.doc.metadata.hasPendingWrites
      }));
      cb({ changes, first, fromCache: snap.metadata.fromCache, ids: snap.docs.map(d => d.id) });
      first = false;
    };
  }

  return {
    onAuth(cb) { return onAuthStateChanged(auth, u => cb(toUser(u))); },
    async signIn() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try { await signInWithPopup(auth, provider); }
      catch (e) {
        if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) {
          await signInWithRedirect(auth, provider);
        } else if (e && e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
          throw e;
        }
      }
    },
    signOut() { return signOut(auth); },
    async getMember(email) {
      const s = await getDoc(doc(db, "orgs", org, "members", email));
      return s.exists() ? s.data() : null;
    },
    watchMine(name, uid, cb, onErr) {
      return onSnapshot(query(col(name), where("driverUid", "==", uid)), { includeMetadataChanges: false }, snapHandler(cb), onErr);
    },
    watchAll(name, cb, onErr) {
      return onSnapshot(col(name), snapHandler(cb), onErr);
    },
    watchWhere(name, field, value, cb, onErr) {
      return onSnapshot(query(col(name), where(field, "==", value)), s => cb(s.docs.map(d => Object.assign({ id: d.id }, d.data()))), onErr);
    },
    watchCol(name, cb, onErr) {
      return onSnapshot(col(name), s => cb(s.docs.map(d => Object.assign({ id: d.id }, d.data()))), onErr);
    },
    put(name, id, data) { return setDoc(doc(col(name), id), data); },
    del(name, id) { return deleteDoc(doc(col(name), id)); },
    merge(name, id, data) { return setDoc(doc(col(name), id), data, { merge: true }); },
    waitSynced() { return waitForPendingWrites(db); },
    watchMembers(cb, onErr) {
      return onSnapshot(collection(db, "orgs", org, "members"),
        s => cb(s.docs.map(d => Object.assign({ email: d.id }, d.data()))), onErr);
    },
    setMember(email, data) { return setDoc(doc(db, "orgs", org, "members", email.toLowerCase()), data, { merge: true }); },
    removeMember(email) { return deleteDoc(doc(db, "orgs", org, "members", email.toLowerCase())); }
  };
}
