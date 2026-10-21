// Thin wrapper around Firebase so the rest of Load Sheet never touches the SDK directly.
// Data layout:
//   orgs/{org}/members/{email}   { role: "driver" | "office" | "admin", name? }
//   orgs/{org}/records/{id}      one load, or one hourly job (with its time entries),
//                                plus driverUid / driverName / driverEmail / updatedAt
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

  const recCol = collection(db, "orgs", org, "records");
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
    watchMine(uid, cb, onErr) {
      return onSnapshot(query(recCol, where("driverUid", "==", uid)), { includeMetadataChanges: false }, snapHandler(cb), onErr);
    },
    watchAll(cb, onErr) {
      return onSnapshot(recCol, snapHandler(cb), onErr);
    },
    put(id, data) { return setDoc(doc(recCol, id), data); },
    del(id) { return deleteDoc(doc(recCol, id)); },
    waitSynced() { return waitForPendingWrites(db); },
    watchMembers(cb, onErr) {
      return onSnapshot(collection(db, "orgs", org, "members"),
        s => cb(s.docs.map(d => Object.assign({ email: d.id }, d.data()))), onErr);
    },
    setMember(email, data) { return setDoc(doc(db, "orgs", org, "members", email.toLowerCase()), data, { merge: true }); },
    removeMember(email) { return deleteDoc(doc(db, "orgs", org, "members", email.toLowerCase())); }
  };
}
