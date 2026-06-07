import React, { useState, useEffect, useRef } from 'react';
import { ref, onValue, set, remove, off, push, onChildAdded, update } from 'firebase/database';
import Peer from 'simple-peer';

// Web Audio API Ringtone Generator
let ringAudioCtx = null;
let ringOsc = null;
let ringLfo = null;
let ringGain = null;

const playRingtone = () => {
  if (!ringAudioCtx) ringAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (ringAudioCtx.state === 'suspended') ringAudioCtx.resume();
  
  ringOsc = ringAudioCtx.createOscillator();
  ringLfo = ringAudioCtx.createOscillator();
  ringGain = ringAudioCtx.createGain();

  ringOsc.type = 'sine';
  ringOsc.frequency.value = 440; // Base frequency

  ringLfo.type = 'square';
  ringLfo.frequency.value = 15; // Fast warble (UK style ring)

  // Modulate frequency
  const lfoGain = ringAudioCtx.createGain();
  lfoGain.gain.value = 40;
  ringLfo.connect(lfoGain);
  lfoGain.connect(ringOsc.frequency);

  // Modulate volume (Ring... pause... Ring...)
  const envLfo = ringAudioCtx.createOscillator();
  envLfo.type = 'square';
  envLfo.frequency.value = 0.3; // Slow on/off
  envLfo.connect(ringGain.gain);
  envLfo.start();

  ringOsc.connect(ringGain);
  ringGain.connect(ringAudioCtx.destination);

  ringOsc.start();
  ringLfo.start();
};

const stopRingtone = () => {
  if (ringOsc) {
    try { ringOsc.stop(); ringLfo.stop(); } catch(e){}
    ringOsc = null;
  }
};

function compressImage(file, maxWidth = 480, quality = 0.65) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ratio = Math.min(maxWidth / img.width, 1);
        canvas.width = img.width * ratio;
        canvas.height = img.height * ratio;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function DirectMessages({ user, db, activeCallId, setActiveCallId }) {
  const [contacts, setContacts] = useState([]);
  const [activeChatUser, setActiveChatUser] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  
  const [msgInput, setMsgInput] = useState('');
  const [msgPhoto, setMsgPhoto] = useState(null);
  const fileInputRef = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const [callData, setCallData] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  
  const [stream, setStream] = useState(null);
  const streamRef = useRef(null);
  const peerRef = useRef(null);
  const audioRef = useRef(null);
  const chatEndRef = useRef(null);
  const [fullImg, setFullImg] = useState(null);

  const [isVideoOn, setIsVideoOn] = useState(false);
  const localVideoRef = useRef(null);

  // 1. Fetch Contacts
  useEffect(() => {
    const usersRef = ref(db, 'users');
    const unsub = onValue(usersRef, snap => {
      const data = snap.val();
      if (data) {
        const arr = Object.values(data).filter(u => u.uid !== user.uid);
        setContacts(arr);
      }
    });
    return () => off(usersRef);
  }, []);

  // 2. Fetch Chat Messages when activeChatUser changes
  useEffect(() => {
    if (!activeChatUser) {
      setChatMessages([]);
      return;
    }
    const chatId = user.uid < activeChatUser.uid ? `${user.uid}_${activeChatUser.uid}` : `${activeChatUser.uid}_${user.uid}`;
    const messagesRef = ref(db, `direct_messages/${chatId}`);
    
    const unsub = onValue(messagesRef, snap => {
      const data = snap.val();
      if (data) {
        setChatMessages(Object.values(data).sort((a, b) => a.ts - b.ts));
        setTimeout(() => {
          chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      } else {
        setChatMessages([]);
      }
    });

    return () => off(messagesRef);
  }, [activeChatUser, user.uid, db]);

  // Handle Photo Select
  const handlePhotoSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const compressed = await compressImage(file);
    setMsgPhoto(compressed);
    e.target.value = "";
  };

  // Handle Audio Recording
  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    } else {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorderRef.current = new MediaRecorder(audioStream);
        audioChunksRef.current = [];
        
        mediaRecorderRef.current.ondataavailable = e => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        
        mediaRecorderRef.current.onstop = async () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64Audio = reader.result;
            // Send audio message
            if (!activeChatUser) return;
            const chatId = user.uid < activeChatUser.uid ? `${user.uid}_${activeChatUser.uid}` : `${activeChatUser.uid}_${user.uid}`;
            await push(ref(db, `direct_messages/${chatId}`), {
              audio: base64Audio,
              senderId: user.uid,
              ts: Date.now()
            });
          };
          audioStream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorderRef.current.start();
        setIsRecording(true);
      } catch (e) {
        alert("Microphone access denied.");
      }
    }
  };

  // Send Message
  const sendMessage = async (e) => {
    e.preventDefault();
    if ((!msgInput.trim() && !msgPhoto) || !activeChatUser) return;
    
    const chatId = user.uid < activeChatUser.uid ? `${user.uid}_${activeChatUser.uid}` : `${activeChatUser.uid}_${user.uid}`;
    const messagesRef = ref(db, `direct_messages/${chatId}`);
    
    await push(messagesRef, {
      text: msgInput.trim() || null,
      photo: msgPhoto || null,
      senderId: user.uid,
      ts: Date.now()
    });
    
    setMsgInput('');
    setMsgPhoto(null);
  };

  // 3. Listen to active call
  useEffect(() => {
    if (!activeCallId) {
      setCallData(null);
      cleanupCall();
      return;
    }

    const callRef = ref(db, `calls/${activeCallId}`);
    const unsub = onValue(callRef, snap => {
      const data = snap.val();
      if (!data) {
        setActiveCallId(null);
        return;
      }
      setCallData(data);

      if (data.status === 'ringing') {
        if (data.receiver === user.uid) playRingtone();
      } else {
        stopRingtone();
      }

      if (data.status === 'accepted' && !peerRef.current && streamRef.current) {
        startWebRTC(data);
      }
    });

    return () => {
      off(callRef);
      stopRingtone();
    };
  }, [activeCallId]);

  useEffect(() => {
    let timerId;
    if (callData && callData.status === 'accepted') {
      timerId = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(timerId);
  }, [callData?.status]);

  useEffect(() => {
    if (callData?.status === 'accepted' && streamRef.current && localVideoRef.current) {
      localVideoRef.current.srcObject = streamRef.current;
    }
  }, [callData?.status, streamRef.current]);

  const formatDuration = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const formatTime = (ts) => {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const cleanupCall = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setStream(null);
    }
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    setIsMuted(false);
    setIsDeafened(false);
    setIsVideoOn(false);
    off(ref(db, `private_signals/${activeCallId}_${user.uid}`));
  };

  const toggleVideo = () => {
    if (streamRef.current) {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOn(videoTrack.enabled);
      }
    }
  };

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

  const startCall = async (contact) => {
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStream.getVideoTracks().forEach(t => t.enabled = false);
      setStream(localStream);
      streamRef.current = localStream;
      setIsVideoOn(false);

      const callId = user.uid < contact.uid ? `${user.uid}_${contact.uid}` : `${contact.uid}_${user.uid}`;
      
      const newCallData = {
        status: 'ringing',
        caller: user.uid,
        receiver: contact.uid,
        callerName: user.name,
        callerPhoto: user.photoURL,
        receiverName: contact.name,
        receiverPhoto: contact.photoURL,
        ts: Date.now()
      };

      await set(ref(db, `calls/${callId}`), newCallData);
      await set(ref(db, `user_calls/${user.uid}`), callId);
      await set(ref(db, `user_calls/${contact.uid}`), callId);

    } catch (e) {
      alert("Could not access microphone.");
    }
  };

  const acceptCall = async () => {
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStream.getVideoTracks().forEach(t => t.enabled = false);
      setStream(localStream);
      streamRef.current = localStream;
      setIsVideoOn(false);

      await set(ref(db, `calls/${activeCallId}/status`), 'accepted');
    } catch (e) {
      alert("Could not access microphone.");
    }
  };

  const endCall = async () => {
    if (!callData) return;
    cleanupCall();
    await remove(ref(db, `user_calls/${callData.caller}`));
    await remove(ref(db, `user_calls/${callData.receiver}`));
    await remove(ref(db, `calls/${activeCallId}`));
    setActiveCallId(null);
  };

  const startWebRTC = (data) => {
    const isCaller = data.caller === user.uid;
    const otherUid = isCaller ? data.receiver : data.caller;

    const peer = new Peer({
      initiator: isCaller,
      trickle: false,
      stream: streamRef.current,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          { 
            urls: 'turn:openrelay.metered.ca:80', 
            username: 'openrelayproject', 
            credential: 'openrelayproject' 
          },
          { 
            urls: 'turn:openrelay.metered.ca:443', 
            username: 'openrelayproject', 
            credential: 'openrelayproject' 
          },
          { 
            urls: 'turn:openrelay.metered.ca:443?transport=tcp', 
            username: 'openrelayproject', 
            credential: 'openrelayproject' 
          }
        ]
      }
    });

    peer.on('signal', signal => {
      push(ref(db, `private_signals/${activeCallId}_${otherUid}`), signal);
    });

    peer.on('stream', remoteStream => {
      if (audioRef.current) {
        audioRef.current.srcObject = remoteStream;
        try { audioRef.current.play().catch(()=>{}); } catch(_) {}
      }
    });

    peerRef.current = peer;

    const signalsRef = ref(db, `private_signals/${activeCallId}_${user.uid}`);
    onChildAdded(signalsRef, snap => {
      const incomingSignal = snap.val();
      if (peerRef.current) peerRef.current.signal(incomingSignal);
      remove(ref(db, `private_signals/${activeCallId}_${user.uid}/${snap.key}`));
    });
  };

  // FULL SCREEN IMAGE
  if (fullImg) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <button onClick={() => setFullImg(null)} style={{ position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', fontSize: 18 }}>✕</button>
        <img src={fullImg} style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 12 }} />
      </div>
    );
  }

  // ACTIVE CALL VIEW
  if (callData) {
    const isIncoming = callData.status === 'ringing' && callData.receiver === user.uid;
    const isOutgoing = callData.status === 'ringing' && callData.caller === user.uid;
    const isAccepted = callData.status === 'accepted';
    
    const otherName = callData.caller === user.uid ? callData.receiverName : callData.callerName;
    const otherPhoto = callData.caller === user.uid ? callData.receiverPhoto : callData.callerPhoto;

    return (
      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#000', overflow: 'hidden' }}>
        
        {/* Only render audio/remote video if call is NOT accepted (i.e. ringing) to avoid duplication */}
        {!isAccepted && <audio ref={audioRef} autoPlay playsInline muted={isDeafened} />}
        
        {isIncoming && (
          <div style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
            <img src={otherPhoto} style={{ width: 100, height: 100, borderRadius: '50%', marginBottom: 16, border: '4px solid #ef4444', animation: 'pulse 1.5s infinite' }} />
            <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>{otherName}</div>
            <div style={{ color: '#94a3b8', marginBottom: 40 }}>is calling you...</div>
            
            <div style={{ display: 'flex', gap: 20, justifyContent: 'center' }}>
              <button onClick={endCall} style={{ width: 64, height: 64, borderRadius: '50%', background: '#ef4444', border: 'none', color: '#fff', fontSize: 24, cursor: 'pointer' }}>✕</button>
              <button onClick={acceptCall} style={{ width: 64, height: 64, borderRadius: '50%', background: '#22c55e', border: 'none', color: '#fff', fontSize: 24, cursor: 'pointer' }}>📞</button>
            </div>
          </div>
        )}

        {isOutgoing && (
          <div style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
            <img src={otherPhoto} style={{ width: 100, height: 100, borderRadius: '50%', marginBottom: 16, border: '4px solid #64748b' }} />
            <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>{otherName}</div>
            <div style={{ color: '#94a3b8', marginBottom: 40 }}>Ringing...</div>
            <button onClick={endCall} style={{ width: 64, height: 64, borderRadius: '50%', background: '#ef4444', border: 'none', color: '#fff', fontSize: 24, cursor: 'pointer' }}>End Call</button>
          </div>
        )}

        {isAccepted && (
          <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            {/* Remote Video Background */}
            <video ref={audioRef} autoPlay playsInline muted={isDeafened} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }} />
            
            {/* Local Video Picture-in-Picture */}
            <video ref={localVideoRef} autoPlay playsInline muted style={{ position: 'absolute', bottom: 20, right: 20, width: 100, height: 150, backgroundColor: '#1e293b', objectFit: 'cover', borderRadius: 12, border: '2px solid rgba(255,255,255,0.1)', zIndex: 10, opacity: isVideoOn ? 1 : 0, transition: 'opacity 0.3s' }} />
            
            {/* Call Overlay Card */}
            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'rgba(0,0,0,0.6)', padding: '40px 30px', borderRadius: 32, backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.05)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '24px', justifyContent: 'center' }}>
                <div className="sb-dot" style={{ background: '#22c55e', boxShadow: '0 0 12px #22c55e' }}></div>
                <span style={{ fontSize: '14px', fontWeight: '800', color: '#22c55e', letterSpacing: '0.05em' }}>SECURE CALL</span>
              </div>
              
              <img src={otherPhoto} style={{ width: 120, height: 120, borderRadius: '50%', marginBottom: 20, border: '4px solid #22c55e', boxShadow: '0 0 20px rgba(34, 197, 94, 0.4)' }} />
              <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 8, color: '#f8fafc' }}>{otherName}</div>
              <div style={{ color: '#94a3b8', marginBottom: 40, fontFamily: "'JetBrains Mono', monospace", fontSize: '20px' }}>{formatDuration(callDuration)}</div>
              
              {/* Controls */}
              <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '10px' }}>
                <button onClick={toggleVideo} style={{ width: '64px', height: '64px', borderRadius: '50%', background: isVideoOn ? 'rgba(255, 255, 255, 0.1)' : 'rgba(239, 68, 68, 0.2)', border: '1px solid ' + (!isVideoOn ? '#ef4444' : 'rgba(255, 255, 255, 0.2)'), color: !isVideoOn ? '#ef4444' : '#fff', fontSize: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                  {!isVideoOn ? '🚫📹' : '📹'}
                </button>
                <button onClick={toggleMute} style={{ width: '64px', height: '64px', borderRadius: '50%', background: isMuted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.1)', border: '1px solid ' + (isMuted ? '#ef4444' : 'rgba(255, 255, 255, 0.2)'), color: isMuted ? '#ef4444' : '#fff', fontSize: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                  {isMuted ? '🔇' : '🎤'}
                </button>
                <button onClick={endCall} style={{ width: '72px', height: '72px', borderRadius: '50%', background: '#ef4444', border: 'none', color: '#fff', fontSize: '14px', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(239, 68, 68, 0.4)', transition: 'all 0.2s' }}>
                  END
                </button>
                <button onClick={toggleDeafen} style={{ width: '64px', height: '64px', borderRadius: '50%', background: isDeafened ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.1)', border: '1px solid ' + (isDeafened ? '#ef4444' : 'rgba(255, 255, 255, 0.2)'), color: isDeafened ? '#ef4444' : '#fff', fontSize: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                  {isDeafened ? '🔕' : '🔊'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // CHAT VIEW
  if (activeChatUser) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Chat Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
          <button onClick={() => setActiveChatUser(null)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '16px', cursor: 'pointer', marginRight: '16px', padding: 0 }}>
            ◀ Back
          </button>
          <img src={activeChatUser.photoURL} style={{ width: 36, height: 36, borderRadius: '50%', marginRight: '12px', border: '1px solid rgba(255,255,255,0.1)' }} />
          <div style={{ flex: 1, fontSize: '16px', fontWeight: 700 }}>{activeChatUser.name}</div>
          <button onClick={() => startCall(activeChatUser)} style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444', width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            📞
          </button>
        </div>

        {/* Chat Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {chatMessages.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#64748b', fontSize: '12px', marginTop: '20px' }}>Say hi to {activeChatUser.name.split(' ')[0]}!</div>
          ) : (
            chatMessages.map(msg => {
              const isMine = msg.senderId === user.uid;
              return (
                <div key={msg.ts} style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start' }}>
                  <div style={{ 
                    maxWidth: '75%', 
                    padding: '10px 14px', 
                    borderRadius: '16px', 
                    background: isMine ? '#ef4444' : 'rgba(255,255,255,0.08)',
                    color: '#fff',
                    borderBottomRightRadius: isMine ? '4px' : '16px',
                    borderBottomLeftRadius: isMine ? '16px' : '4px'
                  }}>
                    {msg.photo && (
                      <img src={msg.photo} style={{ width: '100%', borderRadius: 8, marginBottom: msg.text ? 8 : 0, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.2)' }} onClick={() => setFullImg(msg.photo)} />
                    )}
                    {msg.audio && (
                      <audio src={msg.audio} controls style={{ height: 32, width: 200, marginBottom: msg.text ? 8 : 0 }} />
                    )}
                    {msg.text && <div style={{ fontSize: '14px', lineHeight: '1.4', wordBreak: 'break-word' }}>{msg.text}</div>}
                    <div style={{ fontSize: '10px', color: isMine ? 'rgba(255,255,255,0.7)' : '#94a3b8', textAlign: 'right', marginTop: '4px' }}>{formatTime(msg.ts)}</div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Chat Input */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
          {msgPhoto && (
            <div style={{ position: 'relative', display: 'inline-block', marginBottom: 8 }}>
              <img src={msgPhoto} style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)' }} />
              <button onClick={() => setMsgPhoto(null)} style={{ position: 'absolute', top: -6, right: -6, background: '#ef4444', border: 'none', color: '#fff', width: 20, height: 20, borderRadius: '50%', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
          )}
          <form onSubmit={sendMessage} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <input type="file" accept="image/*" ref={fileInputRef} onChange={handlePhotoSelect} style={{ display: 'none' }} />
            
            <button type="button" onClick={() => fileInputRef.current?.click()} style={{ width: 42, height: 42, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#94a3b8', fontSize: 18, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              📷
            </button>

            <button type="button" onClick={toggleRecording} style={{ width: 42, height: 42, background: isRecording ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255,255,255,0.06)', border: `1px solid ${isRecording ? '#ef4444' : 'rgba(255,255,255,0.1)'}`, borderRadius: 12, color: isRecording ? '#ef4444' : '#94a3b8', fontSize: 18, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: isRecording ? 'pulse 1.5s infinite' : 'none' }}>
              {isRecording ? '⏹️' : '🎤'}
            </button>

            <input 
              value={msgInput}
              onChange={e => setMsgInput(e.target.value)}
              placeholder={isRecording ? "Recording..." : "Message..."}
              disabled={isRecording}
              style={{ flex: 1, padding: '10px 14px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: '14px', outline: 'none', minHeight: 42 }}
            />
            
            <button type="submit" disabled={(!msgInput.trim() && !msgPhoto) || isRecording} style={{ width: 42, height: 42, background: (msgInput.trim() || msgPhoto) ? '#ef4444' : 'rgba(239, 68, 68, 0.3)', border: 'none', borderRadius: 12, color: '#fff', fontSize: 18, cursor: (msgInput.trim() || msgPhoto) ? 'pointer' : 'default', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
              ➤
            </button>
          </form>
        </div>
      </div>
    );
  }

  // DIRECTORY VIEW
  return (
    <div style={{ padding: 16 }}>
      <div className="section-hd" style={{ padding: 0, marginBottom: 16 }}>
        <span className="section-title">DIRECT MESSAGES</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {contacts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#64748b', fontSize: 12 }}>No other teammates have joined yet.</div>
        ) : (
          contacts.map(c => (
            <div 
              key={c.uid} 
              onClick={() => setActiveChatUser(c)}
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', transition: 'background 0.2s' }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
              onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <img src={c.photoURL} style={{ width: 48, height: 48, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.1)' }} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>{c.name}</div>
                  <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>Tap to chat or call...</div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
