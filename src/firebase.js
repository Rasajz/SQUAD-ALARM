import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, push } from "firebase/database";
import { getMessaging, onMessage } from "firebase/messaging";

// Replace these with your Firebase config
// Get it from: Firebase Console → Project Settings → Your apps → Web
const firebaseConfig = {
  apiKey: "AIzaSyDemoKeyChangeThis12345",
  authDomain: "squad-alarm-demo.firebaseapp.com",
  databaseURL: "https://squad-alarm-demo.firebaseio.com",
  projectId: "squad-alarm-demo",
  storageBucket: "squad-alarm-demo.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdefg"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const messaging = getMessaging(app);

// Listen for incoming alarm messages
export function listenForAlarms(groupId, callback) {
  const alarmRef = ref(db, `groups/${groupId}/alarms`);
  return onValue(alarmRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.val());
    }
  });
}

// Send alarm to group
export async function triggerAlarm(groupId, userName) {
  const alarmRef = ref(db, `groups/${groupId}/alarms`);
  await push(alarmRef, {
    triggeredBy: userName,
    timestamp: Date.now(),
  });
}

// Register user to group
export async function registerUser(groupId, userName, deviceId) {
  const userRef = ref(db, `groups/${groupId}/users/${deviceId}`);
  await set(userRef, {
    name: userName,
    joinedAt: Date.now(),
    notificationsEnabled: true,
  });
}

// Get active users in group
export function listenToActiveUsers(groupId, callback) {
  const usersRef = ref(db, `groups/${groupId}/users`);
  return onValue(usersRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.val());
    } else {
      callback({});
    }
  });
}
