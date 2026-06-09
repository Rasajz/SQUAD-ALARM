import { useState, useEffect, useRef, useCallback } from 'react';
import { ref, onValue, set, push, onChildAdded, remove, off, onDisconnect, update } from 'firebase/database';
import Peer from 'simple-peer';

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   ICE SERVERS CONFIG
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   RINGING SOUND (soft phone ring via Web Audio)
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
let ringCtx = null;
let ringNodes = [];

function playRing() {
  try {
    if (!ringCtx || ringCtx.state === 'closed') {
      ringCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ringCtx.state === 'suspended') ringCtx.resume();

    const now = ringCtx.currentTime;
    const osc1 = ringCtx.createOscillator();
    const osc2 = ringCtx.createOscillator();
    const gain = ringCtx.createGain();

    osc1.type = 'sine'; osc1.frequency.value = 440;
    osc2.type = 'sine'; osc2.frequency.value = 480;

    osc1.connect(gain); osc2.connect(gain);
    gain.connect(ringCtx.destination);

    // Two short rings
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
    gain.gain.setValueAtTime(0.2, now + 0.35);
    gain.gain.linearRampToValueAtTime(0, now + 0.5);
    gain.gain.setValueAtTime(0, now + 0.7);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.75);
    gain.gain.setValueAtTime(0.2, now + 1.05);
    gain.gain.linearRampToValueAtTime(0, now + 1.2);

    osc1.start(now); osc1.stop(now + 1.3);
    osc2.start(now); osc2.stop(now + 1.3);

    ringNodes = [osc1, osc2, gain];
  } catch (_) {}
}

function stopRing() {
  ringNodes.forEach(n => { try { n.disconnect(); } catch (_) {} });
  ringNodes = [];
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   VOICE ACTIVITY DETECTION
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
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

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   CSS ANIMATIONS
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
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
`;

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   AVATAR (local to VoiceRoom)
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const COLORS = ["#e53935","#8e24aa","#1565c0","#00838f","#2e7d32","#e65100","#6a1b9a","#ad1457"];
function VRAvatar({ name, photo, size = 64, speaking }) {
  const n = name || '?';
  const col = COLORS[n.toUpperCase().charCodeAt(0) % COLORS.length];
  const ini = n.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const borderStyle = speaking
    ? '3px solid #22c55e'
    : '2px solid rgba(255,255,255,0.15)';
  const anim = speaking ? 'vcSpeakGlow 1s ease-in-out infinite' : 'none';

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

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   VOICE ROOM (Group War Room)
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
export default function VoiceRoom({ user, db }) {
  const [inRoom, setInRoom] = useState(false);
  const [peers, setPeers] = useState([]);
  const [stream, setStream] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [speakingUsers, setSpeakingUsers] = useState(new Set());

  const peersRef = useRef({});
  const streamRef = useRef(null);
  const vadCleanups = useRef({});

  const updatePeersState = useCallback(() => {
    setPeers(Object.entries(peersRef.current).map(([uid, data]) => ({
      uid, name: data.name, photoURL: data.photoURL, stream: data.stream,
    })));
  }, []);

  const leaveRoom = useCallback(() => {
    setInRoom(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    setStream(null);
    streamRef.current = null;

    Object.values(peersRef.current).forEach(p => {
      try { p.peer.destroy(); } catch (_) {}
    });
    peersRef.current = {};
    updatePeersState();

    // Cleanup VAD
    Object.values(vadCleanups.current).forEach(fn => fn());
    vadCleanups.current = {};
    setSpeakingUsers(new Set());

    remove(ref(db, `voice_lobby/${user.uid}`));
    off(ref(db, `voice_signals/${user.uid}`));
    off(ref(db, 'voice_lobby'));
    window.removeEventListener('beforeunload', leaveRoom);
  }, [db, user.uid, updatePeersState]);

  useEffect(() => {
    return () => { if (streamRef.current) leaveRoom(); };
  }, [leaveRoom]);

  const toggleMute = () => {
    if (streamRef.current) {
      const t = streamRef.current.getAudioTracks()[0];
      if (t) { t.enabled = !t.enabled; setIsMuted(!t.enabled); }
    }
  };

  const toggleDeafen = () => setIsDeafened(prev => !prev);

  const createPeer = useCallback((targetUid, userInfo) => {
    const peer = new Peer({
      initiator: true, trickle: true, stream: streamRef.current,
      config: { iceServers: ICE_SERVERS },
    });

    peer.on('signal', signal => {
      push(ref(db, `voice_signals/${targetUid}`), {
        from: user.uid, fromName: user.name, fromPhoto: user.photoURL, signal,
      });
    });

    peer.on('stream', remoteStream => {
      if (peersRef.current[targetUid]) {
        peersRef.current[targetUid].stream = remoteStream;
        updatePeersState();
        // Start VAD for this peer
        vadCleanups.current[targetUid] = createVAD(remoteStream, (speaking) => {
          setSpeakingUsers(prev => {
            const next = new Set(prev);
            speaking ? next.add(targetUid) : next.delete(targetUid);
            return next;
          });
        });
      }
    });

    peer.on('close', () => {
      if (vadCleanups.current[targetUid]) { vadCleanups.current[targetUid](); delete vadCleanups.current[targetUid]; }
      delete peersRef.current[targetUid];
      updatePeersState();
    });

    peer.on('error', (err) => {
      console.warn('Peer error:', err);
      if (vadCleanups.current[targetUid]) { vadCleanups.current[targetUid](); delete vadCleanups.current[targetUid]; }
      delete peersRef.current[targetUid];
      updatePeersState();
    });

    return peer;
  }, [db, user, updatePeersState]);

  const addPeer = useCallback((incomingSignal, callerUid) => {
    const peer = new Peer({
      initiator: false, trickle: true, stream: streamRef.current,
      config: { iceServers: ICE_SERVERS },
    });

    peer.on('signal', signal => {
      push(ref(db, `voice_signals/${callerUid}`), { from: user.uid, signal });
    });

    peer.on('stream', remoteStream => {
      if (peersRef.current[callerUid]) {
        peersRef.current[callerUid].stream = remoteStream;
        updatePeersState();
        vadCleanups.current[callerUid] = createVAD(remoteStream, (speaking) => {
          setSpeakingUsers(prev => {
            const next = new Set(prev);
            speaking ? next.add(callerUid) : next.delete(callerUid);
            return next;
          });
        });
      }
    });

    peer.signal(incomingSignal);

    peer.on('close', () => {
      if (vadCleanups.current[callerUid]) { vadCleanups.current[callerUid](); delete vadCleanups.current[callerUid]; }
      delete peersRef.current[callerUid];
      updatePeersState();
    });

    peer.on('error', () => {
      if (vadCleanups.current[callerUid]) { vadCleanups.current[callerUid](); delete vadCleanups.current[callerUid]; }
      delete peersRef.current[callerUid];
      updatePeersState();
    });

    return peer;
  }, [db, user.uid, updatePeersState]);

  const joinRoom = async () => {
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setStream(localStream);
      streamRef.current = localStream;
      setInRoom(true);

      const myRef = ref(db, `voice_lobby/${user.uid}`);
      await set(myRef, { name: user.name, photoURL: user.photoURL, joinedAt: Date.now() });
      onDisconnect(myRef).remove();

      // Listen for signals
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
        remove(ref(db, `voice_signals/${user.uid}/${snap.key}`));
      });

      // Listen to lobby
      const lobbyRef = ref(db, 'voice_lobby');
      onValue(lobbyRef, (snap) => {
        const currentLobby = snap.val() || {};
        const currentKeys = new Set(Object.keys(currentLobby));
        Object.keys(peersRef.current).forEach(uid => {
          if (!currentKeys.has(uid)) {
            try { peersRef.current[uid].peer.destroy(); } catch (_) {}
            if (vadCleanups.current[uid]) { vadCleanups.current[uid](); delete vadCleanups.current[uid]; }
            delete peersRef.current[uid];
          }
        });
        Object.keys(currentLobby).forEach(otherUid => {
          if (otherUid !== user.uid && !peersRef.current[otherUid]) {
            if (user.uid > otherUid) {
              const peer = createPeer(otherUid, currentLobby[otherUid]);
              peersRef.current[otherUid] = { peer, name: currentLobby[otherUid].name, photoURL: currentLobby[otherUid].photoURL };
            }
          }
        });
        updatePeersState();
      });

      window.addEventListener('beforeunload', leaveRoom);
    } catch (err) {
      console.error(err);
      alert('Could not access microphone.');
    }
  };

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      <style>{VOICE_CSS}</style>
      <div style={{ padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#334155',
          letterSpacing: '.12em', textTransform: 'uppercase',
        }}>
          SQUAD WAR ROOM
        </span>
        {inRoom && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%', background: '#ef4444',
              boxShadow: '0 0 8px #ef4444',
            }} />
            <span style={{
              fontSize: 12, fontWeight: 800, color: '#ef4444', letterSpacing: '0.04em',
            }}>
              LIVE
            </span>
          </div>
        )}
      </div>

      <div style={{
        flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: 18,
        border: '1px solid rgba(255,255,255,0.08)', padding: 20,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        {!inRoom ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>ðŸŽ™ï¸</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: '#e2e8f0' }}>
              Join the Live War Room
            </div>
            <div style={{
              fontSize: 12, color: '#94a3b8', marginBottom: 24,
              maxWidth: 240, lineHeight: 1.5, margin: '0 auto 24px',
            }}>
              Jump in to talk with anyone else in the room. Audio connects instantly with trickle ICE.
            </div>
            <button onClick={joinRoom} style={{
              padding: '14px 28px', background: '#22c55e', color: '#fff',
              border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 800,
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
              boxShadow: '0 8px 24px rgba(34,197,94,0.3)', transition: 'all 0.15s',
            }}>
              CONNECT NOW
            </button>
          </div>
        ) : (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {/* Connected users */}
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'center',
              width: '100%', marginBottom: 30,
            }}>
              {/* Self */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <VRAvatar name={user.name} photo={user.photoURL} size={64} speaking={false} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#cbd5e1' }}>You</span>
                {isMuted && (
                  <span style={{ fontSize: 9, color: '#ef4444', fontWeight: 600 }}>MUTED</span>
                )}
              </div>

              {peers.map(p => (
                <div key={p.uid} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <VRAvatar
                    name={p.name} photo={p.photoURL} size={64}
                    speaking={speakingUsers.has(p.uid)}
                  />
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>
                    {(p.name || 'Unknown').split(' ')[0]}
                  </span>
                  <audio
                    ref={el => {
                      if (el && p.stream && el.srcObject !== p.stream) {
                        el.srcObject = p.stream;
                        try { el.play().catch(() => {}); } catch (_) {}
                      }
                    }}
                    autoPlay playsInline muted={isDeafened}
                  />
                </div>
              ))}

              {peers.length === 0 && (
                <div style={{
                  fontSize: 12, color: '#64748b', fontStyle: 'italic', padding: 20,
                }}>
                  Waiting for others to join...
                </div>
              )}
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', gap: 14 }}>
              <button onClick={toggleMute} style={{
                width: 54, height: 54, borderRadius: '50%',
                background: isMuted ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${isMuted ? '#ef4444' : 'rgba(255,255,255,0.15)'}`,
                color: isMuted ? '#ef4444' : '#fff', cursor: 'pointer', fontSize: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
              }}>
                {isMuted ? 'ðŸ”‡' : 'ðŸŽ¤'}
              </button>
              <button onClick={toggleDeafen} style={{
                width: 54, height: 54, borderRadius: '50%',
                background: isDeafened ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${isDeafened ? '#ef4444' : 'rgba(255,255,255,0.15)'}`,
                color: isDeafened ? '#ef4444' : '#fff', cursor: 'pointer', fontSize: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
              }}>
                {isDeafened ? 'ðŸ”•' : 'ðŸ”Š'}
              </button>
              <button onClick={leaveRoom} style={{
                padding: '0 24px', height: 54, background: '#ef4444', color: '#fff',
                border: 'none', borderRadius: 27, fontSize: 14, fontWeight: 800,
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', boxShadow: '0 4px 14px rgba(239,68,68,0.4)',
                transition: 'all 0.15s',
              }}>
                END
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   CALL OVERLAY (1-on-1 Calls â€” Floating)
   Mounted at App level, always listens for calls
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
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

  const peerRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const timeoutRef = useRef(null);
  const ringIntervalRef = useRef(null);
  const vadCleanupRef = useRef(null);
  const activeCallRef = useRef(null);
  const handledCallIds = useRef(new Set());

  /* â”€â”€ Cleanup everything â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const fullCleanup = useCallback(() => {
    if (peerRef.current) { try { peerRef.current.destroy(); } catch (_) {} peerRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (ringIntervalRef.current) { clearInterval(ringIntervalRef.current); ringIntervalRef.current = null; }
    if (vadCleanupRef.current) { vadCleanupRef.current(); vadCleanupRef.current = null; }
    stopRing();
  }, []);

  /* â”€â”€ End call (removes from Firebase) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const endCall = useCallback(() => {
    const callId = activeCallRef.current?.id;
    fullCleanup();

    // REMOVE from Firebase entirely so listeners don't re-detect
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

  /* â”€â”€ Setup WebRTC peer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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
    peer.on('error', (err) => { console.warn('Peer error:', err); });

    peerRef.current = peer;

    // Listen for signals
    onChildAdded(ref(db, `call_signals/${callId}`), snap => {
      const d = snap.val();
      if (d && d.from !== user.uid && peerRef.current) {
        try { peerRef.current.signal(d.signal); } catch (e) { console.warn('Signal err:', e); }
      }
    });

    return peer;
  }, [db, user, endCall]);

  /* â”€â”€ SINGLE unified Firebase listener â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  useEffect(() => {
    if (!user) return;
    const callsRef = ref(db, 'calls');

    const handler = onValue(callsRef, async (snap) => {
      const data = snap.val();
      if (!data) return;

      // If we have an active call, check if it was ended by the other party
      if (activeCallRef.current) {
        const myCall = data[activeCallRef.current.id];
        if (!myCall || myCall.status === 'ended' || myCall.status === 'declined' || myCall.status === 'missed') {
          endCall();
        } else if (myCall.status === 'active' && callStatus === 'calling') {
          setCallStatus('active');
        }
        return;
      }

      // Skip if we have an incoming call already showing
      if (incomingCall) return;

      const now = Date.now();

      // Check for INCOMING call (someone calling us)
      const incoming = Object.entries(data).find(([id, c]) =>
        c.receiver === user.uid &&
        c.status === 'ringing' &&
        !handledCallIds.current.has(id) &&
        (now - (c.startedAt || 0)) < 60000 // Ignore calls older than 60s
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

      // Check for OUTGOING call (I initiated from DMs)
      const outgoing = Object.entries(data).find(([id, c]) =>
        c.caller === user.uid &&
        c.status === 'ringing' &&
        !handledCallIds.current.has(id) &&
        !activeCallRef.current &&
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

          // 30s timeout
          timeoutRef.current = setTimeout(() => {
            if (activeCallRef.current?.id === callId) {
              update(ref(db, `calls/${callId}`), { status: 'missed' }).catch(() => {});
              endCall();
            }
          }, 30000);
        } catch (err) {
          console.error('Call setup failed:', err);
          remove(ref(db, `calls/${callId}`)).catch(() => {});
          alert('Could not access microphone/camera.');
        }
      }
    });

    return () => off(callsRef);
  }, [db, user, endCall, setupPeer, incomingCall, callStatus]);

  /* â”€â”€ Accept incoming call â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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
      console.error('Accept failed:', err);
      alert('Could not access microphone/camera.');
      endCall();
    }
  }, [incomingCall, db, setupPeer, endCall]);

  /* â”€â”€ Decline incoming call â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const declineCall = useCallback(() => {
    if (!incomingCall) return;
    clearInterval(ringIntervalRef.current);
    ringIntervalRef.current = null;
    stopRing();
    handledCallIds.current.add(incomingCall.id);
    remove(ref(db, `calls/${incomingCall.id}`)).catch(() => {});
    setIncomingCall(null);
  }, [incomingCall, db]);

  /* â”€â”€ Auto-timeout incoming (30s) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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

  /* â”€â”€ Toggle mute â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const toggleMute = () => {
    if (streamRef.current) {
      const t = streamRef.current.getAudioTracks()[0];
      if (t) { t.enabled = !t.enabled; setIsMuted(!t.enabled); }
    }
  };

  /* â”€â”€ Toggle camera â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const toggleCamera = async () => {
    if (!streamRef.current) return;
    const videoTrack = streamRef.current.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsVideoOn(videoTrack.enabled);
    }
  };

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     RENDER
  â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  if (!user || (!incomingCall && !activeCall)) return <style>{VOICE_CSS}</style>;

  const otherName = activeCall
    ? (activeCall.direction === 'outgoing' ? activeCall.receiverName : activeCall.callerName)
    : incomingCall?.callerName;

  const otherPhoto = activeCall
    ? (activeCall.direction === 'outgoing' ? activeCall.receiverPhoto : activeCall.callerPhoto)
    : incomingCall?.callerPhoto;

  return (
    <>
      <style>{VOICE_CSS}</style>

      {/* â”€â”€ INCOMING CALL SCREEN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {incomingCall && !activeCall && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: 24,
          background: 'rgba(7,9,13,0.97)',
          animation: 'vcIncomingBg 2s ease-in-out infinite',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: '#94a3b8',
              letterSpacing: '0.12em', textTransform: 'uppercase',
              fontFamily: "'JetBrains Mono',monospace",
            }}>
              INCOMING {incomingCall.type === 'video' ? 'VIDEO' : 'AUDIO'} CALL
            </div>
            <div style={{ animation: 'vcRingPulse 1.5s ease-in-out infinite' }}>
              <VRAvatar name={incomingCall.callerName} photo={incomingCall.callerPhoto} size={96} />
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#f1f5f9' }}>
              {incomingCall.callerName}
            </div>

            <div style={{ display: 'flex', gap: 40, marginTop: 30 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <button onClick={declineCall} style={{
                  width: 64, height: 64, borderRadius: '50%',
                  background: '#ef4444', border: 'none', color: '#fff',
                  fontSize: 24, cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 20px rgba(239,68,68,0.4)',
                }}>
                  âœ•
                </button>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#ef4444' }}>Decline</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <button onClick={acceptCall} style={{
                  width: 64, height: 64, borderRadius: '50%',
                  background: '#22c55e', border: 'none', color: '#fff',
                  fontSize: 24, cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 20px rgba(34,197,94,0.4)',
                }}>
                  âœ“
                </button>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#22c55e' }}>Accept</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* â”€â”€ ACTIVE CALL FLOATING OVERLAY â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {activeCall && (
        <div style={{
          position: 'fixed',
          bottom: minimized ? 80 : 16,
          right: 16,
          zIndex: 9000,
          width: minimized ? 160 : 300,
          background: 'rgba(17,19,24,0.97)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: minimized ? 24 : 18,
          padding: minimized ? '8px 14px' : 16,
          boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
          backdropFilter: 'blur(12px)',
          transition: 'all 0.3s ease',
        }}>
          {minimized ? (
            <div onClick={() => setMinimized(false)} style={{
              display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', background: '#22c55e',
                animation: 'vcPulse 2s ease-in-out infinite',
              }} />
              <span style={{
                fontSize: 12, fontWeight: 700, color: '#e2e8f0',
                fontFamily: "'JetBrains Mono',monospace",
              }}>
                {fmtDuration(callDuration)}
              </span>
              <VRAvatar name={otherName || ''} photo={otherPhoto} size={24} />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
              }}>
                <span style={{
                  fontSize: 10, fontWeight: 600,
                  color: callStatus === 'active' ? '#22c55e' : '#f59e0b',
                  letterSpacing: '0.1em', fontFamily: "'JetBrains Mono',monospace",
                }}>
                  {callStatus === 'calling' ? 'CALLINGâ€¦' : callStatus === 'connecting' ? 'CONNECTINGâ€¦' : fmtDuration(callDuration)}
                </span>
                <button onClick={() => setMinimized(true)} style={{
                  background: 'none', border: 'none', color: '#64748b', fontSize: 14, cursor: 'pointer',
                }}>â–¼</button>
              </div>

              <div style={{
                width: '100%', aspectRatio: '16/10', borderRadius: 12,
                background: '#0a0c12', display: 'flex', alignItems: 'center',
                justifyContent: 'center', overflow: 'hidden',
              }}>
                <VRAvatar name={otherName || ''} photo={otherPhoto} size={56} speaking={remoteSpeaking} />
                {remoteStream && (
                  <audio ref={el => { if (el && el.srcObject !== remoteStream) { el.srcObject = remoteStream; el.play().catch(() => {}); } }} autoPlay playsInline style={{ display: 'none' }} />
                )}
              </div>

              <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{otherName}</span>

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={toggleMute} style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: isMuted ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.08)',
                  border: `1px solid ${isMuted ? '#ef4444' : 'rgba(255,255,255,0.15)'}`,
                  color: isMuted ? '#ef4444' : '#e2e8f0', fontSize: 16, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isMuted ? 'ðŸ”‡' : 'ðŸŽ¤'}
                </button>
                <button onClick={toggleCamera} style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: isVideoOn ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.08)',
                  border: `1px solid ${isVideoOn ? '#3b82f6' : 'rgba(255,255,255,0.15)'}`,
                  color: isVideoOn ? '#3b82f6' : '#e2e8f0', fontSize: 16, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isVideoOn ? 'ðŸ“¹' : 'ðŸ“·'}
                </button>
                <button onClick={endCall} style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: '#ef4444', border: 'none', color: '#fff',
                  fontSize: 16, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 2px 10px rgba(239,68,68,0.3)',
                }}>
                  âœ•
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

