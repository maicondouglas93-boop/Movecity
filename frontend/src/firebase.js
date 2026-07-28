// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBR8Kw7upDB9mpntUsRInL7sSgWiEXVbOU",
  authDomain: "movecity-12a8d.firebaseapp.com",
  projectId: "movecity-12a8d",
  storageBucket: "movecity-12a8d.firebasestorage.app",
  messagingSenderId: "130874019505",
  appId: "1:130874019505:web:5ee27a5f42159b89375c90",
  measurementId: "G-TMD2F0X2FE"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
