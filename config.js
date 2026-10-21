// Crew sync settings.
// firebaseConfig comes from Firebase console → Project settings → Your apps → Web app.
// It is not a secret; access is controlled by the Firestore security rules.
// While it is null, Load Sheet runs on this device only (no sign-in, no sync).
export const firebaseConfig = null;

// Company space inside the database. Every driver and the office share it.
export const ORG = "koch";
