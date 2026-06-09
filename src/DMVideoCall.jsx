import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ref, onValue, set, remove, push, onChildAdded, off } from 'firebase/database';
import Peer from 'simple-peer';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

export default function DMVideoCall({ user, db, chatId, otherUser, onEndCall }) {
  const [status, setStatus] = useState('connecting'); // connecting, ringing, active
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const peerRef = useRef(null);
  const streamRef = useRef(null);

  const cleanup = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch (_) {}
      peerRef.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);
    remove(ref(db, `dm_calls/${chatId}`)).catch(()=>{});
    remove(ref(db, `dm_signals/${chatId}`)).catch(()=>{});
    if (onEndCall) onEndCall();
  }, [db, chatId, onEndCall]);

  // Initial stream request
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(s => {
        setLocalStream(s);
        streamRef.current = s;
        // Check if there is an active call we are joining, or if we are initiating
        const callRef = ref(db, `dm_calls/${chatId}`);
        onValue(callRef, snap => {
          const data = snap.val();
          if (!data) {
            // We initiate
            setStatus('ringing');
            set(callRef, { caller: user.uid, status: 'ringing', ts: Date.now() });
          } else if (data.status === 'ringing' && data.caller !== user.uid) {
            // We are answering
            setStatus('active');
            set(callRef, { ...data, status: 'active' });
            startP2P(false);
          } else if (data.status === 'active' && data.caller === user.uid && !peerRef.current) {
            // They answered, we start P2P as initiator
            setStatus('active');
            startP2P(true);
          }
        });
      })
      .catch(() => {
        alert("Camera/Mic access denied.");
        cleanup();
      });

    return () => {
      off(ref(db, `dm_calls/${chatId}`));
      cleanup();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startP2P = (isInitiator) => {
    if (peerRef.current || !streamRef.current) return;
    const peer = new Peer({
      initiator: isInitiator,
      trickle: true,
      stream: streamRef.current,
      config: { iceServers: ICE_SERVERS }
    });

    peer.on('signal', signal => {
      push(ref(db, `dm_signals/${chatId}`), { from: user.uid, signal });
    });

    peer.on('stream', stream => {
      setRemoteStream(stream);
    });

    peer.on('close', cleanup);
    peer.on('error', cleanup);

    peerRef.current = peer;

    const sigRef = ref(db, `dm_signals/${chatId}`);
    onChildAdded(sigRef, snap => {
      const data = snap.val();
      if (data.from !== user.uid && peerRef.current) {
        try { peerRef.current.signal(data.signal); } catch(e) {}
      }
    });
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 999, background: '#07090d',
      display: 'flex', flexDirection: 'column'
    }}>
      {/* Remote Video (Full Screen) */}
      <div style={{ flex: 1, position: 'relative', background: '#000' }}>
        {remoteStream ? (
          <video 
            ref={el => { if(el && el.srcObject !== remoteStream) el.srcObject = remoteStream; }}
            autoPlay playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, marginBottom: 16 }}>
              {otherUser?.name?.[0] || '?'}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9' }}>{otherUser?.name}</div>
            <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 8 }}>{status === 'ringing' ? 'Ringing...' : 'Connecting...'}</div>
          </div>
        )}

        {/* Local Video (PiP) */}
        {localStream && (
          <div style={{
            position: 'absolute', top: 16, right: 16, width: 100, height: 150,
            borderRadius: 12, overflow: 'hidden', border: '2px solid rgba(255,255,255,0.2)',
            background: '#000', zIndex: 10
          }}>
            <video 
              ref={el => { if(el && el.srcObject !== localStream) el.srcObject = localStream; }}
              autoPlay playsInline muted
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ height: 80, background: '#111827', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
        <button onClick={cleanup} style={{
          width: 56, height: 56, borderRadius: '50%', background: '#ef4444',
          border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path><line x1="23" y1="1" x2="1" y2="23"></line></svg>
        </button>
      </div>
    </div>
  );
}
