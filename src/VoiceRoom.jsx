import { useState, useEffect, useRef, useCallback } from 'react';
import { ref, onValue, set, push, onChildAdded, remove, off, onDisconnect, update } from 'firebase/database';
import Peer from 'simple-peer';

// ── ICE Servers ──────────────────────────────────
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

// ── SVG Icons (cross-platform, no emoji issues) ──
const Icons = {
  phone: (c = '#fff', s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>,
  phoneOff: (c = '#fff', s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  mic: (c = '#fff', s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>,
  micOff: (c = '#ef4444', s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/><path d="M17 16.95A7 7 0 015 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>,
  video: (c = '#fff', s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>,
  videoOff: (c = '#ef4444', s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 16v1a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2h2m5.66 0H14a2 2 0 012 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/></svg>,
  minimize: (c = '#94a3b8', s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>,
  expand: (c = '#94a3b8', s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>,
  drag: (c = '#475569', s = 14) => <svg width={s} height={s} viewBox="0 0 24 24" fill={c}><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>,
};

// ── Ringing Sound ────────────────────────────────
let ringCtx = null;
let ringNodes = [];

function playRing() {
  try {
    if (!ringCtx || ringCtx.state === 'closed') {
      ringCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ringCtx.state === 'suspended') ringCtx.resume();
    const now = ringCtx.currentTime;
    const osc = ringCtx.createOscillator();
    const gain = ringCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.setValueAtTime(480, now + 0.15);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
    osc.connect(gain).connect(ringCtx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
    ringNodes.push(osc, gain);
  } catch (_) {}
}

function stopRing() {
  ringNodes.forEach(n => { try { n.disconnect(); } catch (_) {} });
  ringNodes = [];
}

// ── Voice Activity Detection ─────────────────────
function createVAD(stream, onSpeaking) {
  try {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 256;
    const data = new Uint8Array(analyser.frequencyBinCount);
    let rafId;
    const check = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      onSpeaking(avg > 18);
      rafId = requestAnimationFrame(check);
    };
    check();
    return () => { cancelAnimationFrame(rafId); source.disconnect(); ctx.close().catch(() => {}); };
  } catch (_) { return () => {}; }
}

// ── CSS Animations ───────────────────────────────
const VOICE_CSS = `
@keyframes vcPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.5); }
  50% { box-shadow: 0 0 0 10px rgba(34,197,94,0); }
}
@keyframes vcRingPulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.08); opacity: 0.8; }
}
@keyframes vcSpeakGlow {
  0%, 100% { box-shadow: 0 0 0 3px rgba(34,197,94,0.6); }
  50% { box-shadow: 0 0 0 6px rgba(34,197,94,0.2); }
}
@keyframes vcIncomingBg {
  0%, 100% { background: rgba(7,9,13,0.97); }
  50% { background: rgba(15,20,30,0.97); }
}
@keyframes vcPulseRing {
  0% { transform: scale(1); opacity: 0.6; }
  100% { transform: scale(2.5); opacity: 0; }
}
@keyframes vcSlideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
`;

// ── Avatar ───────────────────────────────────────
const COLORS = ["#e53935","#8e24aa","#1565c0","#00838f","#2e7d32","#e65100","#6a1b9a","#ad1457"];
function VRAvatar({ name, photo, size = 64, speaking, stream }) {
  const n = name || '?';
  const col = COLORS[n.toUpperCase().charCodeAt(0) % COLORS.length];
  const ini = n.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const borderStyle = speaking ? '3px solid #22c55e' : '2px solid rgba(255,255,255,0.15)';
  const anim = speaking ? 'vcSpeakGlow 1s ease-in-out infinite' : 'none';

  const hasVideo = stream && stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].enabled;

  if (hasVideo) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%', overflow: 'hidden',
        border: borderStyle, animation: anim, flexShrink: 0, background: '#000',
        position: 'relative'
      }}>
        <video 
          ref={el => { if (el && el.srcObject !== stream) { el.srcObject = stream; } }}
          autoPlay playsInline muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    );
  }

  return photo ? (
    <img src={photo} alt={n} style={{
      width: size, height: size, borderRadius: '50%', objectFit: 'cover',
      border: borderStyle, animation: anim, flexShrink: 0,
    }} />
  ) : (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: col,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 800, color: '#fff',
      fontFamily: "'JetBrains Mono',monospace",
      border: borderStyle, animation: anim, flexShrink: 0,
    }}>
      {ini}
    </div>
  );
}

function fmtDuration(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ── VOICE ROOM (Group War Room) ──────────────────
export default function VoiceRoom({ user, db }) {
  const [inRoom, setInRoom] = useState(false);
  const [peers, setPeers] = useState([]);
  const [stream, setStream] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [speakingUsers, setSpeakingUsers] = useState(new Set());

  const peersRef = useRef({});
  const streamRef = useRef(null);
  const vadCleanups = useRef({});
  const heartbeatInterval = useRef(null);

  const updatePeersState = useCallback(() => {
    setPeers(Object.entries(peersRef.current).map(([uid, data]) => ({
      uid, name: data.name, photoURL: data.photoURL, stream: data.stream,
    })));
  }, []);

  const leaveRoom = useCallback(() => {
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current);
      heartbeatInterval.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    Object.values(peersRef.current).forEach(p => {
      try { p.peer.destroy(); } catch (_) {}
    });
    peersRef.current = {};
    Object.values(vadCleanups.current).forEach(fn => fn());
    vadCleanups.current = {};
    setPeers([]);
    setStream(null);
    setInRoom(false);
    setSpeakingUsers(new Set());
    if (user?.uid) {
      remove(ref(db, `voice_lobby/${user.uid}`)).catch(() => {});
      remove(ref(db, `voice_signals/${user.uid}`)).catch(() => {});
    }
  }, [db, user]);

  useEffect(() => {
    return () => {
      if (inRoom) leaveRoom();
    };
  }, []);

  const createPeer = useCallback((targetUid, userInfo) => {
    if (!streamRef.current) return null;
    const peer = new Peer({ initiator: true, trickle: true, stream: streamRef.current, config: { iceServers: ICE_SERVERS } });

    peer.on('signal', signal => {
      push(ref(db, `voice_signals/${targetUid}`), {
        from: user.uid, fromName: user.name, fromPhoto: user.photoURL, signal,
      });
    });

    peer.on('stream', remoteStream => {
      if (peersRef.current[targetUid]) {
        peersRef.current[targetUid].stream = remoteStream;
        updatePeersState();
      }
      const audio = new Audio();
      audio.srcObject = remoteStream;
      audio.play().catch(() => {});
      vadCleanups.current[targetUid] = createVAD(remoteStream, (speaking) => {
        setSpeakingUsers(prev => {
          const next = new Set(prev);
          speaking ? next.add(targetUid) : next.delete(targetUid);
          return next;
        });
      });
    });

    peer.on('close', () => {
      delete peersRef.current[targetUid];
      if (vadCleanups.current[targetUid]) { vadCleanups.current[targetUid](); delete vadCleanups.current[targetUid]; }
      updatePeersState();
    });

    peer.on('error', () => {
      delete peersRef.current[targetUid];
      updatePeersState();
    });

    return peer;
  }, [db, user, updatePeersState]);

  const addPeer = useCallback((incomingSignal, callerUid) => {
    if (!streamRef.current) return null;
    const peer = new Peer({ initiator: false, trickle: true, stream: streamRef.current, config: { iceServers: ICE_SERVERS } });

    peer.on('signal', signal => {
      push(ref(db, `voice_signals/${callerUid}`), {
        from: user.uid, fromName: user.name, fromPhoto: user.photoURL, signal,
      });
    });

    peer.on('stream', remoteStream => {
      if (peersRef.current[callerUid]) {
        peersRef.current[callerUid].stream = remoteStream;
        updatePeersState();
      }
      const audio = new Audio();
      audio.srcObject = remoteStream;
      audio.play().catch(() => {});
      vadCleanups.current[callerUid] = createVAD(remoteStream, (speaking) => {
        setSpeakingUsers(prev => {
          const next = new Set(prev);
          speaking ? next.add(callerUid) : next.delete(callerUid);
          return next;
        });
      });
    });

    peer.on('close', () => {
      delete peersRef.current[callerUid];
      if (vadCleanups.current[callerUid]) { vadCleanups.current[callerUid](); delete vadCleanups.current[callerUid]; }
      updatePeersState();
    });

    peer.on('error', () => {
      delete peersRef.current[callerUid];
      updatePeersState();
    });

    peer.signal(incomingSignal);
    return peer;
  }, [db, user, updatePeersState]);

  const joinRoom = async () => {
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      // Start with video off by default
      localStream.getVideoTracks().forEach(t => t.enabled = false);
      setIsVideoOn(false);
      setStream(localStream);
      streamRef.current = localStream;
      setInRoom(true);

      const myRef = ref(db, `voice_lobby/${user.uid}`);
      await set(myRef, { name: user.name, photoURL: user.photoURL, joinedAt: Date.now(), lastSeen: Date.now() });
      heartbeatInterval.current = setInterval(() => {
        update(myRef, { lastSeen: Date.now() }).catch(() => {});
      }, 10000);
      onDisconnect(myRef).remove();

      const signalsRef = ref(db, `voice_signals/${user.uid}`);
      onChildAdded(signalsRef, (snap) => {
        const data = snap.val();
        if (peersRef.current[data.from]) {
          try { peersRef.current[data.from].peer.signal(data.signal); } catch (e) {
            console.warn('Signal apply error:', e);
          }
        } else if (data.signal && (data.signal.type === 'offer' || data.signal.sdp)) {
          const peer = addPeer(data.signal, data.from);
          peersRef.current[data.from] = { peer, name: data.fromName, photoURL: data.fromPhoto };
          updatePeersState();
        }
      });

      const lobbyRef = ref(db, 'voice_lobby');
      onValue(lobbyRef, (snap) => {
        const lobby = snap.val() || {};
        
        const now = Date.now();
        // Remove peers that have left the lobby or haven't heartbeat
        let changed = false;
        Object.keys(peersRef.current).forEach(uid => {
          const info = lobby[uid];
          if (!info || (now - (info.lastSeen || info.joinedAt || now) > 35000)) {
            try { peersRef.current[uid].peer.destroy(); } catch (_) {}
            delete peersRef.current[uid];
            if (vadCleanups.current[uid]) { vadCleanups.current[uid](); delete vadCleanups.current[uid]; }
            changed = true;
          }
        });

        // Add new peers
        Object.entries(lobby).forEach(([uid, info]) => {
          if (uid !== user.uid && !peersRef.current[uid] && (now - (info.lastSeen || info.joinedAt || now) <= 35000)) {
            const peer = createPeer(uid, info);
            if (peer) {
              peersRef.current[uid] = { peer, name: info.name, photoURL: info.photoURL };
              changed = true;
            }
          }
        });

        if (changed) updatePeersState();
      });
    } catch (err) {
      alert('Microphone access denied.');
    }
  };

  const toggleMute = () => {
    if (streamRef.current) {
      const t = streamRef.current.getAudioTracks()[0];
      if (t) { t.enabled = !t.enabled; setIsMuted(!t.enabled); }
    }
  };

  const toggleVideo = () => {
    if (streamRef.current) {
      const t = streamRef.current.getVideoTracks()[0];
      if (t) { t.enabled = !t.enabled; setIsVideoOn(t.enabled); }
    }
  };

  const toggleDeafen = () => setIsDeafened(!isDeafened);

  return (
    <div style={{
      padding: 20, display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: 20, height: '100%',
    }}>
      <style>{VOICE_CSS}</style>
      {!inRoom ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>{Icons.mic('#64748b', 48)}</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8, color: '#e2e8f0' }}>
            Join the Live War Room
          </div>
          <div style={{
            fontSize: 13, color: '#94a3b8', marginBottom: 28,
            maxWidth: 260, lineHeight: 1.6, margin: '0 auto 28px',
          }}>
            Jump in to talk with anyone else in the room. Audio connects instantly with trickle ICE.
          </div>
          <button onClick={joinRoom} style={{
            padding: '14px 32px', background: 'linear-gradient(135deg, #22c55e, #16a34a)',
            color: '#fff', border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 800,
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 10,
            boxShadow: '0 8px 24px rgba(34,197,94,0.3)', transition: 'all 0.15s',
            letterSpacing: '0.03em',
          }}>
            {Icons.mic('#fff', 18)} CONNECT NOW
          </button>
        </div>
      ) : (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'center', width: '100%',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <VRAvatar name={user.name} photo={user.photoURL} size={64} speaking={false} stream={stream} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#cbd5e1' }}>You</span>
              {isMuted && <span style={{ fontSize: 9, color: '#ef4444', fontWeight: 600 }}>MUTED</span>}
            </div>
            {peers.map(p => (
              <div key={p.uid} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <VRAvatar name={p.name} photo={p.photoURL} size={64} speaking={speakingUsers.has(p.uid)} stream={p.stream} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#cbd5e1' }}>{p.name?.split(' ')[0]}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={toggleMute} style={{
              width: 54, height: 54, borderRadius: '50%',
              background: isMuted ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${isMuted ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.12)'}`,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s',
            }}>
              {isMuted ? Icons.micOff('#ef4444', 22) : Icons.mic('#e2e8f0', 22)}
            </button>
            <button onClick={toggleVideo} style={{
              width: 54, height: 54, borderRadius: '50%',
              background: isVideoOn ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${isVideoOn ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.12)'}`,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s',
            }}>
              {isVideoOn ? Icons.video('#3b82f6', 22) : Icons.videoOff('#94a3b8', 22)}
            </button>
            <button onClick={leaveRoom} style={{
              padding: '0 24px', height: 54, background: '#ef4444', color: '#fff',
              border: 'none', borderRadius: 27, fontSize: 14, fontWeight: 800,
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', boxShadow: '0 4px 14px rgba(239,68,68,0.4)',
              gap: 8, letterSpacing: '0.03em',
            }}>
              {Icons.phoneOff('#fff', 18)} LEAVE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// ── CALL OVERLAY (1-on-1 Calls - Floating + Draggable) ──

export function CallOverlay({ user, db }) {
  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [remoteSpeaking, setRemoteSpeaking] = useState(false);
  const [callStatus, setCallStatus] = useState('');

  // Drag state
  const [dragPos, setDragPos] = useState({ x: 16, y: 80 });
  const isDragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const peerRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const timeoutRef = useRef(null);
  const ringIntervalRef = useRef(null);
  const vadCleanupRef = useRef(null);
  const activeCallRef = useRef(null);
  const handledCallIds = useRef(new Set());

  // ── Dragging handlers ──
  const onDragStart = useCallback((e) => {
    isDragging.current = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    dragOffset.current = { x: clientX - dragPos.x, y: clientY - dragPos.y };
    e.preventDefault();
  }, [dragPos]);

  useEffect(() => {
    const onMove = (e) => {
      if (!isDragging.current) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      setDragPos({
        x: Math.max(0, Math.min(window.innerWidth - 180, clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 100, clientY - dragOffset.current.y)),
      });
    };
    const onUp = () => { isDragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, []);

  // ── Cleanup ──
  const fullCleanup = useCallback(() => {
    if (peerRef.current) { try { peerRef.current.destroy(); } catch (_) {} peerRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (ringIntervalRef.current) { clearInterval(ringIntervalRef.current); ringIntervalRef.current = null; }
    if (vadCleanupRef.current) { vadCleanupRef.current(); vadCleanupRef.current = null; }
    stopRing();
  }, []);

  // ── End call ──
  const endCall = useCallback(() => {
    const callId = activeCallRef.current?.id;
    fullCleanup();
    if (callId) {
      remove(ref(db, `calls/${callId}`)).catch(() => {});
      remove(ref(db, `call_signals/${callId}`)).catch(() => {});
      handledCallIds.current.add(callId);
    }
    setActiveCall(null);
    activeCallRef.current = null;
    setIncomingCall(null);
    setRemoteStream(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsVideoOn(false);
    setMinimized(false);
    setRemoteSpeaking(false);
    setCallStatus('');
  }, [db, fullCleanup]);

  // ── Setup WebRTC peer ──
  const setupPeer = useCallback((callId, isInitiator, mediaStream) => {
    if (peerRef.current) { try { peerRef.current.destroy(); } catch (_) {} }
    const peer = new Peer({
      initiator: isInitiator, trickle: true, stream: mediaStream,
      config: { iceServers: ICE_SERVERS },
    });
    peer.on('signal', signal => {
      push(ref(db, `call_signals/${callId}`), { from: user.uid, signal });
    });
    peer.on('stream', rs => {
      setRemoteStream(rs);
      vadCleanupRef.current = createVAD(rs, setRemoteSpeaking);
    });
    peer.on('connect', () => {
      setCallStatus('active');
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      if (!timerRef.current) {
        timerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
      }
    });
    peer.on('close', () => endCall());
    peer.on('error', () => {});
    peerRef.current = peer;
    onChildAdded(ref(db, `call_signals/${callId}`), snap => {
      const d = snap.val();
      if (d && d.from !== user.uid && peerRef.current) {
        try { peerRef.current.signal(d.signal); } catch (_) {}
      }
    });
    return peer;
  }, [db, user, endCall]);

  // ── Single Firebase listener ──
  useEffect(() => {
    if (!user) return;
    const callsRef = ref(db, 'calls');
    const handler = onValue(callsRef, async (snap) => {
      const data = snap.val();
      if (!data) return;

      if (activeCallRef.current) {
        const myCall = data[activeCallRef.current.id];
        if (!myCall || myCall.status === 'ended' || myCall.status === 'declined' || myCall.status === 'missed') {
          endCall();
        } else if (myCall.status === 'active' && callStatus === 'calling') {
          setCallStatus('active');
        }
        return;
      }

      if (incomingCall) return;
      const now = Date.now();

      // Incoming
      const incoming = Object.entries(data).find(([id, c]) =>
        c.receiver === user.uid && c.status === 'ringing' &&
        !handledCallIds.current.has(id) && (now - (c.startedAt || 0)) < 60000
      );
      if (incoming) {
        const [callId, callData] = incoming;
        setIncomingCall({ id: callId, ...callData });
        if (!ringIntervalRef.current) {
          playRing();
          ringIntervalRef.current = setInterval(playRing, 2000);
        }
        return;
      }

      // Outgoing
      const outgoing = Object.entries(data).find(([id, c]) =>
        c.caller === user.uid && c.status === 'ringing' &&
        !handledCallIds.current.has(id) && !activeCallRef.current &&
        (now - (c.startedAt || 0)) < 60000
      );
      if (outgoing) {
        const [callId, callData] = outgoing;
        handledCallIds.current.add(callId);
        try {
          const mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: true, video: callData.type === 'video',
          });
          streamRef.current = mediaStream;
          setIsVideoOn(callData.type === 'video');
          const call = { id: callId, ...callData, direction: 'outgoing' };
          setActiveCall(call);
          activeCallRef.current = call;
          setCallStatus('calling');
          setupPeer(callId, true, mediaStream);
          timeoutRef.current = setTimeout(() => {
            if (activeCallRef.current?.id === callId) {
              update(ref(db, `calls/${callId}`), { status: 'missed' }).catch(() => {});
              endCall();
            }
          }, 30000);
        } catch (err) {
          remove(ref(db, `calls/${callId}`)).catch(() => {});
          alert('Could not access microphone/camera.');
        }
      }
    });
    return () => off(callsRef);
  }, [db, user, endCall, setupPeer, incomingCall, callStatus]);

  // ── Accept call ──
  const acceptCall = useCallback(async () => {
    if (!incomingCall) return;
    clearInterval(ringIntervalRef.current);
    ringIntervalRef.current = null;
    stopRing();
    const callId = incomingCall.id;
    handledCallIds.current.add(callId);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true, video: incomingCall.type === 'video',
      });
      streamRef.current = mediaStream;
      setIsVideoOn(incomingCall.type === 'video');
      await update(ref(db, `calls/${callId}`), { status: 'active' });
      const call = { ...incomingCall, direction: 'incoming' };
      setActiveCall(call);
      activeCallRef.current = call;
      setIncomingCall(null);
      setCallStatus('connecting');
      setupPeer(callId, false, mediaStream);
      if (!timerRef.current) {
        timerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
      }
    } catch (err) {
      alert('Could not access microphone/camera.');
      endCall();
    }
  }, [incomingCall, db, setupPeer, endCall]);

  // ── Decline call ──
  const declineCall = useCallback(() => {
    if (!incomingCall) return;
    clearInterval(ringIntervalRef.current);
    ringIntervalRef.current = null;
    stopRing();
    handledCallIds.current.add(incomingCall.id);
    remove(ref(db, `calls/${incomingCall.id}`)).catch(() => {});
    setIncomingCall(null);
  }, [incomingCall, db]);

  // ── Auto-timeout incoming ──
  useEffect(() => {
    if (!incomingCall) return;
    const timer = setTimeout(() => {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
      stopRing();
      handledCallIds.current.add(incomingCall.id);
      update(ref(db, `calls/${incomingCall.id}`), { status: 'missed' }).catch(() => {});
      setIncomingCall(null);
    }, 30000);
    return () => clearTimeout(timer);
  }, [incomingCall, db]);

  // ── Toggle mute ──
  const toggleMute = () => {
    if (streamRef.current) {
      const t = streamRef.current.getAudioTracks()[0];
      if (t) { t.enabled = !t.enabled; setIsMuted(!t.enabled); }
    }
  };

  // ── Toggle camera ──
  const toggleCamera = async () => {
    if (!streamRef.current) return;
    const vt = streamRef.current.getVideoTracks()[0];
    if (vt) { vt.enabled = !vt.enabled; setIsVideoOn(vt.enabled); }
  };

  // ── RENDER ──
  if (!user || (!incomingCall && !activeCall)) return <style>{VOICE_CSS}</style>;

  const otherName = activeCall
    ? (activeCall.direction === 'outgoing' ? activeCall.receiverName : activeCall.callerName)
    : incomingCall?.callerName;
  const otherPhoto = activeCall
    ? (activeCall.direction === 'outgoing' ? activeCall.receiverPhoto : activeCall.callerPhoto)
    : incomingCall?.callerPhoto;

  // ── Button helper ──
  const CallBtn = ({ onClick, bg, border, children, title, size = 44 }) => (
    <button onClick={onClick} title={title} style={{
      width: size, height: size, borderRadius: '50%', background: bg,
      border: border || 'none', color: '#fff', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.15s', flexShrink: 0,
    }}>
      {children}
    </button>
  );

  return (
    <>
      <style>{VOICE_CSS}</style>

      {/* INCOMING CALL */}
      {incomingCall && !activeCall && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: 24,
          background: 'radial-gradient(ellipse at center, rgba(15,20,30,0.98), rgba(7,9,13,0.99))',
          animation: 'vcSlideUp 0.3s ease-out',
        }}>
          {/* Pulse rings */}
          <div style={{ position: 'relative', marginBottom: 24 }}>
            <div style={{
              position: 'absolute', inset: -20, borderRadius: '50%',
              border: '2px solid rgba(34,197,94,0.3)',
              animation: 'vcPulseRing 2s ease-out infinite',
            }} />
            <div style={{
              position: 'absolute', inset: -20, borderRadius: '50%',
              border: '2px solid rgba(34,197,94,0.2)',
              animation: 'vcPulseRing 2s ease-out infinite 0.5s',
            }} />
            <VRAvatar name={incomingCall.callerName} photo={incomingCall.callerPhoto} size={100} />
          </div>

          <div style={{
            fontSize: 11, fontWeight: 700, color: '#64748b',
            letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 8,
            fontFamily: "'JetBrains Mono',monospace",
          }}>
            INCOMING {incomingCall.type === 'video' ? 'VIDEO' : 'VOICE'} CALL
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#f1f5f9', marginBottom: 40 }}>
            {incomingCall.callerName}
          </div>

          <div style={{ display: 'flex', gap: 60 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <CallBtn onClick={declineCall} bg="#ef4444" size={64}>
                {Icons.phoneOff('#fff', 26)}
              </CallBtn>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#ef4444' }}>Decline</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <CallBtn onClick={acceptCall} bg="#22c55e" size={64}>
                {Icons.phone('#fff', 26)}
              </CallBtn>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>Accept</span>
            </div>
          </div>
        </div>
      )}

      {/* ACTIVE CALL - DRAGGABLE OVERLAY */}
      {activeCall && (
        <div style={{
          position: 'fixed',
          left: minimized ? undefined : dragPos.x,
          top: minimized ? undefined : dragPos.y,
          right: minimized ? 16 : undefined,
          bottom: minimized ? 76 : undefined,
          zIndex: 9000,
          width: minimized ? 180 : 320,
          background: minimized
            ? 'rgba(17,19,24,0.95)'
            : 'linear-gradient(180deg, rgba(17,19,24,0.98), rgba(10,12,18,0.99))',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: minimized ? 28 : 20,
          padding: minimized ? '10px 14px' : 0,
          boxShadow: '0 12px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05)',
          backdropFilter: 'blur(20px)',
          transition: isDragging.current ? 'none' : 'all 0.3s cubic-bezier(0.22,1,0.36,1)',
          cursor: minimized ? 'pointer' : 'default',
          userSelect: 'none',
          overflow: 'hidden',
        }}>
          {minimized ? (
            <div onClick={() => setMinimized(false)} style={{
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', background: '#22c55e',
                animation: 'vcPulse 2s ease-in-out infinite', flexShrink: 0,
              }} />
              <span style={{
                fontSize: 13, fontWeight: 700, color: '#e2e8f0',
                fontFamily: "'JetBrains Mono',monospace", letterSpacing: '0.05em',
              }}>
                {fmtDuration(callDuration)}
              </span>
              <div style={{ marginLeft: 'auto' }}>
                <VRAvatar name={otherName || ''} photo={otherPhoto} size={28} speaking={remoteSpeaking} />
              </div>
            </div>
          ) : (
            <>
              {/* Drag handle */}
              <div
                onMouseDown={onDragStart}
                onTouchStart={onDragStart}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  cursor: 'grab',
                  background: 'rgba(255,255,255,0.02)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {Icons.drag()}
                  <span style={{
                    fontSize: 11, fontWeight: 700,
                    color: callStatus === 'active' ? '#22c55e' : '#f59e0b',
                    letterSpacing: '0.1em',
                    fontFamily: "'JetBrains Mono',monospace",
                  }}>
                    {callStatus === 'calling' ? 'CALLING...' : callStatus === 'connecting' ? 'CONNECTING...' : fmtDuration(callDuration)}
                  </span>
                </div>
                <button onClick={() => setMinimized(true)} style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                  display: 'flex', alignItems: 'center',
                }}>
                  {Icons.minimize()}
                </button>
              </div>

              {/* Avatar area */}
              <div style={{
                padding: '20px 16px 12px', display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 10,
              }}>
                <div style={{ position: 'relative' }}>
                  <VRAvatar name={otherName || ''} photo={otherPhoto} size={72} speaking={remoteSpeaking} />
                  {remoteSpeaking && (
                    <div style={{
                      position: 'absolute', inset: -4, borderRadius: '50%',
                      border: '2px solid rgba(34,197,94,0.4)',
                      animation: 'vcPulse 1.5s ease-in-out infinite',
                    }} />
                  )}
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>{otherName}</span>
                {remoteStream && (
                  <audio ref={el => { if (el && el.srcObject !== remoteStream) { el.srcObject = remoteStream; el.play().catch(() => {}); } }} autoPlay playsInline style={{ display: 'none' }} />
                )}
              </div>

              {/* Controls */}
              <div style={{
                display: 'flex', justifyContent: 'center', gap: 14,
                padding: '8px 16px 16px',
              }}>
                <CallBtn
                  onClick={toggleMute}
                  bg={isMuted ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)'}
                  border={`1px solid ${isMuted ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.1)'}`}
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? Icons.micOff('#ef4444', 20) : Icons.mic('#e2e8f0', 20)}
                </CallBtn>
                <CallBtn
                  onClick={toggleCamera}
                  bg={isVideoOn ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.06)'}
                  border={`1px solid ${isVideoOn ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.1)'}`}
                  title={isVideoOn ? 'Camera Off' : 'Camera On'}
                >
                  {isVideoOn ? Icons.video('#3b82f6', 20) : Icons.videoOff('#94a3b8', 20)}
                </CallBtn>
                <CallBtn onClick={endCall} bg="#ef4444" title="End Call">
                  {Icons.phoneOff('#fff', 20)}
                </CallBtn>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
