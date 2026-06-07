import React, { useState, useEffect, useRef } from 'react';
import { ref, onValue, set, push, onChildAdded, remove, off } from 'firebase/database';
import Peer from 'simple-peer';

export default function VoiceRoom({ user, db }) {
  const [inRoom, setInRoom] = useState(false);
  const [peers, setPeers] = useState([]);
  const [stream, setStream] = useState(null);
  
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  
  const peersRef = useRef({}); // map of uid -> peer object
  const streamRef = useRef(null);
  const audioRefs = useRef({});

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (inRoom) leaveRoom();
    };
  }, [inRoom]);

  const toggleMute = () => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleDeafen = () => {
    setIsDeafened(prev => !prev);
  };

  const joinRoom = async () => {
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setStream(localStream);
      streamRef.current = localStream;
      setInRoom(true);

      // Add self to lobby
      const myRef = ref(db, `voice_lobby/${user.uid}`);
      await set(myRef, {
        name: user.name,
        photoURL: user.photoURL,
        joinedAt: Date.now()
      });

      // Listen for signals sent TO me
      const signalsRef = ref(db, `voice_signals/${user.uid}`);
      onChildAdded(signalsRef, (snap) => {
        const data = snap.val();
        const signalId = snap.key;
        if (data.type === 'offer') {
          // Received an offer from someone else
          const peer = addPeer(data.signal, data.from, false);
          peersRef.current[data.from] = { peer, name: data.fromName, photoURL: data.fromPhoto };
          updatePeersState();
        } else if (data.type === 'answer') {
          // Received an answer to my offer
          const peerObj = peersRef.current[data.from];
          if (peerObj && peerObj.peer) {
            peerObj.peer.signal(data.signal);
          }
        }
        // Remove signal after processing
        remove(ref(db, `voice_signals/${user.uid}/${signalId}`));
      });

      // Listen to lobby to connect to existing users
      const lobbyRef = ref(db, 'voice_lobby');
      onValue(lobbyRef, (snap) => {
        const currentLobby = snap.val() || {};
        Object.keys(currentLobby).forEach(otherUid => {
          if (otherUid !== user.uid && !peersRef.current[otherUid]) {
            // I joined, and found someone already here. I will initiate.
            // Actually, to avoid both initiating, we enforce: higher UID initiates.
            if (user.uid > otherUid) {
              const peer = createPeer(otherUid, currentLobby[otherUid]);
              peersRef.current[otherUid] = { peer, name: currentLobby[otherUid].name, photoURL: currentLobby[otherUid].photoURL };
              updatePeersState();
            }
          }
        });
      });

      // Disconnect on refresh
      window.addEventListener('beforeunload', leaveRoom);
    } catch (err) {
      console.error(err);
      alert("Could not access microphone.");
    }
  };

  const leaveRoom = () => {
    setInRoom(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    setStream(null);
    streamRef.current = null;

    Object.values(peersRef.current).forEach(p => p.peer.destroy());
    peersRef.current = {};
    updatePeersState();

    remove(ref(db, `voice_lobby/${user.uid}`));
    off(ref(db, `voice_signals/${user.uid}`));
    off(ref(db, 'voice_lobby'));
    window.removeEventListener('beforeunload', leaveRoom);
  };

  const createPeer = (userToSignal, otherUserInfo) => {
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream: streamRef.current,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
        ]
      }
    });

    peer.on('signal', signal => {
      push(ref(db, `voice_signals/${userToSignal}`), {
        type: 'offer',
        from: user.uid,
        fromName: user.name,
        fromPhoto: user.photoURL,
        signal
      });
    });

    peer.on('stream', remoteStream => {
      if (peersRef.current[userToSignal]) {
        peersRef.current[userToSignal].stream = remoteStream;
        updatePeersState();
      }
    });

    peer.on('close', () => {
      delete peersRef.current[userToSignal];
      updatePeersState();
    });

    return peer;
  };

  const addPeer = (incomingSignal, callerUid, callerInfo) => {
    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream: streamRef.current,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
        ]
      }
    });

    peer.on('signal', signal => {
      push(ref(db, `voice_signals/${callerUid}`), {
        type: 'answer',
        from: user.uid,
        signal
      });
    });

    peer.on('stream', remoteStream => {
      if (peersRef.current[callerUid]) {
        peersRef.current[callerUid].stream = remoteStream;
        updatePeersState();
      }
    });

    peer.signal(incomingSignal);

    peer.on('close', () => {
      delete peersRef.current[callerUid];
      updatePeersState();
    });

    return peer;
  };

  const updatePeersState = () => {
    setPeers(Object.entries(peersRef.current).map(([uid, data]) => ({
      uid,
      name: data.name,
      photoURL: data.photoURL,
      stream: data.stream
    })));
  };

  return (
    <div className="voice-room" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
      <div className="section-hd" style={{ padding: 0 }}>
        <span className="section-title">SQUAD WAR ROOM</span>
      </div>

      <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: '18px', border: '1px solid rgba(255,255,255,0.08)', padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        
        {!inRoom ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎙️</div>
            <div style={{ fontSize: '16px', fontWeight: '700', marginBottom: '8px' }}>Join the Live War Room</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '24px', maxWidth: '240px', lineHeight: '1.5' }}>
              Jump in to start talking with anyone else in the room instantly.
            </div>
            <button 
              onClick={joinRoom}
              style={{ padding: '14px 28px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '14px', fontSize: '15px', fontWeight: '800', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px', boxShadow: '0 8px 24px rgba(34, 197, 94, 0.3)' }}
            >
              <span>CONNECT NOW</span>
            </button>
          </div>
        ) : (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '30px' }}>
              <div className="sb-dot" style={{ background: '#ef4444', boxShadow: '0 0 12px #ef4444' }}></div>
              <span style={{ fontSize: '14px', fontWeight: '800', color: '#ef4444', letterSpacing: '0.05em' }}>LIVE TRANSMISSION</span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'center', width: '100%', marginBottom: '30px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <img src={user.photoURL} style={{ width: '64px', height: '64px', borderRadius: '50%', border: '2px solid #22c55e', objectFit: 'cover' }} />
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#cbd5e1' }}>You</span>
              </div>
              
              {peers.map(p => (
                <div key={p.uid} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                  <img src={p.photoURL || 'https://via.placeholder.com/64'} style={{ width: '64px', height: '64px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.2)', objectFit: 'cover' }} />
                  <span style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8' }}>{p.name.split(' ')[0]}</span>
                  <audio 
                    ref={el => { 
                      if (el && p.stream && el.srcObject !== p.stream) {
                        el.srcObject = p.stream;
                      } 
                    }} 
                    autoPlay 
                    playsInline
                    muted={isDeafened}
                  />
                </div>
              ))}

              {peers.length === 0 && (
                <div style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic', padding: '20px' }}>Waiting for others to join...</div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '16px', marginTop: '10px' }}>
              <button 
                onClick={toggleMute}
                style={{ padding: '12px', borderRadius: '50%', background: isMuted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.1)', border: '1px solid ' + (isMuted ? '#ef4444' : 'rgba(255, 255, 255, 0.2)'), color: isMuted ? '#ef4444' : '#fff', cursor: 'pointer', fontSize: '20px', width: '54px', height: '54px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
              >
                {isMuted ? '🔇' : '🎤'}
              </button>

              <button 
                onClick={toggleDeafen}
                style={{ padding: '12px', borderRadius: '50%', background: isDeafened ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.1)', border: '1px solid ' + (isDeafened ? '#ef4444' : 'rgba(255, 255, 255, 0.2)'), color: isDeafened ? '#ef4444' : '#fff', cursor: 'pointer', fontSize: '20px', width: '54px', height: '54px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
              >
                {isDeafened ? '🔕' : '🔊'}
              </button>

              <button 
                onClick={leaveRoom}
                style={{ padding: '0 24px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '27px', fontSize: '14px', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(239, 68, 68, 0.4)', transition: 'all 0.2s' }}
              >
                END
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
