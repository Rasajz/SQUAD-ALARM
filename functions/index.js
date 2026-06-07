const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.sendAlarmPush = functions.database.ref('/alarm').onWrite(async (change, context) => {
  const alarmData = change.after.val();
  if (!alarmData) return;

  const beforeData = change.before.val();
  if (beforeData && beforeData.id === alarmData.id) {
    console.log("Same alarm ID, ignoring push.");
    return;
  }

  // Get all device tokens from the /users node
  const usersSnap = await admin.database().ref('/users').once('value');
  const tokens = [];
  usersSnap.forEach(child => {
    const user = child.val();
    if (user.fcmToken) {
      // Ensure unique tokens
      if (!tokens.includes(user.fcmToken)) {
        tokens.push(user.fcmToken);
      }
    }
  });

  if (tokens.length === 0) {
    console.log("No tokens to send to.");
    return;
  }

  const message = {
    notification: {
      title: '🚨 ALARM TRIGGERED! 🚨',
      body: `Triggered by ${alarmData.by || 'Someone'}`
    },
    webpush: {
      notification: {
        icon: '/icon-192.png',
        vibrate: [500, 110, 500, 110, 450, 110, 200, 110, 170, 40, 450, 110, 200, 110, 170, 40, 500],
        requireInteraction: true
      },
      fcmOptions: {
        link: 'https://squad-alarm.web.app'
      }
    },
    tokens: tokens
  };

  try {
    const response = await admin.messaging().sendMulticast(message);
    console.log("Successfully sent message:", response.successCount, "successes", response.failureCount, "failures");
  } catch (error) {
    console.log("Error sending message:", error);
  }
});

exports.sendCallPush = functions.database.ref('/calls/{callId}').onCreate(async (snap, context) => {
  const callData = snap.val();
  if (!callData || callData.status !== 'ringing') return;

  const receiverUid = callData.receiver;
  const callerName = callData.callerName || 'Someone';

  // Get receiver's FCM token
  const userSnap = await admin.database().ref(`/users/${receiverUid}`).once('value');
  const user = userSnap.val();
  
  if (!user || !user.fcmToken) {
    console.log("No FCM token found for receiver:", receiverUid);
    return;
  }

  const message = {
    notification: {
      title: `📞 Incoming Call from ${callerName}`,
      body: 'Tap to answer the call'
    },
    webpush: {
      notification: {
        icon: '/icon-192.png',
        vibrate: [500, 110, 500, 110, 450, 110, 200, 110, 170, 40, 450, 110, 200, 110, 170, 40, 500],
        requireInteraction: true
      },
      fcmOptions: {
        link: 'https://squad-alarm.web.app/'
      }
    },
    token: user.fcmToken
  };

  try {
    const response = await admin.messaging().send(message);
    console.log("Successfully sent call message:", response);
  } catch (error) {
    console.log("Error sending call message:", error);
  }
});
