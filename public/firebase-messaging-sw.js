/* ══════════════════════════════════════════════════════
   Firebase Cloud Messaging Service Worker
   Handles background push notifications for Squad Alarm
══════════════════════════════════════════════════════ */

importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-messaging-compat.js');

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

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

/* ── Background Message Handler ───────────────── */
messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Background message:', payload);

  const data = payload.data || {};
  const notification = payload.notification || {};

  // Determine notification content
  const title = data.senderName
    ? `${data.senderName}`
    : (notification.title || '🚨 Squad Alarm');

  const body = data.message
    ? data.message
    : (notification.body || 'New notification');

  // Determine type and tag to prevent stacking
  const type = data.type || 'alarm';
  const chatId = data.chatId || '';
  const tag = type === 'dm' ? `squad-dm-${chatId}` : `squad-${type}`;

  const notificationOptions = {
    body: body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: tag,
    renotify: true,
    requireInteraction: type === 'alarm',
    vibrate: type === 'alarm'
      ? [500, 110, 500, 110, 450, 110, 200, 110, 170, 40, 450, 110, 200, 110, 170, 40, 500]
      : [200, 100, 200],
    data: {
      url: 'https://squad-alarm.web.app/',
      chatId: chatId,
      type: type,
    }
  };

  // Show the notification
  self.registration.showNotification(title, notificationOptions);

  // Try to play siren via active client (postMessage)
  // AudioContext is NOT available in service workers, so we
  // ask the foreground client to play it if one exists.
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
    windowClients.forEach(client => {
      client.postMessage({
        type: 'PLAY_SIREN',
        alarmType: type,
        senderName: data.senderName || '',
        message: body,
      });
    });
  });
});

/* ── Notification Click Handler ───────────────── */
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = data.url || 'https://squad-alarm.web.app/';

  // If it's a DM notification, add query param so app opens to correct chat
  if (data.type === 'dm' && data.chatId) {
    targetUrl += `?chat=${data.chatId}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Try to focus an existing window
      for (const client of windowClients) {
        if ('focus' in client) {
          client.focus();
          // Send message to navigate to the right chat
          client.postMessage({
            type: 'NAVIGATE_TO_CHAT',
            chatId: data.chatId || null,
            notificationType: data.type || 'alarm',
          });
          return;
        }
      }
      // No existing window — open a new one
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

/* ══════════════════════════════════════════════════════
   iOS Safari PWA Limitations & Notes:
   
   1. iOS Safari does NOT support Web Push via FCM.
      Push notifications only work on iOS 16.4+ when
      the PWA is added to Home Screen (standalone mode).
   
   2. iOS requires the user to explicitly enable push
      via Settings > Notifications after installing PWA.
   
   3. Background audio (siren) is heavily restricted on
      iOS. The postMessage approach above won't work if
      the app is fully suspended. iOS will only show the
      system notification banner.
   
   4. Vibration API (navigator.vibrate) is NOT supported
      on iOS Safari at all.
   
   5. For the best iOS experience, users should:
      a. Add the app to Home Screen
      b. Enable notifications in iOS Settings
      c. Keep the app open (not force-closed)
══════════════════════════════════════════════════════ */
