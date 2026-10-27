// Crew sync settings.
// firebaseConfig comes from Firebase console → Project settings → Your apps → Web app.
// It is not a secret; access is controlled by the Firestore security rules.
// Set it to null to run Load Sheet on this device only (no sign-in, no sync).
export const firebaseConfig = {
  apiKey: "AIzaSyBR4L73Dx07psSXsbYZMeu8G4VqLxZLWK8",
  authDomain: "loadsheet-koch.firebaseapp.com",
  projectId: "loadsheet-koch",
  storageBucket: "loadsheet-koch.firebasestorage.app",
  messagingSenderId: "346937146124",
  appId: "1:346937146124:web:b1b3e978a0ab1a1fbbe729"
};

// Company space inside the database. Every driver and the office share it.
export const ORG = "koch";
