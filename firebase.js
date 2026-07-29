// ====== FIREBASE SETUP ======
// 1. Go to https://console.firebase.google.com, create a project.
// 2. Project settings → General → "Your apps" → Web app → copy the config below.
// 3. Enable Authentication → Sign-in method → Email/Password.
// 4. Enable Firestore Database (start in production or test mode).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  initializeAppCheck, ReCaptchaV3Provider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";

const firebaseConfig = {
  apiKey: "AIzaSyCdaqJb_ylNWeG5jGkw8EYCeeTXK9tzXyY",
  authDomain: "task-flow-399d2.firebaseapp.com",
  projectId: "task-flow-399d2",
  storageBucket: "task-flow-399d2.firebasestorage.app",
  messagingSenderId: "290330856432",
  appId: "1:290330856432:web:2a7cac94db6fbb123feb35",
  measurementId: "G-ET9KEDJ33F"
};

export const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);

// App Check: blocks requests to Auth/Firestore that don't come from this real,
// registered web app (e.g. a script hitting your Firestore endpoints directly).
// TODO: replace with the reCAPTCHA v3 site key from Firebase Console →
// App Check → Apps → task-flow-399d2 → register a "Web" app with reCAPTCHA v3.
// Until that's set, App Check is inactive and everything works as before —
// it fails open here in dev, but enforce it in Firestore Rules once configured
// (Console → App Check → Enforce) so unregistered clients are actually blocked.
if(location.hostname !== 'localhost'){
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider('6Lcik2otAAAAAJi6kS_W0sgY7RaQJ82kBAOVsvob'),
    isTokenAutoRefreshEnabled: true
  });
}

export const auth = getAuth(app);
export const db = getFirestore(app);
// Offline persistence: lets previously-synced tasks load (read-only until reconnect)
// even with no network — this is what actually makes the PWA usable offline for data,
// separate from the service worker below which only caches the static app shell.
enableIndexedDbPersistence(db).catch((err) => {
  if(err.code === 'failed-precondition'){
    console.warn('Offline persistence only works in one tab at a time — already open elsewhere.');
  }else if(err.code === 'unimplemented'){
    console.warn('This browser does not support offline persistence.');
  }
});

export const tasksCol = collection(db, "tasks");
export const listsCol = collection(db, "lists");
export const usersCol = collection(db, "users");
export const presenceCol = collection(db, "presence");

// Central error reporter: keeps the existing console.error() behavior for local
// debugging, and additionally forwards to Sentry (when configured) so failures
// in production surface somewhere a developer actually sees them.
export function reportError(message, err){
  console.error(message, err);
  if(window.Sentry) Sentry.captureException(err, { extra: { message } });
}
