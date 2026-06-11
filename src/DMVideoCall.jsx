import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ref, onValue, set, remove, push, onChildAdded, off } from 'firebase/database';
import Peer from 'simple-peer';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

const PIP_CSS = `
@keyframes pipSlideIn {
  from { opacity: 0; transform: scale(0.6) translateY(20px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes pipPulse {
  0%, 100% { box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 0 0 0 rgba(59,130,246,0.3); }
  50% { box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 0 0 4px rgba(59,130,246,0.15); }
}
`;

export default function DMVideoCall({ user, db, chatId, otherUser, onEndCall, minimized, onMinimize, onExpand }) {
  const [status, setStatus] = useState('connecting'); // connecting, ringing, active
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [facingMode, setFacingMode] = useState('user');
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [swapped, setSwapped] = useState(false);
  const peerRef = useRef(null);
  const streamRef = useRef(null);
  const durationInterval = useRef(null);

  // Draggable PiP state
  const [pipPos, setPipPos] = useState({ x: window.innerWidth - 140, y: window.innerHeight - 240 });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const cleanup = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch (_) {}
      peerRef.current = null;
    }
    if (durationInterval.current) {
      clearInterval(durationInterval.current);
      durationInterval.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);
    setCallDuration(0);
    remove(ref(db, `dm_calls/${chatId}`)).catch(()=>{});
    remove(ref(db, `dm_signals/${chatId}`)).catch(()=>{});
    if (onEndCall) onEndCall();
  }, [db, chatId, onEndCall]);

  // Call duration timer
  useEffect(() => {
    if (status === 'active' && !durationInterval.current) {
      durationInterval.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    }
    return () => {};
  }, [status]);

  // Initial stream request
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, 
      audio: { echoCancellation: true, noiseSuppression: true } 
    })
      .then(s => {
        setLocalStream(s);
        streamRef.current = s;
        const callRef = ref(db, `dm_calls/${chatId}`);
        onValue(callRef, snap => {
          const data = snap.val();
          if (!data) {
            setStatus('ringing');
            set(callRef, { caller: user.uid, status: 'ringing', ts: Date.now() });
          } else if (data.status === 'ringing' && data.caller !== user.uid) {
            setStatus('active');
            set(callRef, { ...data, status: 'active' });
            startP2P(false);
          } else if (data.status === 'active' && data.caller === user.uid && !peerRef.current) {
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

  const toggleMute = () => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
      setMuted(prev => !prev);
    }
  };

  const toggleVideo = () => {
    if (streamRef.current) {
      streamRef.current.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
      setVideoOff(prev => !prev);
    }
  };

  const switchCamera = async () => {
    if (!streamRef.current) return;
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newMode, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      const oldVideoTrack = streamRef.current.getVideoTracks()[0];
      const newVideoTrack = newStream.getVideoTracks()[0];
      
      streamRef.current.removeTrack(oldVideoTrack);
      streamRef.current.addTrack(newVideoTrack);
      oldVideoTrack.stop();
      
      setLocalStream(new MediaStream(streamRef.current.getTracks()));
      setFacingMode(newMode);
      
      if (peerRef.current) {
        peerRef.current.replaceTrack(oldVideoTrack, newVideoTrack, streamRef.current);
      }
    } catch (err) {
      console.error("Camera switch failed", err);
    }
  };

  const fmtDuration = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // ── Draggable PiP handlers ──
  const onPipPointerDown = (e) => {
    if (e.target.closest('[data-pip-action]')) return; // Don't drag when clicking buttons
    dragging.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPipPointerMove = (e) => {
    if (!dragging.current) return;
    const x = Math.max(0, Math.min(window.innerWidth - 130, e.clientX - dragOffset.current.x));
    const y = Math.max(0, Math.min(window.innerHeight - 180, e.clientY - dragOffset.current.y));
    setPipPos({ x, y });
  };

  const onPipPointerUp = () => {
    dragging.current = false;
  };

  /* ════════════════════════════════════════════════
     RENDER — MINIMIZED PiP
  ════════════════════════════════════════════════ */
  if (minimized) {
    const pipContent = (
      <>
        <style>{PIP_CSS}</style>
        <div
          onPointerDown={onPipPointerDown}
          onPointerMove={onPipPointerMove}
          onPointerUp={onPipPointerUp}
          onClick={() => { if (!dragging.current && onExpand) onExpand(); }}
          style={{
            position: 'fixed',
            left: pipPos.x,
            top: pipPos.y,
            width: 120,
            height: 170,
            borderRadius: 16,
            overflow: 'hidden',
            background: '#0f1520',
            border: '2px solid rgba(59,130,246,0.4)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5), 0 0 0 0 rgba(59,130,246,0.3)',
            zIndex: 9998,
            cursor: 'grab',
            animation: 'pipSlideIn 0.3s ease-out, pipPulse 3s ease-in-out infinite',
            touchAction: 'none',
            userSelect: 'none',
          }}
        >
          {/* Video preview */}
          <div style={{ width: '100%', height: 120, background: '#000', position: 'relative' }}>
            {remoteStream ? (
              <video
                ref={el => { if (el && el.srcObject !== remoteStream) el.srcObject = remoteStream; }}
                autoPlay playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : localStream ? (
              <video
                ref={el => { if (el && el.srcObject !== localStream) el.srcObject = localStream; }}
                autoPlay playsInline muted
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: '100%', fontSize: 28, color: '#475569',
              }}>
                {otherUser?.name?.[0] || '?'}
              </div>
            )}
            {/* Duration badge */}
            {status === 'active' && (
              <div style={{
                position: 'absolute', top: 4, left: 4,
                background: 'rgba(0,0,0,0.6)', borderRadius: 8,
                padding: '2px 6px', fontSize: 9, color: '#22c55e',
                fontFamily: "'JetBrains Mono',monospace", fontWeight: 600,
              }}>
                {fmtDuration(callDuration)}
              </div>
            )}
          </div>

          {/* Bottom bar */}
          <div style={{
            height: 50, display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', padding: '0 8px',
            background: '#0f1520',
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: '#e2e8f0',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: 60,
            }}>
              {otherUser?.name?.split(' ')[0] || 'Call'}
            </div>
            <button
              data-pip-action="end"
              onClick={(e) => { e.stopPropagation(); cleanup(); }}
              style={{
                width: 28, height: 28, borderRadius: '50%',
                background: '#ef4444', border: 'none', color: '#fff',
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 12, flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        </div>
      </>
    );

    // Use portal to render PiP at document body level, so it's always visible
    return createPortal(pipContent, document.body);
  }

  /* ════════════════════════════════════════════════
     RENDER — FULLSCREEN
  ════════════════════════════════════════════════ */
  const fullscreenContent = (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, background: '#07090d',
      display: 'flex', flexDirection: 'column'
    }}>
      {/* Remote/Local Video (Full Screen) */}
      <div style={{ flex: 1, position: 'relative', background: '#000' }}>
        { (swapped ? localStream : remoteStream) ? (
          <>
            {/* Blurred background to fill empty space elegantly on laptops */}
            <video 
              ref={el => { if(el && el.srcObject !== (swapped ? localStream : remoteStream)) el.srcObject = (swapped ? localStream : remoteStream); }}
              autoPlay playsInline muted
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(40px)', opacity: 0.5, transform: 'scale(1.1)' }}
            />
            {/* Main sharp video that doesn't get cut off */}
            <video 
              ref={el => { if(el && el.srcObject !== (swapped ? localStream : remoteStream)) el.srcObject = (swapped ? localStream : remoteStream); }}
              autoPlay playsInline muted={swapped || speakerMuted}
              style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, marginBottom: 16 }}>
              {otherUser?.name?.[0] || '?'}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9' }}>{otherUser?.name}</div>
            <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 8 }}>{status === 'ringing' ? 'Ringing...' : 'Connecting...'}</div>
          </div>
        )}

        {/* Duration overlay */}
        {status === 'active' && (
          <div style={{
            position: 'absolute', top: 32, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: '6px 16px',
            fontSize: 14, color: '#22c55e', fontFamily: "'JetBrains Mono',monospace",
            fontWeight: 600, backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)'
          }}>
            {fmtDuration(callDuration)}
          </div>
        )}

        {/* Local/Remote Video (PiP within fullscreen) */}
        { (swapped ? remoteStream : localStream) && (
          <div 
            onClick={() => setSwapped(!swapped)}
            style={{
              position: 'absolute', top: 32, right: 20, width: 110, height: 160,
              borderRadius: 16, overflow: 'hidden', border: '2px solid rgba(255,255,255,0.3)',
              background: '#1e293b', zIndex: 10, cursor: 'pointer',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)'
            }}
          >
            <video 
              ref={el => { if(el && el.srcObject !== (swapped ? remoteStream : localStream)) el.srcObject = (swapped ? remoteStream : localStream); }}
              autoPlay playsInline muted={!swapped || speakerMuted}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        )}
      </div>

      {/* Controls (Floating Island) */}
      <div style={{
        position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 40,
        display: 'flex', alignItems: 'center', padding: '12px 24px', gap: 16,
        boxShadow: '0 20px 40px rgba(0,0,0,0.5)', width: 'max-content', maxWidth: '95%',
        zIndex: 100
      }}>
        {/* Camera Flip */}
        <button onClick={switchCamera} style={{
          width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.1)',
          border: 'none', color: '#fff', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s', flexShrink: 0
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
        </button>

        {/* Speaker Mute */}
        <button onClick={() => setSpeakerMuted(!speakerMuted)} style={{
          width: 44, height: 44, borderRadius: '50%',
          background: speakerMuted ? '#ef4444' : 'rgba(255,255,255,0.1)',
          border: 'none', color: '#fff', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s', flexShrink: 0
        }}>
          {speakerMuted ? (
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
          ) : (
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
          )}
        </button>

        {/* Mic Mute */}
        <button onClick={toggleMute} style={{
          width: 52, height: 52, borderRadius: '50%',
          background: muted ? '#ef4444' : 'rgba(255,255,255,0.1)',
          border: 'none', color: '#fff', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s', flexShrink: 0
        }}>
          {muted ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .72-.11 1.42-.3 2.07"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
          )}
        </button>

        {/* Video Toggle */}
        <button onClick={toggleVideo} style={{
          width: 52, height: 52, borderRadius: '50%',
          background: videoOff ? '#ef4444' : 'rgba(255,255,255,0.1)',
          border: 'none', color: '#fff', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s', flexShrink: 0
        }}>
          {videoOff ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
          )}
        </button>

        {/* End Call */}
        <button onClick={cleanup} style={{
          width: 60, height: 60, borderRadius: '50%', background: '#ef4444',
          border: 'none', color: '#fff', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(239,68,68,0.4)', marginLeft: 8, flexShrink: 0
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path><line x1="23" y1="1" x2="1" y2="23"></line></svg>
        </button>

        {/* Minimize */}
        {onMinimize && (
          <button onClick={onMinimize} style={{
            width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.1)',
            border: 'none', color: '#fff', cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
            marginLeft: 8, flexShrink: 0
          }} title="Minimize to PiP">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
          </button>
        )}
      </div>
    </div>
  );

  return createPortal(fullscreenContent, document.body);}
