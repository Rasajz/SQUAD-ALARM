import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ref, onValue, push, set, remove, off, update, increment } from 'firebase/database';

/* ══════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════ */
const getChatId = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
const REACTIONS_LIST = ['❤️', '😂', '👍', '😮', '😢', '🔥'];
const QUICK_EMOJIS = ['😀','😂','😍','🥰','😎','🤔','😭','😡','👍','👎','❤️','🔥','💯','🎉','🙏','💀','😈','🤝','✅','⚡','😘','🥳','🫡','👀'];
const COLORS = ["#e53935","#8e24aa","#1565c0","#00838f","#2e7d32","#e65100","#6a1b9a","#ad1457"];
const avatarColor = n => COLORS[(n || "?").toUpperCase().charCodeAt(0) % COLORS.length];
const initials = n => (n || "?").trim().split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

function compressImage(file, maxW = 480, q = 0.65) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = e => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        const ratio = Math.min(maxW / img.width, 1);
        c.width = img.width * ratio;
        c.height = img.height * ratio;
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL("image/jpeg", q));
      };
      img.src = e.target.result;
    };
    r.readAsDataURL(file);
  });
}

function fmtDateLabel(ts) {
  const d = new Date(ts), now = new Date();
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'TODAY';
  if (d.toDateString() === y.toDateString()) return 'YESTERDAY';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmtRelative(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/* ══════════════════════════════════════════════════
   DM AVATAR
══════════════════════════════════════════════════ */
function DMAvatar({ name, photo, size = 40, online }) {
  return (
    <div style={{ width: size, height: size, position: 'relative', flexShrink: 0 }}>
      {photo ? (
        <img src={photo} alt={name} style={{
          width: size, height: size, borderRadius: '50%', objectFit: 'cover',
          border: '1px solid rgba(255,255,255,0.1)',
        }} />
      ) : (
        <div style={{
          width: size, height: size, borderRadius: '50%', background: avatarColor(name),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size * 0.36, fontWeight: 800, color: '#fff',
          fontFamily: "'JetBrains Mono',monospace",
        }}>
          {initials(name)}
        </div>
      )}
      {online && (
        <div style={{
          position: 'absolute', bottom: 0, right: 0,
          width: Math.max(size * 0.28, 10), height: Math.max(size * 0.28, 10),
          borderRadius: '50%', background: '#22c55e',
          border: '2px solid #07090d', boxShadow: '0 0 6px #22c55e',
        }} />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════
   CSS ANIMATIONS
══════════════════════════════════════════════════ */
const DM_CSS = `
@keyframes dmTypingDot {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-6px); opacity: 1; }
}
@keyframes dmSlideIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes dmFadeIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
.dm-msg-wrap .dm-msg-actions { opacity: 0; pointer-events: none; transition: opacity 0.15s; }
.dm-msg-wrap:hover .dm-msg-actions { opacity: 1; pointer-events: all; }
.dm-chat-row:hover { background: rgba(255,255,255,0.04) !important; }
.dm-chat-row:active { background: rgba(255,255,255,0.07) !important; }
`;

/* ══════════════════════════════════════════════════
   DIRECT MESSAGES COMPONENT
══════════════════════════════════════════════════ */
export default function DirectMessages({ user, db, isHost }) {
  /* ── STATE ──────────────────────────────────── */
  const [view, setView] = useState('list');
  const [selectedUser, setSelectedUser] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [chatPreviews, setChatPreviews] = useState({});
  const [messages, setMessages] = useState([]);
  const [msgText, setMsgText] = useState('');
  const [msgPhoto, setMsgPhoto] = useState(null);
  const [posting, setPosting] = useState(false);
  const [remoteTyping, setRemoteTyping] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [reactingTo, setReactingTo] = useState(null);
  const [fullImg, setFullImg] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [otherSeen, setOtherSeen] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const msgEndRef = useRef(null);
  const fileRef = useRef(null);
  const typingTimer = useRef(null);
  const typingCheckInterval = useRef(null);
  const shouldAutoScroll = useRef(true);
  const longPressTimer = useRef(null);

  if (!user) return null;

  /* ── LOAD ALL USERS ─────────────────────────── */
  useEffect(() => {
    const usersRef = ref(db, 'users');
    const handler = onValue(usersRef, snap => {
      const data = snap.val();
      if (!data) { setAllUsers([]); return; }
      const arr = Object.entries(data)
        .filter(([uid]) => uid !== user.uid)
        .map(([uid, d]) => ({ uid, name: d.name || 'Unknown', photoURL: d.photoURL || null, ...d }));
      setAllUsers(arr);
    });
    return () => off(usersRef);
  }, [db, user.uid]);

  /* ── LOAD CHAT PREVIEWS ─────────────────────── */
  useEffect(() => {
    const listRef = ref(db, `dm_list/${user.uid}`);
    const handler = onValue(listRef, snap => {
      setChatPreviews(snap.val() || {});
    });
    return () => off(listRef);
  }, [db, user.uid]);

  /* ── ONLINE PRESENCE ────────────────────────── */
  useEffect(() => {
    const presRef = ref(db, 'presence');
    const handler = onValue(presRef, snap => {
      const data = snap.val() || {};
      setOnlineUsers(new Set(Object.keys(data).filter(k => data[k] === true)));
    });
    return () => off(presRef);
  }, [db]);

  /* ── LOAD MESSAGES FOR SELECTED CHAT ────────── */
  useEffect(() => {
    if (!selectedUser) { setMessages([]); return; }
    const chatId = getChatId(user.uid, selectedUser.uid);
    const msgsRef = ref(db, `dm_chats/${chatId}/messages`);

    const handler = onValue(msgsRef, snap => {
      const data = snap.val();
      if (!data) { setMessages([]); return; }
      const arr = Object.entries(data).map(([id, m]) => ({ id, ...m }));
      arr.sort((a, b) => a.ts - b.ts);
      setMessages(arr);
    });

    return () => off(msgsRef);
  }, [db, user.uid, selectedUser]);

  /* ── MARK AS READ (on open + on new messages) ─ */
  useEffect(() => {
    if (!selectedUser || view !== 'chat') return;
    const chatId = getChatId(user.uid, selectedUser.uid);
    set(ref(db, `dm_chats/${chatId}/seen/${user.uid}`), Date.now());
    set(ref(db, `dm_list/${user.uid}/${selectedUser.uid}/unread`), 0);
  }, [selectedUser, messages.length, view, db, user.uid]);

  /* ── LISTEN TO OTHER USER'S SEEN TIMESTAMP ──── */
  useEffect(() => {
    if (!selectedUser) { setOtherSeen(0); return; }
    const chatId = getChatId(user.uid, selectedUser.uid);
    const seenRef = ref(db, `dm_chats/${chatId}/seen/${selectedUser.uid}`);
    const handler = onValue(seenRef, snap => {
      setOtherSeen(snap.val() || 0);
    });
    return () => off(seenRef);
  }, [db, user.uid, selectedUser]);

  /* ── TYPING INDICATOR LISTENER ──────────────── */
  useEffect(() => {
    if (!selectedUser) { setRemoteTyping(false); return; }
    const chatId = getChatId(user.uid, selectedUser.uid);
    const typingRef = ref(db, `dm_chats/${chatId}/typing/${selectedUser.uid}`);
    let lastTs = null;

    const handler = onValue(typingRef, snap => {
      lastTs = snap.val();
      setRemoteTyping(lastTs != null && Date.now() - lastTs < 5000);
    });

    const interval = setInterval(() => {
      if (lastTs != null) {
        setRemoteTyping(Date.now() - lastTs < 5000);
      }
    }, 1000);

    typingCheckInterval.current = interval;

    return () => {
      off(typingRef);
      clearInterval(interval);
    };
  }, [db, user.uid, selectedUser]);

  /* ── AUTO-SCROLL TO BOTTOM ──────────────────── */
  useEffect(() => {
    if (shouldAutoScroll.current && msgEndRef.current) {
      msgEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  /* ── HANDLERS ───────────────────────────────── */
  const openChat = useCallback((u) => {
    setSelectedUser(u);
    setView('chat');
    setReactingTo(null);
    setReplyTo(null);
    setShowEmojiPicker(false);
    shouldAutoScroll.current = true;
  }, []);

  const goBack = useCallback(() => {
    setView('list');
    setSelectedUser(null);
    setMessages([]);
    setReplyTo(null);
    setReactingTo(null);
    setMsgText('');
    setMsgPhoto(null);
    setRemoteTyping(false);
    setShowEmojiPicker(false);
    // Clear my typing indicator
    if (selectedUser) {
      const chatId = getChatId(user.uid, selectedUser.uid);
      remove(ref(db, `dm_chats/${chatId}/typing/${user.uid}`));
    }
  }, [db, user.uid, selectedUser]);

  const handleTyping = useCallback(() => {
    if (!selectedUser) return;
    const chatId = getChatId(user.uid, selectedUser.uid);
    const typingRef = ref(db, `dm_chats/${chatId}/typing/${user.uid}`);
    set(typingRef, Date.now());
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => remove(typingRef), 3000);
  }, [db, user.uid, selectedUser]);

  const sendMessage = useCallback(async () => {
    if ((!msgText.trim() && !msgPhoto) || posting || !selectedUser) return;
    setPosting(true);

    const chatId = getChatId(user.uid, selectedUser.uid);
    const msg = {
      text: msgText.trim() || null,
      photo: msgPhoto || null,
      by: user.name,
      byUid: user.uid,
      byPhoto: user.photoURL || null,
      ts: Date.now(),
      replyTo: replyTo ? { id: replyTo.id, text: replyTo.text, by: replyTo.by } : null,
    };

    try {
      await push(ref(db, `dm_chats/${chatId}/messages`), msg);

      // Update my chat list preview
      await set(ref(db, `dm_list/${user.uid}/${selectedUser.uid}`), {
        lastMsg: msg.text || '📷 Photo',
        lastTs: msg.ts,
        lastBy: user.name,
        lastByUid: user.uid,
        unread: 0,
      });

      // Update their chat list preview (atomic unread increment)
      await update(ref(db, `dm_list/${selectedUser.uid}/${user.uid}`), {
        lastMsg: msg.text || '📷 Photo',
        lastTs: msg.ts,
        lastBy: user.name,
        lastByUid: user.uid,
        unread: increment(1),
      });

      // Send notification
      await push(ref(db, `notifications/${selectedUser.uid}`), {
        from: user.uid,
        fromName: user.name,
        message: msg.text || '📷 Photo',
        chatId,
        ts: msg.ts,
        type: 'dm',
      });

      // Clear typing indicator
      remove(ref(db, `dm_chats/${chatId}/typing/${user.uid}`));

      setMsgText('');
      setMsgPhoto(null);
      setReplyTo(null);
      setShowEmojiPicker(false);
      shouldAutoScroll.current = true;
    } catch (e) {
      console.error('Send failed:', e);
      alert('Could not send message.');
    }
    setPosting(false);
  }, [msgText, msgPhoto, posting, selectedUser, user, db, replyTo]);

  const handlePhotoSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const compressed = await compressImage(file);
    setMsgPhoto(compressed);
    e.target.value = "";
  };

  const addReaction = useCallback(async (msgId, emoji) => {
    if (!selectedUser) return;
    const chatId = getChatId(user.uid, selectedUser.uid);
    const rRef = ref(db, `dm_chats/${chatId}/messages/${msgId}/reactions/${user.uid}`);
    try {
      // Toggle: if same emoji exists, remove it
      const current = messages.find(m => m.id === msgId)?.reactions?.[user.uid];
      if (current === emoji) {
        await remove(rRef);
      } else {
        await set(rRef, emoji);
      }
    } catch (e) { console.error(e); }
    setReactingTo(null);
  }, [db, user.uid, selectedUser, messages]);

  const deleteMessage = useCallback(async (msgId) => {
    if (!selectedUser) return;
    if (!confirm('Delete this message?')) return;
    const chatId = getChatId(user.uid, selectedUser.uid);
    await remove(ref(db, `dm_chats/${chatId}/messages/${msgId}`));
  }, [db, user.uid, selectedUser]);

  const startCall = useCallback(async (type = 'audio') => {
    if (!selectedUser) return;
    const callId = `${user.uid}_${selectedUser.uid}_${Date.now()}`;
    await set(ref(db, `calls/${callId}`), {
      caller: user.uid,
      callerName: user.name,
      callerPhoto: user.photoURL || null,
      receiver: selectedUser.uid,
      receiverName: selectedUser.name,
      receiverPhoto: selectedUser.photoURL || null,
      type,
      status: 'ringing',
      startedAt: Date.now(),
    });
  }, [db, user, selectedUser]);

  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 100;
  };

  const handleLongPress = (msgId) => {
    longPressTimer.current = setTimeout(() => setReactingTo(msgId), 500);
  };
  const cancelLongPress = () => clearTimeout(longPressTimer.current);

  /* ── DERIVED DATA ───────────────────────────── */
  const chatList = useMemo(() => {
    return allUsers
      .map(u => ({
        ...u,
        preview: chatPreviews[u.uid] || null,
        online: onlineUsers.has(u.uid),
      }))
      .sort((a, b) => {
        const aTs = a.preview?.lastTs || 0;
        const bTs = b.preview?.lastTs || 0;
        if (aTs === 0 && bTs === 0) return (a.name || '').localeCompare(b.name || '');
        return bTs - aTs;
      });
  }, [allUsers, chatPreviews, onlineUsers]);

  const shouldShowAvatar = (msg, idx) => {
    if (msg.byUid === user.uid) return false;
    if (idx === 0) return true;
    const prev = messages[idx - 1];
    return prev.byUid !== msg.byUid || (msg.ts - prev.ts > 300000);
  };

  const shouldShowDateSep = (msg, idx) => {
    if (idx === 0) return true;
    return new Date(msg.ts).toDateString() !== new Date(messages[idx - 1].ts).toDateString();
  };

  const hasContent = msgText.trim() || msgPhoto;

  /* ══════════════════════════════════════════════
     RENDER — CHAT LIST
  ══════════════════════════════════════════════ */
  const renderChatList = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '16px 16px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9', letterSpacing: '0.01em' }}>
          Messages
        </div>
        <div style={{
          fontSize: 10, fontWeight: 600, color: '#475569',
          fontFamily: "'JetBrains Mono',monospace", letterSpacing: '0.1em',
        }}>
          {allUsers.length} CONTACT{allUsers.length !== 1 ? 'S' : ''}
        </div>
      </div>

      {/* Contact list */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {chatList.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '60px 20px', gap: 8,
          }}>
            <div style={{ fontSize: 36, opacity: 0.25 }}>💬</div>
            <div style={{
              fontFamily: "'JetBrains Mono',monospace", fontSize: 10,
              color: '#1e293b', letterSpacing: '.15em', textAlign: 'center',
            }}>
              NO TEAM MEMBERS YET<br />SHARE THE APP LINK WITH YOUR SQUAD
            </div>
          </div>
        ) : (
          chatList.map(u => (
            <div
              key={u.uid}
              className="dm-chat-row"
              onClick={() => openChat(u)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px', cursor: 'pointer',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                transition: 'background 0.15s', background: 'transparent',
              }}
            >
              <DMAvatar name={u.name} photo={u.photoURL} size={48} online={u.online} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>
                    {u.name}
                  </span>
                  {u.preview && (
                    <span style={{
                      fontSize: 11, color: '#475569',
                      fontFamily: "'JetBrains Mono',monospace", flexShrink: 0,
                    }}>
                      {fmtRelative(u.preview.lastTs)}
                    </span>
                  )}
                </div>
                {u.preview ? (
                  <div style={{
                    fontSize: 13, color: '#64748b', overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2,
                  }}>
                    {u.preview.lastByUid === user.uid ? 'You: ' : ''}
                    {u.preview.lastMsg}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: '#334155', marginTop: 2, fontStyle: 'italic' }}>
                    Tap to start chatting
                  </div>
                )}
              </div>
              {(u.preview?.unread || 0) > 0 && (
                <div style={{
                  minWidth: 20, height: 20, borderRadius: 10, background: '#dc2626',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 800, color: '#fff', padding: '0 6px',
                  flexShrink: 0,
                }}>
                  {u.preview.unread}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );

  /* ══════════════════════════════════════════════
     RENDER — CONVERSATION
  ══════════════════════════════════════════════ */
  const renderConversation = () => {
    if (!selectedUser) return null;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* ── Chat Header ──────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.02)', flexShrink: 0,
        }}>
          <button onClick={goBack} style={{
            width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8',
            fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s',
          }}>
            ←
          </button>
          <DMAvatar
            name={selectedUser.name}
            photo={selectedUser.photoURL}
            size={36}
            online={onlineUsers.has(selectedUser.uid)}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>
              {selectedUser.name}
            </div>
            <div style={{
              fontSize: 11, fontWeight: 600,
              color: onlineUsers.has(selectedUser.uid) ? '#22c55e' : '#475569',
            }}>
              {onlineUsers.has(selectedUser.uid) ? '● Online' : 'Offline'}
            </div>
          </div>
          <button onClick={() => startCall('audio')} style={{
            width: 36, height: 36, borderRadius: 10, background: 'rgba(34,197,94,0.1)',
            border: '1px solid rgba(34,197,94,0.2)', color: '#22c55e',
            fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s',
          }} title="Audio call">
            📞
          </button>
          <button onClick={() => startCall('video')} style={{
            width: 36, height: 36, borderRadius: 10, background: 'rgba(59,130,246,0.1)',
            border: '1px solid rgba(59,130,246,0.2)', color: '#3b82f6',
            fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s',
          }} title="Video call">
            📹
          </button>
        </div>

        {/* ── Messages Area ────────────────────── */}
        <div
          onScroll={handleScroll}
          onClick={() => { setReactingTo(null); setShowEmojiPicker(false); }}
          style={{
            flex: 1, overflowY: 'auto', overflowX: 'hidden',
            padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 3,
          }}
        >
          {messages.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', flex: 1, gap: 8, padding: 40,
            }}>
              <DMAvatar name={selectedUser.name} photo={selectedUser.photoURL} size={64} />
              <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginTop: 8 }}>
                {selectedUser.name}
              </div>
              <div style={{
                fontSize: 12, color: '#475569', textAlign: 'center', maxWidth: 240,
              }}>
                This is the beginning of your conversation. Say hi! 👋
              </div>
            </div>
          ) : (
            messages.map((m, idx) => {
              const isMine = m.byUid === user.uid;
              const showAvatar = shouldShowAvatar(m, idx);
              const showDate = shouldShowDateSep(m, idx);
              const canDelete = isHost || m.byUid === user.uid;

              return (
                <div key={m.id}>
                  {/* Date separator */}
                  {showDate && (
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: '12px 0 8px',
                    }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: '#475569',
                        fontFamily: "'JetBrains Mono',monospace",
                        letterSpacing: '0.12em', background: 'rgba(255,255,255,0.04)',
                        padding: '4px 12px', borderRadius: 10,
                      }}>
                        {fmtDateLabel(m.ts)}
                      </span>
                    </div>
                  )}

                  {/* Message */}
                  <div
                    className="dm-msg-wrap"
                    style={{
                      display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start',
                      alignItems: 'flex-end', gap: 6,
                      marginTop: idx > 0 && messages[idx - 1].byUid === m.byUid && !showDate ? 2 : 8,
                      animation: 'dmSlideIn 0.2s ease-out',
                      position: 'relative',
                    }}
                    onContextMenu={(e) => { e.preventDefault(); setReactingTo(m.id); }}
                    onTouchStart={() => handleLongPress(m.id)}
                    onTouchEnd={cancelLongPress}
                    onTouchMove={cancelLongPress}
                  >
                    {/* Avatar for received messages */}
                    {!isMine && (
                      showAvatar ? (
                        <DMAvatar name={m.by} photo={m.byPhoto} size={28} />
                      ) : (
                        <div style={{ width: 28, flexShrink: 0 }} />
                      )
                    )}

                    <div style={{ maxWidth: '75%', position: 'relative' }}>
                      {/* Action buttons (hover / long-press) */}
                      <div
                        className="dm-msg-actions"
                        style={{
                          position: 'absolute', top: -6, zIndex: 5,
                          ...(isMine ? { left: -4 } : { right: -4 }),
                          display: 'flex', gap: 1, background: '#1a1d2e',
                          borderRadius: 10, padding: '2px 3px',
                          border: '1px solid rgba(255,255,255,0.1)',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                        }}
                      >
                        <button
                          onClick={(e) => { e.stopPropagation(); setReplyTo({ id: m.id, text: m.text || '📷 Photo', by: m.by }); }}
                          style={{
                            background: 'none', border: 'none', fontSize: 13, cursor: 'pointer',
                            padding: '3px 5px', borderRadius: 6, color: '#94a3b8',
                          }}
                          title="Reply"
                        >
                          ↩
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setReactingTo(reactingTo === m.id ? null : m.id); }}
                          style={{
                            background: 'none', border: 'none', fontSize: 13, cursor: 'pointer',
                            padding: '3px 5px', borderRadius: 6, color: '#94a3b8',
                          }}
                          title="React"
                        >
                          😊
                        </button>
                        {canDelete && (
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteMessage(m.id); }}
                            style={{
                              background: 'none', border: 'none', fontSize: 13, cursor: 'pointer',
                              padding: '3px 5px', borderRadius: 6, color: '#ef4444',
                            }}
                            title="Delete"
                          >
                            🗑
                          </button>
                        )}
                      </div>

                      {/* Reaction Picker */}
                      {reactingTo === m.id && (
                        <div
                          className="dm-reaction-picker"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            position: 'absolute', bottom: '100%', marginBottom: 4, zIndex: 10,
                            ...(isMine ? { right: 0 } : { left: 0 }),
                            display: 'flex', gap: 2, background: '#1a1d2e',
                            border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20,
                            padding: '5px 8px', animation: 'dmFadeIn 0.15s ease-out',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                          }}
                        >
                          {REACTIONS_LIST.map(emoji => (
                            <button
                              key={emoji}
                              onClick={() => addReaction(m.id, emoji)}
                              style={{
                                background: 'none', border: 'none', fontSize: 18, cursor: 'pointer',
                                padding: '2px 3px', borderRadius: 8, transition: 'transform 0.1s',
                              }}
                              onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.3)'}
                              onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Reply quote */}
                      {m.replyTo && (
                        <div style={{
                          background: isMine ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.06)',
                          borderLeft: `3px solid ${isMine ? '#fca5a5' : '#475569'}`,
                          borderRadius: '4px 10px 10px 4px', padding: '6px 10px',
                          marginBottom: 2, maxWidth: '100%',
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: isMine ? '#fca5a5' : '#64748b' }}>
                            {m.replyTo.by}
                          </div>
                          <div style={{
                            fontSize: 12, color: isMine ? 'rgba(255,255,255,0.6)' : '#94a3b8',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {m.replyTo.text}
                          </div>
                        </div>
                      )}

                      {/* Message bubble */}
                      <div style={{
                        background: isMine
                          ? 'linear-gradient(135deg, #dc2626, #b91c1c)'
                          : '#1e2030',
                        borderRadius: isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                        padding: m.text ? '10px 14px' : '4px',
                        wordBreak: 'break-word', fontSize: 14, lineHeight: 1.45,
                        color: isMine ? '#fff' : '#e2e8f0',
                        boxShadow: isMine
                          ? '0 2px 8px rgba(220,38,38,0.2)'
                          : '0 1px 4px rgba(0,0,0,0.15)',
                      }}>
                        {m.text && <div>{m.text}</div>}
                        {m.photo && (
                          <img
                            src={m.photo}
                            alt="photo"
                            onClick={(e) => { e.stopPropagation(); setFullImg(m.photo); }}
                            style={{
                              width: '100%', maxWidth: 240, borderRadius: m.text ? 10 : 14,
                              marginTop: m.text ? 6 : 0, cursor: 'pointer',
                              border: '1px solid rgba(255,255,255,0.1)',
                            }}
                          />
                        )}
                      </div>

                      {/* Reactions display */}
                      {m.reactions && Object.keys(m.reactions).length > 0 && (
                        <div style={{
                          display: 'flex', gap: 3, marginTop: 3, flexWrap: 'wrap',
                          justifyContent: isMine ? 'flex-end' : 'flex-start',
                        }}>
                          {Object.entries(
                            Object.values(m.reactions).reduce((acc, emoji) => {
                              acc[emoji] = (acc[emoji] || 0) + 1;
                              return acc;
                            }, {})
                          ).map(([emoji, count]) => (
                            <span key={emoji} style={{
                              background: 'rgba(255,255,255,0.08)',
                              border: '1px solid rgba(255,255,255,0.06)',
                              borderRadius: 12, padding: '1px 6px', fontSize: 12,
                            }}>
                              {emoji}{count > 1 ? ` ${count}` : ''}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Time + Read receipt */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 4, marginTop: 2,
                        justifyContent: isMine ? 'flex-end' : 'flex-start',
                      }}>
                        <span style={{
                          fontSize: 10, color: 'rgba(255,255,255,0.25)',
                          fontFamily: "'JetBrains Mono',monospace",
                        }}>
                          {fmtTime(m.ts)}
                        </span>
                        {isMine && (
                          <span style={{
                            fontSize: 10,
                            color: otherSeen >= m.ts ? '#dc2626' : 'rgba(255,255,255,0.25)',
                          }}>
                            {otherSeen >= m.ts ? '✓✓' : '✓✓'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {/* Typing indicator */}
          {remoteTyping && (
            <div style={{
              display: 'flex', gap: 6, alignItems: 'flex-end', marginTop: 6,
              animation: 'dmFadeIn 0.2s ease-out',
            }}>
              <DMAvatar name={selectedUser.name} photo={selectedUser.photoURL} size={28} />
              <div style={{
                background: '#1e2030', borderRadius: '18px 18px 18px 4px',
                padding: '12px 16px', display: 'flex', gap: 4, alignItems: 'center',
              }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', background: '#64748b',
                  display: 'inline-block',
                  animation: 'dmTypingDot 1.4s ease-in-out infinite',
                }} />
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', background: '#64748b',
                  display: 'inline-block',
                  animation: 'dmTypingDot 1.4s ease-in-out 0.2s infinite',
                }} />
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', background: '#64748b',
                  display: 'inline-block',
                  animation: 'dmTypingDot 1.4s ease-in-out 0.4s infinite',
                }} />
              </div>
            </div>
          )}

          <div ref={msgEndRef} />
        </div>

        {/* ── Input Area ───────────────────────── */}
        <div style={{
          padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.06)',
          background: '#0a0c12', flexShrink: 0, position: 'relative',
        }}>
          {/* Reply preview */}
          {replyTo && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'rgba(255,255,255,0.04)', borderLeft: '3px solid #dc2626',
              borderRadius: '4px 10px 10px 4px', padding: '7px 10px', marginBottom: 8,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626' }}>
                  Replying to {replyTo.by}
                </div>
                <div style={{
                  fontSize: 12, color: '#64748b', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {replyTo.text}
                </div>
              </div>
              <button onClick={() => setReplyTo(null)} style={{
                background: 'none', border: 'none', color: '#475569',
                fontSize: 14, cursor: 'pointer', padding: '2px 6px',
              }}>
                ✕
              </button>
            </div>
          )}

          {/* Photo preview */}
          {msgPhoto && (
            <div style={{ position: 'relative', display: 'inline-block', marginBottom: 8 }}>
              <img src={msgPhoto} alt="preview" style={{
                width: 80, height: 80, objectFit: 'cover', borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.15)',
              }} />
              <button onClick={() => setMsgPhoto(null)} style={{
                position: 'absolute', top: -6, right: -6,
                width: 20, height: 20, background: '#ef4444', border: 'none',
                borderRadius: '50%', color: '#fff', fontSize: 11, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                ✕
              </button>
            </div>
          )}

          {/* Emoji picker */}
          {showEmojiPicker && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute', bottom: '100%', left: 12, marginBottom: 4,
                background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 16, padding: 10, width: 280,
                display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2,
                animation: 'dmFadeIn 0.15s ease-out',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              }}
            >
              {QUICK_EMOJIS.map(e => (
                <button
                  key={e}
                  onClick={() => { setMsgText(prev => prev + e); setShowEmojiPicker(false); }}
                  style={{
                    background: 'none', border: 'none', fontSize: 20, cursor: 'pointer',
                    padding: 3, borderRadius: 8, transition: 'transform 0.1s',
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          )}

          {/* Input row */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            <button
              onClick={(e) => { e.stopPropagation(); setShowEmojiPicker(!showEmojiPicker); }}
              style={{
                width: 38, height: 38, borderRadius: 10,
                background: showEmojiPicker ? 'rgba(220,38,38,0.15)' : 'rgba(255,255,255,0.06)',
                border: '1px solid ' + (showEmojiPicker ? 'rgba(220,38,38,0.3)' : 'rgba(255,255,255,0.1)'),
                color: showEmojiPicker ? '#dc2626' : '#64748b',
                fontSize: 18, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'all 0.15s',
              }}
              title="Emoji"
            >
              😊
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                width: 38, height: 38, borderRadius: 10,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#64748b', fontSize: 18, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'all 0.15s',
              }}
              title="Attach photo"
            >
              📷
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handlePhotoSelect}
            />
            <textarea
              value={msgText}
              onChange={e => { setMsgText(e.target.value); handleTyping(); }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
              }}
              placeholder={`Message ${selectedUser?.name?.split(' ')[0]}…`}
              rows={1}
              style={{
                flex: 1, padding: '9px 13px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 14, color: '#e2e8f0',
                fontFamily: "'DM Sans',system-ui,sans-serif",
                fontSize: 14, fontWeight: 500, outline: 'none', resize: 'none',
                minHeight: 38, maxHeight: 90, lineHeight: 1.5,
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = 'rgba(220,38,38,0.4)'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
            />
            <button
              onClick={sendMessage}
              disabled={!hasContent || posting}
              style={{
                width: 38, height: 38, borderRadius: 12,
                background: hasContent ? '#dc2626' : 'rgba(255,255,255,0.06)',
                border: 'none',
                color: hasContent ? '#fff' : '#334155',
                fontSize: 16, cursor: hasContent ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'all 0.2s',
                boxShadow: hasContent ? '0 2px 10px rgba(220,38,38,0.3)' : 'none',
              }}
            >
              {posting ? '…' : '➤'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  /* ══════════════════════════════════════════════
     MAIN RETURN
  ══════════════════════════════════════════════ */
  return (
    <>
      <style>{DM_CSS}</style>

      {/* Full-screen image viewer */}
      {fullImg && (
        <div
          onClick={() => setFullImg(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20, cursor: 'pointer',
          }}
        >
          <img
            src={fullImg}
            alt="full view"
            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 12 }}
          />
        </div>
      )}

      <div style={{
        display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
        fontFamily: "'DM Sans',system-ui,-apple-system,sans-serif",
      }}>
        {view === 'list' ? renderChatList() : renderConversation()}
      </div>
    </>
  );
}
