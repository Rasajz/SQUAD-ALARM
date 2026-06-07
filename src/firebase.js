import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";
import { getMessaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyB4MF_nxOKIMXfFiswA2JszWrcOudA38zw",
  authDomain: "squad-alarm.firebaseapp.com",
  databaseURL: "https://squad-alarm-default-rtdb.firebaseio.com",
  projectId: "squad-alarm",
  storageBucket: "squad-alarm.firebasestorage.app",
  messagingSenderId: "942129712796",
  appId: "1:942129712796:web:c9eb1fa2939887e5042759",
  measurementId: "G-QNQ8F43ZT3"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
export const messaging = typeof window !== 'undefined' && 'serviceWorker' in navigator ? getMessaging(app) : null;
