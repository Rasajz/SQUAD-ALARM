import { useState, useEffect, useRef, useCallback } from "react";

// Fallback for window.storage if running outside Claude Artifacts sandbox
if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    _isMock: true,
    get: async (key, isShared) => {
      try {
        const val = window.localStorage.getItem(key);
        return val ? { value: val } : null;
      } catch {
        return null;
      }
    },
    set: async (key, value, isShared) => {
      try {
        window.localStorage.setItem(key, value);
      } catch (e) {
        console.error("Failed to write to localStorage", e);
      }
    },
    delete: async (key) => {
      try {
        window.localStorage.removeItem(key);
      } catch (e) {
        console.error("Failed to delete from localStorage", e);
      }
    }
  };
}

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
    const DUR = 3.2;

    const osc  = ctx.createOscillator();   // main wail
    const osc2 = ctx.createOscillator();   // harmony layer
    const lfo  = ctx.createOscillator();   // frequency sweeper
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
    osc2.type = "square";   osc2.frequency.value = 830;  // slight detune = beating

    g2.gain.value = 0.28;

    osc.connect(g1); osc2.connect(g2);
    g1.connect(mix); g2.connect(mix);
    mix.connect(ctx.destination);

    mix.gain.setValueAtTime(0,   now);
    mix.gain.linearRampToValueAtTime(0.45, now + 0.06);
    mix.gain.setValueAtTime(0.45, now + DUR - 0.18);
    mix.gain.linearRampToValueAtTime(0,   now + DUR);

    [lfo, osc, osc2].forEach(n => { n.start(now); n.stop(now + DUR); });
  } catch (_) {}
}
function beep() {
  try {
    const ctx = getCtx();
    [[1047,0,.13],[1047,.18,.13],[1047,.36,.13],[784,.56,.32]].forEach(([f,t,d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = "square"; o.frequency.value = f;
      const s = ctx.currentTime + t;
      g.gain.setValueAtTime(0,s); g.gain.linearRampToValueAtTime(.38,s+.012);
      g.gain.setValueAtTime(.38,s+d-.018); g.gain.linearRampToValueAtTime(0,s+d);
      o.start(s); o.stop(s+d+.02);
    });
  } catch (_) {}
}
function buzz() { try { navigator.vibrate?.([300,80,300,80,500]); } catch (_) {} }

/* ══════════════════════════════════════════════════
   DATE HELPERS
══════════════════════════════════════════════════ */
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

function Avatar({ name, size = 36 }) {
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
   STORAGE
══════════════════════════════════════════════════ */
const SK = "squad:app:v5";   // shared state
const UK = "squad:user:v2";  // personal user

const DEF = { alarm:null, notes:[], history:[] };

async function readShared() {
  try { const r = await window.storage.get(SK,true); return r?.value ? JSON.parse(r.value) : {...DEF}; }
  catch { return {...DEF}; }
}
async function writeShared(patch) {
  const cur = await readShared();
  const next = { ...cur, ...patch };
  await window.storage.set(SK, JSON.stringify(next), true);
  return next;
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
.alarm-hint{font-family:'JetBrains Mono',monospace;font-size:9px;color:#1e293b;text-align:center;letter-spacing:.08em;max-width:300px;}

.section-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 8px;}
.section-title{font-size:11px;font-weight:700;color:#334155;letter-spacing:.12em;text-transform:uppercase;}
.section-link{font-size:11px;font-weight:600;color:#3b82f6;cursor:pointer;}

.recent-list{display:flex;flex-direction:column;gap:0;padding:0 14px 16px;}

/* ── ALARM HISTORY CARD ────────────────────── */
.alarm-entry{display:flex;align-items:center;gap:12px;padding:11px 14px;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.15);border-radius:14px;margin-bottom:7px;}
.ae-icon{font-size:22px;flex-shrink:0;}
.ae-body{flex:1;min-width:0;}
.ae-who{font-size:14px;font-weight:700;color:#fca5a5;}
.ae-when{font-family:'JetBrains Mono',monospace;font-size:10px;color:#475569;margin-top:1px;}
.ae-full{font-family:'JetBrains Mono',monospace;font-size:9px;color:#334155;margin-top:2px;}

/* ── NOTES ─────────────────────────────────── */
.notes-wrap{display:flex;flex-direction:column;height:100%;overflow:hidden;}
.note-input-zone{padding:12px 14px 8px;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0;}
.note-textarea{width:100%;padding:12px 14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:14px;color:#e2e8f0;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:500;outline:none;resize:none;min-height:52px;max-height:100px;transition:border-color .15s;line-height:1.5;}
.note-textarea:focus{border-color:rgba(59,130,246,.4);}
.note-textarea::placeholder{color:#1e293b;}
.note-row{display:flex;justify-content:flex-end;margin-top:8px;gap:8px;}
.post-btn{padding:9px 20px;background:#1d4ed8;border:none;border-radius:11px;color:#fff;font-family:'DM Sans',sans-serif;font-weight:700;font-size:13px;cursor:pointer;transition:all .15s;letter-spacing:.03em;}
.post-btn:disabled{opacity:.35;cursor:default;}
.post-btn:not(:disabled):active{transform:scale(.96);background:#2563eb;}
.notes-list{flex:1;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:8px;}
.note-card{display:flex;gap:11px;padding:12px 14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:16px;animation:slideUp .22s ease-out;}
@keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.nc-right{flex:1;min-width:0;}
.nc-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:4px;}
.nc-name{font-size:13px;font-weight:700;color:#e2e8f0;}
.nc-time{font-family:'JetBrains Mono',monospace;font-size:9px;color:#334155;flex-shrink:0;}
.nc-date{font-family:'JetBrains Mono',monospace;font-size:10px;color:#475569;margin-bottom:4px;}
.nc-text{font-size:14px;font-weight:500;color:#cbd5e1;line-height:1.5;word-break:break-word;}
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;gap:8px;flex:1;}
.empty-icon{font-size:36px;opacity:.25;}
.empty-label{font-family:'JetBrains Mono',monospace;font-size:10px;color:#1e293b;letter-spacing:.15em;text-align:center;}

/* ── LOG TAB ─────────────────────────────────── */
.log-wrap{padding:10px 14px;display:flex;flex-direction:column;gap:7px;}
.log-entry{display:flex;align-items:flex-start;gap:12px;padding:13px 14px;background:rgba(239,68,68,.05);border:1px solid rgba(239,68,68,.12);border-radius:16px;}
.le-num{font-family:'JetBrains Mono',monospace;font-size:10px;color:#334155;width:20px;flex-shrink:0;padding-top:2px;}
.le-body{flex:1;}
.le-who{font-size:14px;font-weight:700;color:#fca5a5;display:flex;align-items:center;gap:6px;}
.le-when-rel{font-size:12px;font-weight:600;color:#ef4444;}
.le-full{font-family:'JetBrains Mono',monospace;font-size:10px;color:#475569;margin-top:3px;line-height:1.5;}

/* ── SETTINGS TAB ────────────────────────────── */
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

/* ── BOTTOM NAV ──────────────────────────────── */
.bnav{display:flex;background:rgba(10,12,18,.95);border-top:1px solid rgba(255,255,255,.08);flex-shrink:0;padding-bottom:env(safe-area-inset-bottom);}
.bnav-btn{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10px 4px 8px;cursor:pointer;border:none;background:transparent;color:#334155;transition:color .15s;gap:3px;}
.bnav-btn.active{color:#e2e8f0;}
.bnav-icon{font-size:20px;line-height:1;}
.bnav-label{font-size:9px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;}
.bnav-badge{position:relative;}
.badge-dot{position:absolute;top:-2px;right:-4px;width:7px;height:7px;border-radius:50%;background:#ef4444;border:1.5px solid #07090d;}

/* ── SETUP SCREEN ────────────────────────────── */
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
.setup-warn{font-family:'JetBrains Mono',monospace;font-size:9px;color:#334155;text-align:center;line-height:1.7;max-width:290px;}
.how-works{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:12px 14px;width:100%;}
.hw-title{font-size:11px;font-weight:700;color:#334155;letter-spacing:.1em;margin-bottom:8px;}
.hw-step{display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;}
.hw-num{width:18px;height:18px;border-radius:50%;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#f87171;flex-shrink:0;margin-top:1px;}
.hw-text{font-size:11px;color:#475569;line-height:1.5;}

/* ── LOADING ─────────────────────────────────── */
.loading{height:100dvh;background:#07090d;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;font-family:'JetBrains Mono',monospace;}
.spin{font-size:40px;animation:spin 1s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}
`;

/* ══════════════════════════════════════════════════
   APP
══════════════════════════════════════════════════ */
export default function SquadAlarm() {
  const [phase,   setPhase]   = useState("loading");
  const [user,    setUser]    = useState(null);    // {name, joinedAt}
  const [nameIn,  setNameIn]  = useState("");
  const [tab,     setTab]     = useState("home");

  const [alarm,   setAlarm]   = useState(null);
  const [notes,   setNotes]   = useState([]);
  const [history, setHistory] = useState([]);
  const [overlay, setOverlay] = useState(false);
  const [newAlarm,setNewAlarm]= useState(false);

  const [firing,  setFiring]  = useState(false);
  const [noteIn,  setNoteIn]  = useState("");
  const [posting, setPosting] = useState(false);

  const lastId  = useRef("");
  const pollRef = useRef(null);
  const sLoop   = useRef(null);

  /* ── Init ─────────────────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(UK);
        if (r?.value) { setUser(JSON.parse(r.value)); setPhase("main"); }
        else setPhase("setup");
      } catch { setPhase("setup"); }
    })();
  }, []);

  /* ── Poll ─────────────────────────────────── */
  useEffect(() => {
    if (phase !== "main") return;

    const tick = async () => {
      try {
        const st = await readShared();
        setNotes(st.notes   || []);
        setHistory(st.history || []);
        if (st.alarm && st.alarm.id !== lastId.current) {
          lastId.current = st.alarm.id;
          setAlarm(st.alarm);
          setOverlay(true);
          setNewAlarm(true);
          playSiren(); buzz();
          clearInterval(sLoop.current); let c = 0;
          sLoop.current = setInterval(() => {
            playSiren(); buzz();
            if (++c >= 3) clearInterval(sLoop.current);
          }, 3400);
        }
      } catch (_) {}
    };

    tick();
    pollRef.current = setInterval(tick, 1800);
    return () => { clearInterval(pollRef.current); clearInterval(sLoop.current); };
  }, [phase]);

  /* ── Handlers ─────────────────────────────── */
  const join = async () => {
    const n = nameIn.trim(); if (!n) return;
    getCtx(); // warm up audio
    const u = { name: n, joinedAt: Date.now() };
    try { await window.storage.set(UK, JSON.stringify(u)); } catch (_) {}
    setUser(u); setPhase("main");
  };

  const triggerAlarm = useCallback(async () => {
    if (firing) return;
    setFiring(true);
    const a = { id: String(Date.now()), by: user.name, ts: Date.now() };
    try {
      const st = await readShared();
      const hist = [a, ...(st.history||[])].slice(0,30);
      await writeShared({ alarm: a, history: hist });
      lastId.current = a.id;
      setAlarm(a); setHistory(hist);
      setOverlay(true); setNewAlarm(true);
      playSiren(); buzz();
    } catch (_) { alert("Could not send alarm. Check your connection."); }
    setFiring(false);
  }, [firing, user]);

  const postNote = useCallback(async () => {
    const t = noteIn.trim(); if (!t || posting) return;
    setPosting(true);
    const n = { id: String(Date.now()), by: user.name, text: t, ts: Date.now() };
    try {
      const st = await readShared();
      const updated = [n, ...(st.notes||[])].slice(0,50);
      await writeShared({ notes: updated });
      setNotes(updated); setNoteIn("");
    } catch (_) { alert("Could not post note."); }
    setPosting(false);
  }, [noteIn, posting, user]);

  const dismiss = () => { setOverlay(false); clearInterval(sLoop.current); };

  /* ── Sub-renders ──────────────────────────── */
  const renderHome = () => (
    <div className="home">
      {/* Status */}
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

      {/* Big alarm button */}
      <div className="alarm-zone">
        <button className={`alarm-btn${firing?" quiet":""}`} onClick={triggerAlarm} disabled={firing}>
          <div className="btn-shine"/>
          <div className="btn-inner">
            <div className="btn-emoji">{firing?"⏳":"🚨"}</div>
            <div className="btn-word">{firing?"SENDING":"ALARM"}</div>
            <div className="btn-sub">{firing?"Alerting your team…":"Tap to alert all team members"}</div>
          </div>
        </button>
        <div className="alarm-hint">Everyone with this app gets siren + vibration instantly</div>
      </div>

      {/* Recent notes */}
      <div className="section-hd">
        <span className="section-title">Recent Notes</span>
        <span className="section-link" onClick={()=>setTab("notes")}>See all →</span>
      </div>
      <div className="recent-list">
        {notes.length === 0
          ? <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#1e293b",padding:"0 2px"}}>No notes yet. Post one in the Notes tab.</div>
          : notes.slice(0,3).map(n => (
            <div key={n.id} className="note-card" style={{marginBottom:0}}>
              <Avatar name={n.by}/>
              <div className="nc-right">
                <div className="nc-top">
                  <span className="nc-name">{n.by}</span>
                  <span className="nc-time">{fmtRelative(n.ts)}</span>
                </div>
                <div className="nc-text">{n.text}</div>
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
              <div className="ae-icon">🚨</div>
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

  const renderNotes = () => (
    <div className="notes-wrap" style={{height:"100%"}}>
      <div className="note-input-zone">
        <textarea
          className="note-textarea"
          placeholder={`Write a note for the team, ${user?.name?.split(" ")[0]}…`}
          value={noteIn}
          onChange={e=>setNoteIn(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&(e.preventDefault(),postNote())}
          rows={2}
        />
        <div className="note-row">
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"#1e293b",letterSpacing:".08em"}}>
            ENTER to post · SHIFT+ENTER for new line
          </div>
          <button className="post-btn" onClick={postNote} disabled={!noteIn.trim()||posting}>
            {posting?"…":"POST"}
          </button>
        </div>
      </div>
      <div className="notes-list">
        {notes.length === 0
          ? <div className="empty"><div className="empty-icon">📋</div><div className="empty-label">NO NOTES YET<br/>POST SOMETHING FOR YOUR TEAM</div></div>
          : notes.map(n => (
            <div key={n.id} className="note-card">
              <Avatar name={n.by}/>
              <div className="nc-right">
                <div className="nc-top">
                  <span className="nc-name">{n.by}</span>
                  <span className="nc-time">{fmtRelative(n.ts)}</span>
                </div>
                <div className="nc-date">{fmtDate(n.ts)}</div>
                <div className="nc-text">{n.text}</div>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );

  const renderLog = () => (
    <div className="log-wrap">
      {history.length === 0
        ? <div className="empty" style={{paddingTop:60}}><div className="empty-icon">🚨</div><div className="empty-label">NO ALARMS TRIGGERED YET</div></div>
        : history.map((e,i) => (
          <div key={e.id} className="log-entry">
            <div className="le-num">#{i+1}</div>
            <div className="le-body">
              <div className="le-who">
                <span>🚨</span>
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
          <div style={{padding:"16px 16px 12px",display:"flex",alignItems:"center",gap:12,borderBottom:"1px solid rgba(255,255,255,.05)"}}>
            <Avatar name={user.name} size={44}/>
            <div>
              <div style={{fontSize:17,fontWeight:800,color:"#f1f5f9"}}>{user.name}</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#475569"}}>
                Member since {new Date(user.joinedAt).toLocaleDateString([],{month:"short",day:"numeric",year:"numeric"})}
              </div>
            </div>
          </div>
          <div className="setting-row">
            <div className="sr-left"><div className="sr-label">Change Name</div><div className="sr-sub">Appears on alarms and notes</div></div>
            <button className="test-btn" onClick={()=>{ window.storage.delete(UK).catch(()=>{}); setPhase("setup"); }}>Edit</button>
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
          <div className="sr-left"><div className="sr-label">🔔 Polling</div><div className="sr-sub">Checks for alarms every 1.8s</div></div>
          <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#22c55e"}}>● ACTIVE</span>
        </div>
      </div>

      <div className="info-box">
        <div className="info-title">📡 HOW IT WORKS</div>
        <div className="info-line">This app uses shared cloud storage to sync alarms and notes across all teammates in real time. <b>No Bluetooth. No range limit.</b> Works anywhere with internet.</div>
      </div>

      <div className="setting-section">
        <div className="setting-row">
          <div className="sr-left"><div className="sr-label">Share with Team</div><div className="sr-sub">Multiplayer Cloud Sync Required</div></div>
        </div>
        <div style={{padding:"0 16px 14px"}}>
          <div style={{background:"rgba(245,158,11,.05)",border:"1px solid rgba(245,158,11,.2)",borderRadius:11,padding:"10px 14px",fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#fbbf24",lineHeight:1.8}}>
            ⚠️ Currently running in LOCAL demo mode (Local Storage).<br/>
            Alarms and notes will NOT sync between different devices.<br/>
            To enable team sync, connect the app to a Firebase Database or a custom WebSocket server.
          </div>
        </div>
      </div>

      <div className="setting-section" style={{marginBottom:0}}>
        <div className="setting-row">
          <div className="sr-left"><div className="sr-label" style={{color:"#f87171"}}>Clear All Notes</div><div className="sr-sub">Removes all team notes</div></div>
          <button className="test-btn" style={{color:"#f87171",borderColor:"rgba(239,68,68,.2)"}} onClick={async()=>{if(!confirm("Clear all notes?"))return;await writeShared({notes:[]});setNotes([]);}}>Clear</button>
        </div>
        <div className="setting-row">
          <div className="sr-left"><div className="sr-label" style={{color:"#f87171"}}>Clear Alarm Log</div><div className="sr-sub">Removes alarm history</div></div>
          <button className="test-btn" style={{color:"#f87171",borderColor:"rgba(239,68,68,.2)"}} onClick={async()=>{if(!confirm("Clear alarm log?"))return;await writeShared({alarm:null,history:[]});setAlarm(null);setHistory([]);lastId.current="";}}>Clear</button>
        </div>
      </div>
      <div style={{height:20}}/>
    </div>
  );

  /* ── Screens ──────────────────────────────── */
  if (phase === "loading") return (
    <><style>{CSS}</style>
    <div className="loading">
      <div className="spin">🚨</div>
      <div style={{fontSize:10,color:"#334155",letterSpacing:".2em"}}>LOADING…</div>
    </div></>
  );

  if (phase === "setup") return (
    <><style>{CSS}</style>
    <div className="setup-bg">
      <div className="setup-card">
        <div className="setup-logo">🚨</div>
        <div className="setup-h1">SQUAD ALARM</div>
        <div className="setup-tagline">Instant silent alert for your entire team — one tap, everyone reacts.</div>
        <div className="how-works">
          <div className="hw-title">HOW IT WORKS</div>
          {[["Tap ALARM","Everyone's phone sounds + vibrates instantly"],["Post Notes","Leave messages visible to the whole team"],["Stay Alert","App checks for signals every 2 seconds"]].map(([t,d],i)=>(
            <div key={i} className="hw-step"><div className="hw-num">{i+1}</div><div className="hw-text"><b style={{color:"#94a3b8"}}>{t}</b> — {d}</div></div>
          ))}
        </div>
        <div className="divider"/>
        <div className="field-label">Your name</div>
        <input className="setup-input" placeholder="e.g. Alex, Maria, J. Smith…" value={nameIn} onChange={e=>setNameIn(e.target.value)} onKeyDown={e=>e.key==="Enter"&&join()} autoFocus/>
        <button className="join-btn" onClick={join}>JOIN TEAM</button>
        <div className="setup-warn">⚠ Alarms &amp; notes are shared with everyone who opens this app.<br/>Share this link only with your teammates.</div>
      </div>
    </div></>
  );

  /* MAIN */
  const TABS = [
    { id:"home",  icon:"🏠", label:"Home"  },
    { id:"notes", icon:"📋", label:"Notes" },
    { id:"log",   icon:"🚨", label:"Log"   },
    { id:"settings",icon:"⚙️",label:"Settings"},
  ];

  return (
    <><style>{CSS}</style>
    <div className="app">

      {/* OVERLAY */}
      {overlay && alarm && (
        <div className="ov">
          <div className="ov-lines"/>
          <div className="ov-card">
            <div className="ov-icon">🚨</div>
            <div className="ov-word">ALARM</div>
            <div className="ov-badge">EMERGENCY ALERT</div>
            <div className="ov-who">{alarm.by}</div>
            <div className="ov-time">{fmtFull(alarm.ts)}</div>
            <button className="ov-dismiss" onClick={dismiss}>✓ &nbsp; DISMISS</button>
          </div>
        </div>
      )}

      {/* STATUS BAR */}
      <div className="sb">
        <div className="sb-left">
          <div className="sb-dot" style={{
            background: window.storage?._isMock ? "#f59e0b" : "#22c55e",
            boxShadow: window.storage?._isMock ? "0 0 8px #f59e0b" : "0 0 8px #22c55e"
          }}/>
          <span className="sb-title">SQUAD ALARM</span>
          {window.storage?._isMock && (
            <span style={{
              fontSize: 9,
              background: "rgba(245,158,11,0.15)",
              border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: 4,
              padding: "1px 4px",
              color: "#fbbf24",
              fontFamily: "'JetBrains Mono',monospace",
              marginLeft: 6
            }}>LOCAL</span>
          )}
        </div>
        <div className="sb-chip">{user?.name}</div>
      </div>

      {/* CONTENT */}
      <div className="tab-body">
        {tab === "home"     && renderHome()}
        {tab === "notes"    && renderNotes()}
        {tab === "log"      && renderLog()}
        {tab === "settings" && renderSettings()}
      </div>

      {/* BOTTOM NAV */}
      <div className="bnav">
        {TABS.map(t => (
          <button key={t.id} className={`bnav-btn${tab===t.id?" active":""}`} onClick={()=>{setTab(t.id);if(t.id==="log")setNewAlarm(false);}}>
            <div className="bnav-icon bnav-badge">
              {t.icon}
              {t.id==="log" && newAlarm && tab!=="log" && <div className="badge-dot"/>}
            </div>
            <div className="bnav-label">{t.label}</div>
          </button>
        ))}
      </div>

    </div></>
  );
}
