import { useState, useEffect, useRef } from "react";
import { db, listenForAlarms, triggerAlarm, registerUser, listenToActiveUsers } from "./firebase";
import { triggerAlarmOnDevice, requestNotificationPermission, showNotification } from "./alarmUtils";
import { AIFeatures } from "./AIFeatures";
import "./App.css";

export default function App() {
  const [groupId, setGroupId] = useState("");
  const [userName, setUserName] = useState("");
  const [joined, setJoined] = useState(false);
  const [activeUsers, setActiveUsers] = useState({});
  const [alarmTriggered, setAlarmTriggered] = useState(false);
  const [deviceId] = useState(() => `device_${Math.random().toString(36).slice(2, 9)}`);
  const unsubscribeRefs = useRef([]);
  const alarmAudioRef = useRef(null);

  // Join group
  const handleJoinGroup = async () => {
    if (!groupId.trim() || !userName.trim()) {
      alert("Please enter Group ID and Username");
      return;
    }

    try {
      // Request notification permission
      await requestNotificationPermission();

      // Register user
      await registerUser(groupId, userName, deviceId);
      setJoined(true);

      // Listen for alarms
      const unsubAlarms = listenForAlarms(groupId, (alarms) => {
        if (alarms) {
          const lastAlarm = Object.values(alarms).pop();
          if (lastAlarm && lastAlarm.triggeredBy !== userName) {
            // Alarm triggered by someone else - trigger on this device
            triggerAlarmOnDevice();
            showNotification("🚨 ALARM!", {
              body: `${lastAlarm.triggeredBy} triggered the alarm!`,
              tag: "alarm",
              requireInteraction: true,
            });
            setAlarmTriggered(true);
            setTimeout(() => setAlarmTriggered(false), 15000);
          }
        }
      });

      // Listen for active users
      const unsubUsers = listenToActiveUsers(groupId, (users) => {
        setActiveUsers(users || {});
      });

      unsubscribeRefs.current = [unsubAlarms, unsubUsers];
    } catch (err) {
      console.error("Error joining group:", err);
      alert("Error joining group: " + err.message);
    }
  };

  // Trigger alarm for entire group
  const handleTriggerAlarm = async () => {
    try {
      // First, trigger on this device
      triggerAlarmOnDevice();

      // Send to group
      await triggerAlarm(groupId, userName);

      // Show local notification
      showNotification("🚨 You triggered the alarm!", {
        body: "Alarm sent to all group members",
      });

      setAlarmTriggered(true);
      setTimeout(() => setAlarmTriggered(false), 15000);
    } catch (err) {
      console.error("Error triggering alarm:", err);
      alert("Error triggering alarm: " + err.message);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unsubscribeRefs.current.forEach((unsub) => {
        if (unsub) unsub();
      });
    };
  }, []);

  const userCount = Object.keys(activeUsers).length;

  return (
    <div className="app-container">
      {!joined ? (
        <div className="login-section">
          <div className="logo">🚨</div>
          <h1>Squad Alarm</h1>
          <p>Group alarm system for teams & friends</p>

          <input
            type="text"
            placeholder="Group ID (e.g., office-team)"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="input-field"
          />

          <input
            type="text"
            placeholder="Your Name"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            className="input-field"
          />

          <button onClick={handleJoinGroup} className="join-btn">
            Join Group
          </button>

          <div className="info-box">
            <h3>📱 How it works:</h3>
            <ul>
              <li>Enter a group ID (shared with others)</li>
              <li>Enter your name</li>
              <li>Press ALARM to trigger for everyone</li>
              <li>Device will ring + vibrate when others trigger</li>
              <li>Works in silent mode ✓</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="alarm-section">
          <div className="header">
            <h1>Squad Alarm</h1>
            <div className="group-info">
              <span className="group-id">Group: {groupId}</span>
              <span className="user-name">👤 {userName}</span>
            </div>
          </div>

          {/* Active Users */}
          <div className="users-panel">
            <h3>👥 Active Members ({userCount})</h3>
            <div className="users-list">
              {Object.entries(activeUsers).map(([id, user]) => (
                <div key={id} className="user-item">
                  <span className="user-status">🟢</span>
                  <span className="user-display-name">{user.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Main Alarm Button */}
          <div className="alarm-button-section">
            <button
              onClick={handleTriggerAlarm}
              className={`alarm-btn ${alarmTriggered ? "active" : ""}`}
              disabled={alarmTriggered}
            >
              <div className="alarm-icon">🚨</div>
              <div className="alarm-text">
                {alarmTriggered ? "ALARM TRIGGERED!" : "PRESS TO ALARM"}
              </div>
            </button>
          </div>

          {alarmTriggered && (
            <div className="alarm-status">
              <p>Alarm ringing on all devices...</p>
            </div>
          )}

          {/* AI Features */}
          <AIFeatures groupName={groupId} userName={userName} />

          {/* Instructions */}
          <div className="instructions">
            <p>
              <strong>💡 Tip:</strong> Share this group ID with others to add them
              to your squad!
            </p>
          </div>

          <button
            onClick={() => {
              setJoined(false);
              unsubscribeRefs.current.forEach((unsub) => {
                if (unsub) unsub();
              });
            }}
            className="leave-btn"
          >
            Leave Group
          </button>
        </div>
      )}
    </div>
  );
}
