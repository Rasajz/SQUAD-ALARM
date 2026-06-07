# 🚨 Squad Alarm - Setup Guide

## What This App Does
- **One-click group alarm** - press the button, ALL devices ring & vibrate
- **Works in silent mode** - vibrates when phone is muted
- **Real-time notifications** - uses Firebase for instant delivery
- **Multiple groups** - create different squads (office, friends, etc.)

---

## 🔧 Setup Instructions

### Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **"Create Project"**
3. Name it `squad-alarm`
4. Enable Google Analytics (optional)
5. Click **"Create Project"**

### Step 2: Set Up Real-time Database

1. In Firebase Console, go to **Build → Realtime Database**
2. Click **"Create Database"**
3. Choose region closest to you
4. Select **"Start in test mode"** (for development)
5. Click **"Enable"**

### Step 3: Configure Security Rules

1. Go to **Realtime Database → Rules** tab
2. Replace the rules with:

```json
{
  "rules": {
    "groups": {
      "{groupId}": {
        ".read": true,
        ".write": true,
        "users": {
          "{userId}": {
            ".validate": "newData.hasChildren(['name', 'joinedAt', 'notificationsEnabled'])"
          }
        },
        "alarms": {
          "{alarmId}": {
            ".validate": "newData.hasChildren(['triggeredBy', 'timestamp'])"
          }
        }
      }
    }
  }
}
```

3. Click **"Publish"**

### Step 4: Get Firebase Config

1. In Firebase Console, click **⚙️ Settings → Project Settings**
2. Scroll down to **"Your apps"** section
3. Click the **Web** icon (</> symbol)
4. Enter app name: `squad-alarm-web`
5. Copy your Firebase config object
6. It should look like:

```javascript
{
  apiKey: "AIzaSyD...",
  authDomain: "squad-alarm-XXX.firebaseapp.com",
  databaseURL: "https://squad-alarm-XXX.firebaseio.com",
  projectId: "squad-alarm-XXX",
  storageBucket: "squad-alarm-XXX.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc..."
}
```

### Step 5: Update App Config

1. Open `src/firebase.js` in your editor
2. Replace the `firebaseConfig` object with your actual config from Step 4
3. Save the file

---

## 🚀 Run the App Locally

```bash
npm run dev
```

Then open **http://localhost:8080** in your browser.

---

## 📱 How to Use

### Join a Group:
1. Enter any **Group ID** (e.g., `my-squad`, `office-team`)
2. Enter your **Name**
3. Click **"Join Group"**

### Trigger Alarm:
1. Share your Group ID with friends
2. They join the same group
3. When you press **🚨 PRESS TO ALARM**, everyone's devices ring!

---

## ✨ Features

✅ **Instant Notifications** - Real-time alarm delivery
✅ **Vibration Pattern** - Always vibrates, even in silent mode  
✅ **Siren Sound** - Loud alarm tone (if not muted)
✅ **Browser Notifications** - System-level alerts
✅ **Multiple Devices** - Works on phone, tablet, laptop
✅ **No Login Required** - Just join with a group ID
✅ **Responsive Design** - Beautiful on all screen sizes

---

## 🔒 Security Notes

For **production**, update Firebase rules:
- Add user authentication (sign-up/login)
- Restrict group access to invited members only
- Add rate limiting to prevent alarm spam

Current test mode rules allow anyone to create/join groups.

---

## 🛠️ Deploy to Web

### Option 1: Firebase Hosting
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

### Option 2: GitHub Pages
```bash
npm run build
# Push dist/ folder to GitHub Pages
```

### Option 3: Netlify
```bash
npm run build
# Drag dist/ folder to Netlify
```

---

## 📞 Troubleshooting

### Alarm not working?
- Check browser supports Web Audio API
- Allow microphone & notification permissions
- Check device is not in Do Not Disturb mode

### Firebase connection error?
- Verify Firebase config is correct in `src/firebase.js`
- Check Realtime Database is enabled
- Ensure rules are published

### Vibration not working?
- Vibration API requires HTTPS (or localhost)
- Mobile devices need vibration permission
- Some devices may not support vibration

---

## 📄 License

MIT - Use freely!

---

**Ready to test?** 🚀

1. Get your Firebase config
2. Update `src/firebase.js`
3. Run `npm run dev`
4. Open 2+ browser windows/tabs with same Group ID
5. Press alarm on one → all devices ring!
