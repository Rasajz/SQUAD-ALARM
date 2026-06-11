import { useState, useEffect, useRef, useCallback } from "react";
import { db, auth } from "./firebase";
import { ref, onValue, set, push, off, remove, update, onDisconnect, get } from "firebase/database";
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, sendPasswordResetEmail, TwitterAuthProvider } from "firebase/auth";
import { messaging } from "./firebase";
import { getToken, onMessage } from "firebase/messaging";
import VoiceRoom, { CallOverlay } from "./VoiceRoom";
import DirectMessages from "./DirectMessages";

/* ══════════════════════════════════════════════════
   AUDIO — real wailing siren via LFO modulation
══════════════════════════════════════════════════ */
let _ctx = null;
function getCtx() {
  if (!_ctx || _ctx.state === "closed") _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === "suspended") _ctx.resume();
  return _ctx;
}
function playSiren() {
  try {
    const ctx = getCtx();
    const now = ctx.currentTime;
    // Set duration to exactly 2.0 seconds as requested
    const DUR = 2.0;
    const osc  = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const lfo  = ctx.createOscillator();
    const lfoG = ctx.createGain();
    const g1   = ctx.createGain();
    const g2   = ctx.createGain();
    const mix  = ctx.createGain();
    lfo.type = "sine"; lfo.frequency.value = 1.4;
    lfoG.gain.value = 280;
    lfo.connect(lfoG);
    lfoG.connect(osc.frequency);
    lfoG.connect(osc2.frequency);
    osc.type  = "sawtooth"; osc.frequency.value  = 820;
    osc2.type = "square";   osc2.frequency.value = 830;
    g2.gain.value = 0.28;
    osc.connect(g1); osc2.connect(g2);
    g1.connect(mix); g2.connect(mix);
    mix.connect(ctx.destination);
    mix.gain.setValueAtTime(0, now);
    mix.gain.linearRampToValueAtTime(0.45, now + 0.06);
    mix.gain.setValueAtTime(0.45, now + DUR - 0.18);
    mix.gain.linearRampToValueAtTime(0, now + DUR);
    [lfo, osc, osc2].forEach(n => { n.start(now); n.stop(now + DUR); });
  } catch (_) {}
}
function buzz() { try { navigator.vibrate?.([300,80,300,80,500]); } catch (_) {} }

/* ══════════════════════════════════════════════════
   DATE HELPERS
══════════════════════════════════════════════════ */
function playPop() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    osc.start(); osc.stop(ctx.currentTime + 0.1);
  } catch(e) {}
}

function playPing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(); osc.stop(ctx.currentTime + 0.3);
  } catch(e) {}
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
}
function fmtRelative(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5)   return "Just now";
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return fmtDate(ts);
}
function fmtDate(ts) {
  const d = new Date(ts), now = new Date();
  const y = new Date(now); y.setDate(y.getDate()-1);
  const same = d.getFullYear() === now.getFullYear();
  if (d.toDateString() === now.toDateString()) return `Today · ${fmtTime(ts)}`;
  if (d.toDateString() === y.toDateString())   return `Yesterday · ${fmtTime(ts)}`;
  return d.toLocaleDateString([], same
    ? { weekday:"short", month:"short", day:"numeric" }
    : { month:"short", day:"numeric", year:"numeric" }
  ) + " · " + fmtTime(ts);
}
function fmtFull(ts) {
  return new Date(ts).toLocaleDateString([], {
    weekday:"long", year:"numeric", month:"long", day:"numeric"
  }) + " at " + fmtTime(ts);
}

/* ══════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════ */
const COLORS = ["#e53935","#8e24aa","#1565c0","#00838f","#2e7d32","#e65100","#6a1b9a","#ad1457"];
const avatarColor = name => COLORS[name.toUpperCase().charCodeAt(0) % COLORS.length];
const initials    = name => name.trim().split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();

function Avatar({ name, photo, size = 36 }) {
  if (photo) {
    return (
      <img
        src={photo}
        alt={name}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
          border: "1px solid rgba(255, 255, 255, 0.1)"
        }}
      />
    );
  }
  return (
    <div style={{
      width:size, height:size, borderRadius:"50%", background:avatarColor(name),
      display:"flex", alignItems:"center", justifyContent:"center",
      fontSize:size*.36, fontWeight:800, color:"#fff", flexShrink:0,
      fontFamily:"'JetBrains Mono',monospace", letterSpacing:"-.02em",
    }}>
      {initials(name)}
    </div>
  );
}

/* ══════════════════════════════════════════════════
   PHOTO COMPRESSION
══════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════
   CSS
══════════════════════════════════════════════════ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700;800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html,body{height:100%;background:#07090d;overflow:hidden;touch-action:manipulation;}
::-webkit-scrollbar{width:3px;} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:9px;}

.app{height:100dvh;background:#07090d;display:flex;flex-direction:column;font-family:'DM Sans',sans-serif;color:#e2e8f0;overflow:hidden;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;}

/* ── OVERLAY ────────────────────────────────── */
.ov{position:fixed;inset:0;z-index:999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;animation:ovBg 0.7s ease-in-out infinite;}
@keyframes ovBg{0%,100%{background:#140404}50%{background:#220606}}
.ov-lines{position:absolute;inset:0;background:repeating-linear-gradient(-45deg,transparent 0,transparent 20px,rgba(220,38,38,.05) 20px,rgba(220,38,38,.05) 40px);}
.ov-card{position:relative;z-index:1;width:100%;max-width:340px;background:rgba(20,4,4,.8);border:1px solid rgba(239,68,68,.35);border-radius:28px;padding:36px 28px 28px;display:flex;flex-direction:column;align-items:center;gap:8px;backdrop-filter:blur(10px);box-shadow:0 0 80px rgba(239,68,68,.25);}
.ov-icon{font-size:56px;animation:iconRock .45s ease-in-out infinite;}
@keyframes iconRock{0%,100%{transform:rotate(-8deg) scale(1)}50%{transform:rotate(8deg) scale(1.07)}}
.ov-word{font-family:'Bebas Neue',sans-serif;font-size:clamp(52px,16vw,72px);color:#ef4444;letter-spacing:.1em;line-height:1;}
.ov-badge{background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);border-radius:99px;padding:4px 14px;font-size:10px;font-family:'JetBrains Mono',monospace;letter-spacing:.2em;color:#f87171;text-transform:uppercase;}
.ov-who{font-size:22px;font-weight:800;color:#fca5a5;margin-top:4px;}
.ov-time{font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(255,255,255,.3);letter-spacing:.08em;}
.ov-dismiss{margin-top:20px;width:100%;padding:15px;background:rgba(0,0,0,.5);border:2px solid rgba(255,255,255,.2);border-radius:14px;color:rgba(255,255,255,.85);font-family:'DM Sans',sans-serif;font-weight:700;font-size:15px;letter-spacing:.06em;cursor:pointer;transition:all .18s;}
.ov-dismiss:hover{border-color:rgba(255,255,255,.5);color:#fff;}

/* ── STATUS BAR ───────────────────────────── */
.sb{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;background:rgba(255,255,255,.025);border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0;}
.sb-left{display:flex;align-items:center;gap:7px;}
.sb-dot{width:6px;height:6px;border-radius:50%;background:#22c55e;box-shadow:0 0 8px #22c55e;animation:dotGlow 2s ease-in-out infinite;}
@keyframes dotGlow{0%,100%{opacity:1}50%{opacity:.35}}
.sb-title{font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.06em;color:#94a3b8;}
.sb-chip{padding:3px 11px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:99px;font-family:'JetBrains Mono',monospace;font-size:10px;color:#64748b;}

/* ── TAB CONTENT ──────────────────────────── */
.tab-body{flex:1;overflow-y:auto;overflow-x:hidden;}

/* ── HOME TAB ─────────────────────────────── */
.home{display:flex;flex-direction:column;gap:0;padding:0;}

.status-card{margin:14px 14px 0;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:18px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;}
.sc-left{display:flex;flex-direction:column;gap:2px;}
.sc-label{font-size:11px;font-weight:600;color:#475569;letter-spacing:.04em;}
.sc-value{font-size:15px;font-weight:700;color:#e2e8f0;}
.sc-alert{font-family:'JetBrains Mono',monospace;font-size:10px;color:#f87171;}
.sc-ok{font-family:'JetBrains Mono',monospace;font-size:10px;color:#4ade80;}

.alarm-zone{display:flex;flex-direction:column;align-items:center;padding:18px 16px 12px;gap:10px;}
.alarm-btn{
  width:100%;max-width:340px;padding:0;border:none;border-radius:22px;cursor:pointer;
  background:linear-gradient(155deg,#dc2626 0%,#991b1b 100%);
  box-shadow:0 8px 40px rgba(220,38,38,.5),inset 0 1px 0 rgba(255,255,255,.18);
  animation:btnGlow 2.4s ease-in-out infinite;position:relative;overflow:hidden;
  transition:transform .12s;touch-action:manipulation;
}
.alarm-btn:active{transform:scale(.96);}
.alarm-btn.quiet{animation:none;}
@keyframes btnGlow{0%,100%{box-shadow:0 8px 40px rgba(220,38,38,.5),inset 0 1px 0 rgba(255,255,255,.18)}50%{box-shadow:0 8px 60px rgba(220,38,38,.8),inset 0 1px 0 rgba(255,255,255,.18)}}
.btn-shine{position:absolute;top:0;left:-100%;width:55%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.12),transparent);animation:shine 2.4s ease-in-out infinite;}
@keyframes shine{0%{left:-100%}60%,100%{left:160%}}
.btn-inner{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;padding:20px 24px 16px;gap:3px;}
.btn-emoji{font-size:36px;line-height:1;}
.btn-word{font-family:'Bebas Neue',sans-serif;font-size:44px;color:#fff;letter-spacing:.1em;line-height:1;}
.btn-sub{font-size:11px;color:rgba(255,255,255,.6);letter-spacing:.04em;font-weight:500;margin-top:2px;}
.alarm-hint{font-family:'JetBrains Mono',monospace;font-size:9px;color:#334155;text-align:center;letter-spacing:.08em;max-width:300px;}

.section-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 8px;}
.section-title{font-size:11px;font-weight:700;color:#334155;letter-spacing:.12em;text-transform:uppercase;}
.section-link{font-size:11px;font-weight:600;color:#3b82f6;cursor:pointer;}
.recent-list{display:flex;flex-direction:column;gap:0;padding:0 14px 16px;}

/* ── ALARM HISTORY CARD ─────────────────── */
.alarm-entry{display:flex;align-items:center;gap:12px;padding:11px 14px;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.15);border-radius:14px;margin-bottom:7px;}
.ae-icon{font-size:22px;flex-shrink:0;}
.ae-body{flex:1;min-width:0;}
.ae-who{font-size:14px;font-weight:700;color:#fca5a5;}
.ae-when{font-family:'JetBrains Mono',monospace;font-size:10px;color:#475569;margin-top:1px;}

/* ── MESSAGES TAB ───────────────────────── */
.msgs-wrap{display:flex;flex-direction:column;height:100%;overflow:hidden;}
.msg-input-zone{padding:10px 14px 10px;border-top:1px solid rgba(255,255,255,.06);flex-shrink:0;background:#07090d;}
.msg-photo-preview{position:relative;display:inline-block;margin-bottom:8px;}
.msg-photo-preview img{width:80px;height:80px;object-fit:cover;border-radius:10px;border:1px solid rgba(255,255,255,.15);}
.msg-remove-photo{position:absolute;top:-6px;right:-6px;width:20px;height:20px;background:#ef4444;border:none;border-radius:50%;color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;}
.msg-input-row{display:flex;align-items:flex-end;gap:8px;}
.msg-textarea{flex:1;padding:10px 13px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:14px;color:#e2e8f0;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:500;outline:none;resize:none;min-height:42px;max-height:90px;transition:border-color .15s;line-height:1.5;}
.msg-textarea:focus{border-color:rgba(59,130,246,.4);}
.msg-textarea::placeholder{color:#334155;}
.msg-photo-btn{width:42px;height:42px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;color:#64748b;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;}
.msg-photo-btn:active,.msg-photo-btn:hover{background:rgba(255,255,255,.1);color:#94a3b8;}
.msg-send-btn{width:42px;height:42px;background:#1d4ed8;border:none;border-radius:12px;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;}
.msg-send-btn:disabled{opacity:.35;cursor:default;}
.msg-send-btn:not(:disabled):active{transform:scale(.93);background:#2563eb;}
.msgs-list{flex:1;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:10px;}
.msg-card{display:flex;gap:10px;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:16px;animation:slideUp .22s ease-out;}
@keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.mc-right{flex:1;min-width:0;}
.mc-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:3px;}
.mc-name{font-size:13px;font-weight:700;color:#e2e8f0;}
.mc-time{font-family:'JetBrains Mono',monospace;font-size:9px;color:#334155;flex-shrink:0;}
.mc-text{font-size:14px;font-weight:500;color:#cbd5e1;line-height:1.5;word-break:break-word;}
.mc-img{width:100%;max-width:260px;border-radius:12px;margin-top:7px;cursor:pointer;border:1px solid rgba(255,255,255,.1);}
.img-fullscreen{position:fixed;inset:0;z-index:998;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;padding:20px;}
.img-fullscreen img{max-width:100%;max-height:100%;border-radius:12px;}
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;gap:8px;flex:1;}
.empty-icon{font-size:36px;opacity:.25;}
.empty-label{font-family:'JetBrains Mono',monospace;font-size:10px;color:#1e293b;letter-spacing:.15em;text-align:center;}

/* ── LOG TAB ─────────────────────────────── */
.log-wrap{padding:10px 14px;display:flex;flex-direction:column;gap:7px;}
.log-entry{display:flex;align-items:flex-start;gap:12px;padding:13px 14px;background:rgba(239,68,68,.05);border:1px solid rgba(239,68,68,.12);border-radius:16px;}
.le-num{font-family:'JetBrains Mono',monospace;font-size:10px;color:#334155;width:20px;flex-shrink:0;padding-top:2px;}
.le-body{flex:1;}
.le-who{font-size:14px;font-weight:700;color:#fca5a5;display:flex;align-items:center;gap:6px;}
.le-when-rel{font-size:12px;font-weight:600;color:#ef4444;}
.le-full{font-family:'JetBrains Mono',monospace;font-size:10px;color:#475569;margin-top:3px;line-height:1.5;}

/* ── SETTINGS TAB ────────────────────────── */
.settings{padding:14px;}
.setting-section{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:18px;overflow:hidden;margin-bottom:12px;}
.setting-row{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.05);}
.setting-row:last-child{border-bottom:none;}
.sr-left{display:flex;flex-direction:column;gap:2px;}
.sr-label{font-size:14px;font-weight:600;color:#e2e8f0;}
.sr-sub{font-size:11px;color:#475569;}
.test-btn{padding:8px 16px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:10px;color:#94a3b8;font-family:'DM Sans',sans-serif;font-weight:700;font-size:12px;cursor:pointer;transition:all .15s;}
.test-btn:active{transform:scale(.95);}
.info-box{background:rgba(59,130,246,.07);border:1px solid rgba(59,130,246,.2);border-radius:14px;padding:14px 16px;margin-bottom:12px;}
.info-title{font-size:12px;font-weight:700;color:#60a5fa;margin-bottom:6px;letter-spacing:.04em;}
.info-line{font-size:12px;font-weight:500;color:#64748b;line-height:1.7;}
.info-line b{color:#94a3b8;font-weight:700;}

/* ── BOTTOM NAV ──────────────────────────── */
.bnav{display:flex;background:rgba(10,12,18,.95);border-top:1px solid rgba(255,255,255,.08);flex-shrink:0;padding-bottom:env(safe-area-inset-bottom);}
.bnav-btn{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10px 4px 8px;cursor:pointer;border:none;background:transparent;color:#334155;transition:color .15s;gap:3px;}
.bnav-btn.active{color:#e2e8f0;}
.bnav-icon{font-size:20px;line-height:1;}
.bnav-label{font-size:9px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;}
.bnav-badge{position:relative;}
.badge-dot{position:absolute;top:-2px;right:-4px;width:7px;height:7px;border-radius:50%;background:#ef4444;border:1.5px solid #07090d;}

/* ── SETUP SCREEN ────────────────────────── */
.setup-bg{height:100dvh;background:#07090d;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;font-family:'DM Sans',sans-serif;}
.setup-card{width:100%;max-width:360px;background:#0f1520;border:1px solid rgba(255,255,255,.09);border-radius:26px;padding:32px 24px;display:flex;flex-direction:column;align-items:center;gap:12px;box-shadow:0 32px 80px rgba(0,0,0,.7);}
.setup-logo{font-size:48px;}
.setup-h1{font-family:'Bebas Neue',sans-serif;font-size:32px;letter-spacing:.1em;color:#f1f5f9;}
.setup-tagline{font-size:13px;font-weight:500;color:#475569;text-align:center;line-height:1.6;max-width:270px;}
.divider{width:100%;height:1px;background:rgba(255,255,255,.07);}
.field-label{font-family:'JetBrains Mono',monospace;font-size:9px;color:#475569;letter-spacing:.25em;text-transform:uppercase;align-self:flex-start;}
.setup-input{width:100%;padding:13px 16px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:13px;color:#f1f5f9;font-family:'DM Sans',sans-serif;font-size:16px;font-weight:600;outline:none;transition:border-color .15s;}
.setup-input:focus{border-color:rgba(239,68,68,.5);}
.setup-input::placeholder{color:#1e293b;}
.join-btn{width:100%;padding:16px;background:linear-gradient(135deg,#dc2626,#991b1b);border:none;border-radius:14px;color:#fff;font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:.15em;cursor:pointer;box-shadow:0 0 34px rgba(220,38,38,.38);transition:all .18s;}
.join-btn:hover{transform:translateY(-1px);box-shadow:0 0 50px rgba(220,38,38,.55);}
.join-btn:active{transform:scale(.98);}
.google-btn{width:100%;padding:15px;background:#fff;border:none;border-radius:14px;color:#0f172a;font-family:'DM Sans',sans-serif;font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:12px;box-shadow:0 4px 18px rgba(0,0,0,.25),inset 0 1px 0 rgba(255,255,255,.2);transition:all .18s;}
.google-btn:hover{background:#f1f5f9;transform:translateY(-1px);box-shadow:0 6px 22px rgba(0,0,0,.35);}
.google-btn:active{transform:scale(.98);background:#e2e8f0;}
.setup-warn{font-family:'JetBrains Mono',monospace;font-size:9px;color:#334155;text-align:center;line-height:1.7;max-width:290px;}
.how-works{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:12px 14px;width:100%;}
.hw-title{font-size:11px;font-weight:700;color:#334155;letter-spacing:.1em;margin-bottom:8px;}
.hw-step{display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;}
.hw-num{width:18px;height:18px;border-radius:50%;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#f87171;flex-shrink:0;margin-top:1px;}
.hw-text{font-size:11px;color:#475569;line-height:1.5;}

/* ── LOADING ─────────────────────────────── */
.loading{height:100dvh;background:#07090d;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;font-family:'JetBrains Mono',monospace;}
.spin{font-size:40px;animation:spin 1s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}

/* ── AUTHENTICATION EXTENSIONS ── */
.social-btn{display:flex;align-items:center;justify-content:center;height:44px;border-radius:12px;cursor:pointer;transition:all 0.15s;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;}
.social-btn:hover{transform:translateY(-1px);background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.2);}
.social-btn:active{transform:scale(0.97);}
.social-btn.google{color:#fff;}
.social-btn.facebook{color:#1877f2;background:rgba(24,119,242,0.1);border-color:rgba(24,119,242,0.25);}
.social-btn.facebook:hover{background:rgba(24,119,242,0.18);border-color:rgba(24,119,242,0.4);}
.social-btn.twitter{color:#fff;background:rgba(255,255,255,0.03);border-color:rgba(255,255,255,0.08);}
.social-btn.twitter:hover{background:rgba(255,255,255,0.07);border-color:rgba(255,255,255,0.15);}
.form-divider{display:flex;align-items:center;text-align:center;width:100%;margin:8px 0;font-family:'JetBrains Mono',monospace;font-size:9px;color:#334155;text-transform:uppercase;letter-spacing:0.15em;}
.form-divider::before,.form-divider::after{content:'';flex:1;border-bottom:1px solid rgba(255,255,255,0.06);}
.form-divider:not(:empty)::before{margin-right:.8em;}
.form-divider:not(:empty)::after{margin-left:.8em;}
.auth-error-banner{width:100%;padding:10px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:12px;color:#fca5a5;font-size:12px;line-height:1.4;word-break:break-word;text-align:center;animation:dmFadeIn 0.2s ease-out;}
.auth-link{color:#64748b;font-weight:600;cursor:pointer;transition:color 0.15s;}
.auth-link:hover{color:#ef4444;text-decoration:underline;}
.auth-link-forgot{color:#475569;cursor:pointer;transition:color 0.15s;}
.auth-link-forgot:hover{color:#94a3b8;text-decoration:underline;}
.auth-spinner{width:20px;height:20px;border:2.5px solid rgba(255,255,255,0.25);border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite;}
`;

/* ══════════════════════════════════════════════════
   APP
══════════════════════════════════════════════════ */
export default function SquadAlarm() {
  const [phase,    setPhase]    = useState("loading");
  const [user,     setUser]     = useState(null);
  const [tab,      setTab]      = useState("home");

  // Authentication extensions
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [forgotPass, setForgotPass] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [alarm,    setAlarm]    = useState(null);
  const [messages, setMessages] = useState([]);
  const [history,  setHistory]  = useState([]);
  const [overlay,  setOverlay]  = useState(false);
  const [newAlarm, setNewAlarm] = useState(false);
  const [newMsg,   setNewMsg]   = useState(false);
  const [dmTarget, setDmTarget] = useState(null);
  const [hostUid,  setHostUid]  = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const [lobbyCount, setLobbyCount] = useState(0);
  const [allUsers, setAllUsers] = useState({});
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [hasUnreadDM, setHasUnreadDM] = useState(false);

  const isHost = user?.uid === hostUid;
  const cooldownRef = useRef(null);

  const [firing,   setFiring]   = useState(false);
  const [msgText,  setMsgText]  = useState("");
  const [msgPhoto, setMsgPhoto] = useState(null);
  const [posting,  setPosting]  = useState(false);
  const [fullImg,  setFullImg]  = useState(null);

  const lastId    = useRef("");
  const sLoop     = useRef(null);
  const fileInput = useRef(null);
  const msgsEnd   = useRef(null);
  const dmRef     = useRef(null);

  /* ── Init & Auth Listener ─────────────────── */
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Query database first to see if user already has custom profile properties (e.g. registered name or joined date)
        let existingUser = null;
        try {
          const snap = await get(ref(db, "users/" + firebaseUser.uid));
          if (snap.exists()) {
            existingUser = snap.val();
          }
        } catch (err) {
          console.warn("Error checking existing user in DB:", err);
        }

        const userData = {
          uid: firebaseUser.uid,
          name: firebaseUser.displayName || existingUser?.name || "Teammate",
          email: firebaseUser.email,
          photoURL: firebaseUser.photoURL || existingUser?.photoURL || null,
          joinedAt: existingUser?.joinedAt || (firebaseUser.metadata.creationTime ? new Date(firebaseUser.metadata.creationTime).getTime() : Date.now())
        };

        // Attempt to request push notification permissions and get FCM token
        try {
          if (messaging) {
            const permission = await Notification.requestPermission();
            if (permission === "granted") {
              const currentToken = await getToken(messaging);
              if (currentToken) {
                userData.fcmToken = currentToken;
              }
            }
          }
        } catch (err) {
          console.warn("FCM Token fetch failed:", err);
        }

        // ALWAYS save the user to the database so they appear in Members/DMs
        await set(ref(db, "users/" + firebaseUser.uid), userData);

        // Set online presence
        try {
          const presRef = ref(db, `presence/${firebaseUser.uid}`);
          await set(presRef, true);
          onDisconnect(presRef).set(false);
        } catch (_) {}

        setUser(userData);
        setPhase("main");
      } else {
        setUser(null);
        setPhase("setup");
      }
    });
    return unsubscribe;
  }, []);

  /* ── Firebase Real-time Listeners ────────── */
  useEffect(() => {
    if (phase !== "main") return;

    let isInitialLoad = true;

    // ── alarm listener
    const alarmRef = ref(db, "alarm");
    onValue(alarmRef, (snap) => {
      const a = snap.val();
      setAlarm(a);
      if (a && a.id !== lastId.current) {
        lastId.current = a.id;
        if (!isInitialLoad) {
          setOverlay(true);
          setNewAlarm(true);
          playSiren(); buzz();
          if ("Notification" in window && Notification.permission === "granted") {
            try {
              new Notification("🚨 SQUAD ALARM", {
                body: `${a.by} just triggered the emergency alarm!`,
                icon: "/icon-192.png",
                vibrate: [200, 100, 200, 100, 500],
                tag: "squad-alarm",
                requireInteraction: true
              });
            } catch (e) {
              console.warn("Notification failed:", e);
            }
          }
        }
      }
      isInitialLoad = false;
    });

    // ── host listener
    const hostRef = ref(db, "host");
    onValue(hostRef, (snap) => setHostUid(snap.val()));

    // ── users listener
    const usersRef = ref(db, "users");
    onValue(usersRef, (snap) => setAllUsers(snap.val() || {}));

    // ── history listener
    const histRef = ref(db, "history");
    onValue(histRef, (snap) => {
      const data = snap.val();
      if (data) {
        const arr = Object.values(data).sort((a, b) => b.ts - a.ts);
        setHistory(arr);
      } else setHistory([]);
    });

    // ── messages listener
    let isMsgInitialLoad = true;
    const msgRef = ref(db, "messages");
    onValue(msgRef, (snap) => {
      const data = snap.val();
      if (data) {
        const arr = Object.values(data).sort((a, b) => b.ts - a.ts);
        const isNew = messages.length > 0 && arr.length > messages.length;
        setMessages(arr);
        setNewMsg(true);
        if (!isMsgInitialLoad && arr.length > 0 && arr[0].by !== user.name) {
          playPing();
          if ("Notification" in window && Notification.permission === "granted") {
            try {
              new Notification("New Message", {
                body: `${arr[0].by}: ${arr[0].text || 'Sent an image'}`,
                icon: "/icon-192.png",
                tag: "squad-message"
              });
            } catch (e) {}
          }
        }
      } else setMessages([]);
      isMsgInitialLoad = false;
    });

    // ── Foreground notification listener (DM notifications)
    let notifUnsub = null;
    const notifRef = ref(db, `notifications/${user.uid}`);
    let isNotifInitial = true;
    onValue(notifRef, (snap) => {
      const data = snap.val();
      if (!isNotifInitial && data) {
        // Play siren + buzz for new DM notifications
        const entries = Object.values(data);
        if (entries.length > 0) {
          const latest = entries[entries.length - 1];
          if (latest.ts && Date.now() - latest.ts < 5000) {
            playSiren();
            buzz();
          }
        }
      }
      isNotifInitial = false;
      // Clean up notifications after reading
      if (data) remove(notifRef);
    });

    // ── Unread DM listener for badge
    const dmListRef = ref(db, `dm_list/${user.uid}`);
    onValue(dmListRef, (snap) => {
      const data = snap.val();
      let hasUnread = false;
      if (data) {
        for (const uid in data) {
          if (data[uid].unread > 0) {
            hasUnread = true;
            break;
          }
        }
      }
      setHasUnreadDM(hasUnread);
    });

    // ── FCM onMessage for foreground push
    if (messaging) {
      try {
        notifUnsub = onMessage(messaging, (payload) => {
          playSiren();
          buzz();
          if ("Notification" in window && Notification.permission === "granted") {
            try {
              new Notification(payload.notification?.title || "Squad Alarm", {
                body: payload.notification?.body || "New notification",
                icon: "/icon-192.png",
                tag: "squad-fg-notif",
              });
            } catch (_) {}
          }
        });
      } catch (_) {}
    }

    // ── Voice Lobby Count
    const lobbyRef = ref(db, 'voice_lobby');
    onValue(lobbyRef, (snap) => {
      const data = snap.val();
      if (data) {
        const now = Date.now();
        const count = Object.values(data).filter(info => (now - (info.lastSeen || info.joinedAt || now)) <= 35000).length;
        setLobbyCount(count);
      } else {
        setLobbyCount(0);
      }
    });

    return () => {
      off(alarmRef);
      off(histRef);
      off(msgRef);
      off(notifRef);
      off(lobbyRef);
      if (notifUnsub) notifUnsub();
      clearInterval(sLoop.current);
    };
  }, [phase]);

  /* ── Handlers ─────────────────────────────── */
  const getFriendlyErrorMessage = (error) => {
    if (!error) return "";
    const code = error.code || "";
    const msg = error.message || "";
    if (code === "auth/operation-not-allowed" || msg.includes("operation-not-allowed")) {
      return "This login option is not enabled in your Firebase Console. Please go to the Authentication tab in Firebase and enable 'Email/Password' and 'Twitter' under Sign-in methods.";
    }
    if (code === "auth/invalid-credential" || code === "auth/user-not-found" || code === "auth/wrong-password") {
      return "Incorrect email or password. Please check your credentials and try again.";
    }
    if (code === "auth/email-already-in-use") {
      return "An account with this email already exists.";
    }
    if (code === "auth/weak-password") {
      return "Password should be at least 6 characters.";
    }
    if (code === "auth/invalid-email") {
      return "Please enter a valid email address.";
    }
    if (code === "auth/popup-closed-by-user") {
      return "The login window was closed before completing.";
    }
    return msg || "An error occurred during authentication.";
  };

  const loginWithGoogle = async () => {
    try {
      getCtx();
      setAuthLoading(true);
      setAuthError("");
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
      setAuthError(getFriendlyErrorMessage(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const loginWithTwitter = async () => {
    try {
      getCtx();
      setAuthLoading(true);
      setAuthError("");
      const provider = new TwitterAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
      setAuthError(getFriendlyErrorMessage(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSquadSignUp = async (e) => {
    if (e) e.preventDefault();
    if (!authEmail || !authPassword || !authName) {
      setAuthError("Please fill out all fields.");
      return;
    }
    if (authPassword.length < 6) {
      setAuthError("Password must be at least 6 characters.");
      return;
    }
    try {
      getCtx();
      setAuthLoading(true);
      setAuthError("");
      
      // 1. Create user in Firebase
      const userCredential = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      const firebaseUser = userCredential.user;
      
      // 2. Set display name in Auth profile
      await updateProfile(firebaseUser, { displayName: authName });
      
      // 3. Save details directly to Real-time Database
      const userData = {
        uid: firebaseUser.uid,
        name: authName,
        email: firebaseUser.email,
        photoURL: null,
        joinedAt: Date.now()
      };
      await set(ref(db, "users/" + firebaseUser.uid), userData);
      
    } catch (err) {
      console.error(err);
      setAuthError(getFriendlyErrorMessage(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSquadLogin = async (e) => {
    if (e) e.preventDefault();
    if (!authEmail || !authPassword) {
      setAuthError("Please enter email and password.");
      return;
    }
    try {
      getCtx();
      setAuthLoading(true);
      setAuthError("");
      await signInWithEmailAndPassword(auth, authEmail, authPassword);
    } catch (err) {
      console.error(err);
      setAuthError(getFriendlyErrorMessage(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    if (e) e.preventDefault();
    if (!authEmail) {
      setAuthError("Please enter your email to reset password.");
      return;
    }
    try {
      setAuthLoading(true);
      setAuthError("");
      await sendPasswordResetEmail(auth, authEmail);
      alert("Password reset email sent! Check your inbox.");
      setForgotPass(false);
    } catch (err) {
      console.error(err);
      setAuthError(getFriendlyErrorMessage(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const triggerAlarm = useCallback(async () => {
    if (firing || cooldown > 0 || !user) return;
    setFiring(true);
    const a = {
      id: String(Date.now()),
      by: user.name,
      byPhoto: user.photoURL || null,
      ts: Date.now()
    };
    try {
      await set(ref(db, "alarm"), a);
      await push(ref(db, "history"), a);
      lastId.current = a.id;
      setOverlay(true); setNewAlarm(true);
      playSiren(); buzz();
      // Start 30-second cooldown
      setCooldown(30);
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      cooldownRef.current = setInterval(() => {
        setCooldown(prev => {
          if (prev <= 1) { clearInterval(cooldownRef.current); return 0; }
          return prev - 1;
        });
      }, 1000);
    } catch { alert("Could not send alarm. Check your connection."); }
    setFiring(false);
  }, [firing, cooldown, user]);

  const postMessage = useCallback(async () => {
    if ((!msgText.trim() && !msgPhoto) || posting || !user) return;
    setPosting(true);
    const m = {
      id: String(Date.now()),
      by: user.name,
      byUid: user.uid,
      byPhoto: user.photoURL || null,
      text: msgText.trim() || null,
      photo: msgPhoto || null,
      ts: Date.now()
    };
    try {
      playPop();
      await push(ref(db, "messages"), m);
      setMsgText(""); setMsgPhoto(null);
    } catch { alert("Could not send message."); }
    setPosting(false);
  }, [msgText, msgPhoto, posting, user]);

  const handlePhotoSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const compressed = await compressImage(file);
    setMsgPhoto(compressed);
    e.target.value = "";
  };

  const dismiss = () => { setOverlay(false); clearInterval(sLoop.current); };

  /* ── Sub-renders ──────────────────────────── */
  const renderHome = () => (
    <div className="home">
      <div className="status-card">
        <div className="sc-left">
          <div className="sc-label">Team Status</div>
          <div className="sc-value">Squad Alarm</div>
        </div>
        <div>
          {alarm
            ? <div className="sc-alert">⚡ Last alarm {fmtRelative(alarm.ts)}</div>
            : <div className="sc-ok">✓ All clear</div>}
        </div>
      </div>

      <div className="alarm-zone">
        <button className={`alarm-btn${(firing||cooldown>0)?" quiet":""}`} onClick={triggerAlarm} disabled={firing||cooldown>0}>
          <div className="btn-shine"/>
          <div className="btn-inner">
            <div className="btn-emoji">{firing?"⏳":cooldown>0?"⏱️":"🚨"}</div>
            <div className="btn-word">{firing?"SENDING":cooldown>0?`WAIT ${cooldown}s`:"ALARM"}</div>
            <div className="btn-sub">{firing?"Alerting your team…":cooldown>0?"Cooldown active — prevents spam":"Tap to alert all team members"}</div>
          </div>
        </button>
        <div className="alarm-hint">⚡ Real-time • Everyone gets siren + vibration instantly</div>
      </div>

      {/* Recent messages */}
      <div className="section-hd">
        <span className="section-title">Recent Messages</span>
        <span className="section-link" onClick={()=>setTab("messages")}>See all →</span>
      </div>
      <div className="recent-list">
        {messages.length === 0
          ? <div className="empty" style={{paddingTop:60}}>
              <div className="empty-icon">💬</div>
              <div className="empty-label">NO MESSAGES YET</div>
            </div>
          : messages.slice(0,3).map(m => (
            <div key={m.id} className="msg-card">
              <div style={{ cursor: "pointer" }} onClick={() => {
                if (m.byUid && m.byUid !== user.uid) {
                  const targetUser = allUsers[m.byUid];
                  if (targetUser) {
                    setSelectedProfile({ uid: targetUser.uid, name: targetUser.name, photoURL: targetUser.photoURL, email: targetUser.email, joinedAt: targetUser.joinedAt });
                  } else {
                    setSelectedProfile({ uid: m.byUid, name: m.by, photoURL: m.byPhoto, email: "Unknown", joinedAt: Date.now() });
                  }
                }
              }}>
                <Avatar name={m.by} photo={m.byPhoto} size={36} />
              </div>
              <div className="mc-right">
                <div className="mc-top">
                  <span className="mc-name">{m.by}</span>
                  <span className="mc-time">{fmtRelative(m.ts)}</span>
                </div>
                {m.text && <div className="mc-text">{m.text}</div>}
                {m.photo && <img src={m.photo} className="mc-img" alt="attachment" onClick={()=>setFullImg(m.photo)}/>}
              </div>
            </div>
          ))
        }
      </div>

      {/* Recent alarms */}
      {history.length > 0 && <>
        <div className="section-hd">
          <span className="section-title">Recent Alarms</span>
          <span className="section-link" onClick={()=>setTab("log")}>Full log →</span>
        </div>
        <div className="recent-list">
          {history.slice(0,2).map(e => (
            <div key={e.id} className="alarm-entry">
              <Avatar name={e.by} photo={e.byPhoto} size={28} />
              <div className="ae-body">
                <div className="ae-who">{e.by}</div>
                <div className="ae-when">{fmtDate(e.ts)}</div>
              </div>
            </div>
          ))}
        </div>
      </>}
      <div style={{height:12}}/>
    </div>
  );

  const deleteGroupMessage = useCallback(async (msgKey) => {
    if (!isHost) return;
    if (!confirm("Delete this message?")) return;
    const msgRef = ref(db, "messages");
    onValue(msgRef, (snap) => {
      const data = snap.val();
      if (data) {
        const entry = Object.entries(data).find(([, v]) => v.id === msgKey);
        if (entry) remove(ref(db, `messages/${entry[0]}`));
      }
    }, { onlyOnce: true });
  }, [isHost]);

  const renderMembers = () => (
    <div className="msgs-wrap">
      <div className="msgs-list">
        {Object.values(allUsers).map(u => (
          <div key={u.uid} className="msg-card" onClick={() => setSelectedProfile(u)} style={{cursor:'pointer'}}>
            <Avatar name={u.name} photo={u.photoURL}/>
            <div className="mc-right">
              <div className="mc-name">{u.name} {u.uid === hostUid ? '👑' : ''}</div>
              <div className="mc-text" style={{fontSize:10,color:'#64748b'}}>{u.email}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const ProfileModal = () => selectedProfile && (
    <div className="img-fullscreen" onClick={()=>setSelectedProfile(null)}>
      <div className="setup-card" onClick={e=>e.stopPropagation()} style={{maxWidth:300}}>
        <Avatar name={selectedProfile.name} photo={selectedProfile.photoURL} size={80}/>
        <div style={{fontSize:20,fontWeight:800,marginTop:16}}>{selectedProfile.name}</div>
        <div style={{fontSize:12,color:"#64748b",marginBottom:20}}>{selectedProfile.email}</div>
        {selectedProfile.joinedAt && <div style={{fontSize:10,color:"#475569"}}>Joined {new Date(selectedProfile.joinedAt).toLocaleDateString()}</div>}
        <div style={{display:'flex', gap:10, marginTop:20, width:'100%'}}>
          <button className="test-btn" style={{flex:1}} onClick={()=>setSelectedProfile(null)}>Close</button>
          {selectedProfile.uid !== user?.uid && (
            <button className="test-btn" style={{flex:1, background:'#2563eb', color:'#fff', borderColor:'#3b82f6'}} onClick={() => {
              setDmTarget({ uid: selectedProfile.uid, name: selectedProfile.name, photoURL: selectedProfile.photoURL });
              setTab("calls");
              setSelectedProfile(null);
            }}>💬 Chat</button>
          )}
        </div>
      </div>
    </div>
  );

  const renderMessages = () => (
    <div className="msgs-wrap">
      <div className="msgs-list">
        {messages.length === 0
          ? <div className="empty">
              <div className="empty-icon">💬</div>
              <div className="empty-label">NO MESSAGES YET<br/>SAY SOMETHING TO YOUR TEAM</div>
            </div>
          : messages.map(m => (
            <div key={m.id} className="msg-card" style={{position:'relative'}}>
              <div 
                style={{cursor: m.byUid && m.byUid !== user.uid ? 'pointer' : 'default', flexShrink: 0}}
                onClick={() => {
                  if (m.byUid && m.byUid !== user.uid) {
                    const targetUser = allUsers[m.byUid];
                    if (targetUser) setSelectedProfile(targetUser);
                    else {
                        setDmTarget({ uid: m.byUid, name: m.by, photoURL: m.byPhoto });
                        setTab("calls");
                    }
                  }
                }}
              >
                <Avatar name={m.by} photo={m.byPhoto}/>
              </div>
              <div className="mc-right">
                <div className="mc-top">
                  <span className="mc-name">{m.by}</span>
                  <span className="mc-time">{fmtRelative(m.ts)}</span>
                </div>
                {m.text && <div className="mc-text">{m.text}</div>}
                {m.photo && <img src={m.photo} className="mc-img" alt="attachment" onClick={()=>setFullImg(m.photo)}/>}
              </div>
              {isHost && (
                <button
                  onClick={()=>deleteGroupMessage(m.id)}
                  title="Delete message (Host)"
                  style={{position:'absolute',top:6,right:6,width:24,height:24,borderRadius:'50%',background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.2)',color:'#ef4444',fontSize:11,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',opacity:0.4,transition:'opacity 0.15s'}}
                  onMouseEnter={e=>e.currentTarget.style.opacity='1'}
                  onMouseLeave={e=>e.currentTarget.style.opacity='0.4'}
                >
                  🗑
                </button>
              )}
            </div>
          ))
        }
      </div>

      {/* Input area */}
      <div className="msg-input-zone">
        {msgPhoto && (
          <div className="msg-photo-preview">
            <img src={msgPhoto} alt="preview"/>
            <button className="msg-remove-photo" onClick={()=>setMsgPhoto(null)}>✕</button>
          </div>
        )}
        <div className="msg-input-row">
          <button className="msg-photo-btn" onClick={()=>fileInput.current?.click()} title="Attach photo">
            📷
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            style={{display:"none"}}
            onChange={handlePhotoSelect}
          />
          <textarea
            className="msg-textarea"
            placeholder={`Message your team, ${user?.name?.split(" ")[0]}…`}
            value={msgText}
            onChange={e=>setMsgText(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&(e.preventDefault(),postMessage())}
            rows={1}
          />
          <button
            className="msg-send-btn"
            onClick={postMessage}
            disabled={(!msgText.trim()&&!msgPhoto)||posting}
          >
            {posting ? "…" : "➤"}
          </button>
        </div>
      </div>
    </div>
  );

  const renderLog = () => (
    <div className="log-wrap">
      {history.length === 0
        ? <div className="empty" style={{paddingTop:60}}>
            <div className="empty-icon">🚨</div>
            <div className="empty-label">NO ALARMS TRIGGERED YET</div>
          </div>
        : history.map((e,i) => (
          <div key={e.id} className="log-entry">
            <div className="le-num">#{i+1}</div>
            <Avatar name={e.by} photo={e.byPhoto} size={28} />
            <div className="le-body">
              <div className="le-who">
                <span>{e.by}</span>
                <span className="le-when-rel">{fmtRelative(e.ts)}</span>
              </div>
              <div className="le-full">{fmtFull(e.ts)}</div>
            </div>
          </div>
        ))
      }
    </div>
  );

  const renderSettings = () => (
    <div className="settings">
      {user && (
        <div className="setting-section" style={{marginBottom:12}}>
          <div style={{padding:"16px 16px 12px",display:"flex",alignItems:"center",gap:12,borderBottom:"1px solid rgba(255,255,255,.05)", cursor:"pointer"}} onClick={() => setSelectedProfile({uid: user.uid, name: user.name, photoURL: user.photoURL, email: user.email, joinedAt: user.joinedAt})}>
            <Avatar name={user.name} photo={user.photoURL} size={44}/>
            <div>
              <div style={{fontSize:17,fontWeight:800,color:"#f1f5f9"}}>
                {user.name} {isHost && <span style={{fontSize:14}} title="Host">👑</span>}
              </div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#475569"}}>
                Member since {new Date(user.joinedAt).toLocaleDateString([],{month:"short",day:"numeric",year:"numeric"})}
              </div>
            </div>
          </div>
          <div className="setting-row">
            <div className="sr-left"><div className="sr-label">Sign Out</div><div className="sr-sub">Sign out of your Google account</div></div>
            <button className="test-btn" onClick={async ()=>{if(confirm("Are you sure you want to sign out?"))await signOut(auth);}}>Sign Out</button>
          </div>
        </div>
      )}

      <div className="setting-section">
        <div className="setting-row">
          <div className="sr-left"><div className="sr-label">🔊 Test Siren</div><div className="sr-sub">Make sure sound works</div></div>
          <button className="test-btn" onClick={()=>{getCtx();playSiren();buzz();}}>Test</button>
        </div>
        <div className="setting-row">
          <div className="sr-left"><div className="sr-label">📳 Vibration</div><div className="sr-sub">Works on Android · iOS limited</div></div>
          <button className="test-btn" onClick={()=>buzz()}>Test</button>
        </div>
          <div className="setting-row">
            <div className="sr-left"><div className="sr-label">🔔 Notifications</div><div className="sr-sub">Get alerts when app is open in background</div></div>
            <button className="test-btn" onClick={async()=>{
              if ("Notification" in window) {
                const perm = await Notification.requestPermission();
                alert(perm === "granted" ? "Notifications Enabled!" : "Notifications Blocked.");
              } else alert("Browser does not support notifications.");
            }}>Enable</button>
          </div>
          <div className="setting-row">
            <div className="sr-left"><div className="sr-label">⚡ Sync Mode</div><div className="sr-sub">Firebase Real-time Database</div></div>
            <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#22c55e"}}>● LIVE</span>
          </div>
      </div>

      <div className="info-box">
        <div className="info-title">📡 HOW IT WORKS</div>
        <div className="info-line">This app is connected to <b>Google Firebase</b> in real-time. When anyone presses ALARM, <b>every device gets it instantly</b> — no matter where in the world they are.</div>
      </div>

      {isHost && (
        <div className="setting-section" style={{marginBottom:0}}>
          <div style={{padding:"16px 16px 12px",borderBottom:"1px solid rgba(255,255,255,.05)",marginBottom:8}}>
            <div style={{fontSize:15,fontWeight:800,color:"#f1f5f9",display:"flex",alignItems:"center",gap:8}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
              COMMAND CENTER
            </div>
            <div style={{fontSize:12,color:"#94a3b8",marginTop:4}}>Live analytics and moderation</div>
          </div>
          
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,padding:"0 16px 16px"}}>
            <div style={{background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.06)",borderRadius:12,padding:"14px",display:"flex",flexDirection:"column",alignItems:"center"}}>
              <div style={{fontSize:24,fontWeight:800,color:"#38bdf8"}}>{messages.length}</div>
              <div style={{fontSize:10,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.05em",marginTop:2}}>Total Messages</div>
            </div>
            <div style={{background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.06)",borderRadius:12,padding:"14px",display:"flex",flexDirection:"column",alignItems:"center"}}>
              <div style={{fontSize:24,fontWeight:800,color:"#22c55e"}}>{lobbyCount}</div>
              <div style={{fontSize:10,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.05em",marginTop:2}}>Active In War Room</div>
            </div>
          </div>

          <div className="setting-row">
            <div className="sr-left"><div className="sr-label" style={{color:"#f87171"}}>Clear All Messages</div><div className="sr-sub">Removes all team messages</div></div>
            <button className="test-btn" style={{color:"#ef4444",borderColor:"rgba(239,68,68,.2)"}} onClick={async()=>{
              if(confirm("Are you sure you want to clear all messages?")) {
                await remove(ref(db, "messages"));
                alert("Chat cleared.");
              }
            }}>Clear</button>
          </div>
          <div className="setting-row">
            <div className="sr-left"><div className="sr-label" style={{color:"#f87171"}}>Clear Alarm Log</div><div className="sr-sub">Erases the emergency history</div></div>
            <button className="test-btn" style={{color:"#ef4444",borderColor:"rgba(239,68,68,.2)"}} onClick={async()=>{
              if(confirm("Are you sure you want to clear the alarm log?")) {
                await remove(ref(db, "history"));
                alert("Alarm history cleared.");
              }
            }}>Clear</button>
          </div>
        </div>
      )}

      <div className="setting-section">
        <div className="setting-row">
          <div className="sr-left"><div className="sr-label">👑 Host Controls</div><div className="sr-sub">{isHost ? "You are the Host" : "Standard User"}</div></div>
          {!hostUid && !isHost && <button className="test-btn" style={{color:"#f59e0b",borderColor:"rgba(245,158,11,.2)"}} onClick={async()=>{
            const pwd = prompt("Enter secret password to claim Host role:");
            if(pwd === "4549") {
              await set(ref(db, "host"), user.uid);
              alert("You are now the Host!");
            } else if(pwd) alert("Incorrect password.");
          }}>Claim Host</button>}
          {isHost && <button className="test-btn" style={{color:"#ef4444",borderColor:"rgba(239,68,68,.2)"}} onClick={async()=>{
            if(confirm("Relinquish Host role?")) await remove(ref(db, "host"));
          }}>Relinquish</button>}
        </div>
        <div className="setting-row">
          <div className="sr-left"><div className="sr-label">Share with Team</div><div className="sr-sub">Anyone with the link can join</div></div>
        </div>
        <div style={{padding:"0 16px 14px"}}>
          <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:11,padding:"10px 14px",fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#475569",lineHeight:1.8}}>
            1. Copy the URL of this page<br/>
            2. Send it to each teammate<br/>
            3. They open it and log in with Google<br/>
            4. You're all connected instantly
          </div>
        </div>
      </div>

      {isHost && (
        <div className="setting-section">
          <div className="setting-row">
            <div className="sr-left"><div className="sr-label" style={{color:"#f87171"}}>Clear All Messages</div><div className="sr-sub">Removes all team messages</div></div>
            <button className="test-btn" style={{color:"#f87171",borderColor:"rgba(239,68,68,.2)"}} onClick={async()=>{if(!confirm("Clear all messages?"))return;await remove(ref(db,"messages"));setMessages([]);}}>Clear</button>
          </div>
          <div className="setting-row">
            <div className="sr-left"><div className="sr-label" style={{color:"#f87171"}}>Clear Alarm Log</div><div className="sr-sub">Removes alarm history</div></div>
            <button className="test-btn" style={{color:"#f87171",borderColor:"rgba(239,68,68,.2)"}} onClick={async()=>{if(!confirm("Clear alarm log?"))return;await remove(ref(db,"alarm"));await remove(ref(db,"history"));setAlarm(null);setHistory([]);lastId.current="";}}>Clear</button>
          </div>
        </div>
      )}
      <div style={{height:20}}/>
    </div>
  );

  /* ── Screens ──────────────────────────────── */
  if (phase === "loading") return (
    <><style>{CSS}</style>
    <div className="loading">
      <div className="spin">🚨</div>
      <div style={{fontSize:10,color:"#334155",letterSpacing:".2em"}}>CONNECTING…</div>
    </div></>
  );

  if (phase === "setup") return (
    <><style>{CSS}</style>
    <div className="setup-bg">
      <div className="setup-card">
        <div className="setup-logo">🚨</div>
        <div className="setup-h1">SQUAD ALARM</div>
        <div className="setup-tagline">Real-time instant alert for your entire team — one tap, everyone reacts.</div>
        <div className="how-works">
          <div className="hw-title">HOW IT WORKS</div>
          {[
            ["Tap ALARM","Everyone's phone sounds + vibrates instantly"],
            ["Send Messages","Chat with photos — synced in real-time"],
            ["Stay Alert","Powered by Google Firebase — live sync worldwide"]
          ].map(([t,d],i)=>(
            <div key={i} className="hw-step"><div className="hw-num">{i+1}</div><div className="hw-text"><b style={{color:"#94a3b8"}}>{t}</b> — {d}</div></div>
          ))}
        </div>
        
        <div className="divider"/>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginTop: 8 }}>
          {/* Social Sign In Options */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' }}>
            <button className="social-btn google" onClick={loginWithGoogle} title="Sign in with Google" disabled={authLoading}>
              <svg viewBox="0 0 24 24" width="18" height="18" style={{ marginRight: 6 }}>
                <path fill="#EA4335" d="M5.266 9.765C6.199 6.939 8.854 4.909 12 4.909c1.69 0 3.218.6 4.418 1.582L19.91 3C17.782 1.145 15.055 0 12 0 7.359 0 3.327 2.695 1.341 6.627l3.925 3.138z"/>
                <path fill="#34A853" d="M16.04 18.013c-1.09.704-2.474 1.078-4.04 1.078-3.146 0-5.801-2.03-6.734-4.856l-3.925 3.137C3.327 21.305 7.359 24 12 24c3.006 0 6.066-1.105 8.256-3.025l-4.215-2.962z"/>
                <path fill="#4285F4" d="M24 12c0-.873-.095-1.625-.245-2.455H12v4.582h6.725c-.566 2.465-1.902 3.362-2.684 3.885l4.215 2.963C22.821 18.662 24 15.393 24 12z"/>
                <path fill="#FBBC05" d="M5.266 9.765C5.013 10.535 4.873 11.356 4.873 12c0 .644.14 1.465.393 2.235L1.34 17.373C.485 15.671 0 13.889 0 12c0-1.889.485-3.671 1.341-5.373l3.925 3.138z"/>
              </svg>
              Google
            </button>
            
            <button className="social-btn twitter" onClick={loginWithTwitter} title="Sign in with X (Twitter)" disabled={authLoading}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{ marginRight: 6 }}>
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
              X / Twitter
            </button>
          </div>

          <div className="form-divider">
            <span>or use a squad account</span>
          </div>

          {authError && (
            <div className="auth-error-banner">
              ⚠️ {authError}
            </div>
          )}

          <form onSubmit={forgotPass ? handleResetPassword : isSignUp ? handleSquadSignUp : handleSquadLogin} style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
            {isSignUp && !forgotPass && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="field-label">Your Name</span>
                <input
                  type="text"
                  placeholder="e.g. John Doe"
                  className="setup-input"
                  value={authName}
                  onChange={e => setAuthName(e.target.value)}
                  disabled={authLoading}
                  required
                />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="field-label">Email Address</span>
              <input
                type="email"
                placeholder="you@squad.com"
                className="setup-input"
                value={authEmail}
                onChange={e => setAuthEmail(e.target.value)}
                disabled={authLoading}
                required
              />
            </div>

            {!forgotPass && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="field-label">Password</span>
                <input
                  type="password"
                  placeholder="••••••••"
                  className="setup-input"
                  value={authPassword}
                  onChange={e => setAuthPassword(e.target.value)}
                  disabled={authLoading}
                  required
                />
              </div>
            )}

            <button type="submit" className="join-btn" style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }} disabled={authLoading}>
              {authLoading ? (
                <span className="auth-spinner"></span>
              ) : forgotPass ? (
                "SEND PASSWORD RESET"
              ) : isSignUp ? (
                "CREATE SQUAD ACCOUNT"
              ) : (
                "LOG IN TO SQUAD"
              )}
            </button>
          </form>

          {/* Form switch links */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', marginTop: 8, fontSize: 12 }}>
            {forgotPass ? (
              <span className="auth-link" onClick={() => { setForgotPass(false); setAuthError(""); }}>
                ← Back to Login
              </span>
            ) : (
              <>
                <span className="auth-link" onClick={() => { setIsSignUp(!isSignUp); setAuthError(""); }}>
                  {isSignUp ? "Already have a Squad account? Log In" : "Need a Squad account? Create one"}
                </span>
                {!isSignUp && (
                  <span className="auth-link-forgot" onClick={() => { setForgotPass(true); setAuthError(""); }}>
                    Forgot Password?
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="setup-warn" style={{ marginTop: 12 }}>
          ⚠️ Alarms and messages are shared with everyone who opens this app.<br/>Share this link only with your teammates.
        </div>
      </div>
    </div></>
  );

  /* MAIN */
  const TABS = [
    { id: "home",     icon: "🏠", label: "Home"     },
    { id: "messages", icon: "💬", label: "Messages" },
    { id: "members",  icon: "👥", label: "Members"  },
    { id: "voice",    icon: "🎙️", label: "War Room" },
    { id: "calls",    icon: "💬", label: "DMs"      },
    { id: "log",      icon: "🚨", label: "Log"      },
    { id: "settings", icon: "⚙️", label: "Settings" },
  ];

  return (
    <><style>{CSS}</style>

    {/* Full-screen image viewer */}
    {fullImg && (
      <div className="img-fullscreen" onClick={()=>setFullImg(null)}>
        <img src={fullImg} alt="full view"/>
      </div>
    )}

    <div className="app">

      {/* OVERLAY ALARM */}
      {overlay && alarm && (
        <div className="ov">
          <div className="ov-lines"/>
          <div className="ov-card">
            <div className="ov-icon">🚨</div>
            <div className="ov-word">ALARM</div>
            <div className="ov-badge">EMERGENCY ALERT</div>
            <Avatar name={alarm.by} photo={alarm.byPhoto} size={52} />
            <div className="ov-who">{alarm.by}</div>
            <div className="ov-time">{fmtFull(alarm.ts)}</div>
            <button className="ov-dismiss" onClick={dismiss}>✓ &nbsp; DISMISS</button>
          </div>
        </div>
      )}

      {/* 1-on-1 Call Overlay — rendered outside tab-body for persistence */}

      {/* STATUS BAR */}
      <div className="sb">
        <div className="sb-left">
          <div className="sb-dot"/>
          <span className="sb-title">SQUAD ALARM</span>
          {(newMsg || newAlarm) && (
            <div style={{ background: '#ef4444', borderRadius: '10px', padding: '2px 6px', fontSize: '10px', color: '#fff', fontWeight: 'bold', marginLeft: '6px', animation: 'pulse 1.5s infinite' }}>NEW</div>
          )}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}} onClick={() => setTab("settings")}>
          <span className="sb-chip">{user?.name}</span>
          <Avatar name={user?.name || ""} photo={user?.photoURL} size={24} />
        </div>
      </div>

      {/* CONTENT */}
      <div className="tab-body">
        {tab === "home"     && renderHome()}
        {tab === "messages" && renderMessages()}
        {tab === "members"  && renderMembers()}
        <div style={{ display: tab === "calls" ? "block" : "none", height: "100%" }}>
          <DirectMessages ref={dmRef} user={user} db={db} isHost={isHost} dmTarget={dmTarget} onClearTarget={() => setDmTarget(null)} playPop={playPop} playPing={playPing} />
        </div>
        {tab === "log"      && renderLog()}
        {tab === "settings" && renderSettings()}
        <div style={{ display: tab === "voice" ? "block" : "none", height: "100%" }}>
          <VoiceRoom user={user} db={db} />
        </div>
      </div>
      <ProfileModal />

      {/* BOTTOM NAV */}
      <div className="bnav">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`bnav-btn${tab===t.id?" active":""}`}
            onClick={()=>{
              setTab(t.id);
              if(t.id==="log")setNewAlarm(false);
              if(t.id==="messages")setNewMsg(false);
              if(t.id==="calls" && dmRef.current) dmRef.current.resetToList();
            }}
          >
            <div className="bnav-icon bnav-badge">
              {t.icon}
              {t.id==="log"      && newAlarm && tab!=="log"      && <div className="badge-dot"/>}
              {t.id==="messages" && newMsg   && tab!=="messages" && <div className="badge-dot"/>}
              {t.id==="calls"    && hasUnreadDM && tab!=="calls" && <div className="badge-dot"/>}
            </div>
            <div className="bnav-label">{t.label}</div>
          </button>
        ))}
      </div>

      {/* Floating Call Overlay — always mounted, renders incoming/active call UI */}
      <CallOverlay user={user} db={db} />

    </div></>
  );
}
