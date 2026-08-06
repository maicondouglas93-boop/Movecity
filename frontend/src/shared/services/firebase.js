import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

// Config vem do build (VITE_FIREBASE_*). No CI/preview sem .env essas vars ficam
// undefined — initializeApp/getAuth quebravam o render de /login e /signup e caíam
// no AppErrorBoundary. Sem config válida exportamos null; login e-mail/senha segue
// funcionando e o botão Google fica desabilitado no cliente.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const hasFirebaseConfig = !!(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);

export const app = hasFirebaseConfig ? initializeApp(firebaseConfig) : null;

let analytics = null;
if (app) {
  try {
    analytics = getAnalytics(app);
  } catch (error) {
    console.warn('Firebase Analytics not available:', error.message);
  }
}
export { analytics };
