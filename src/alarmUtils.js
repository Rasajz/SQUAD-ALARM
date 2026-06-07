// Play alarm sound with vibration fallback for silent mode

export function triggerAlarmOnDevice() {
  // Try vibration first (works in silent mode)
  if (navigator.vibrate) {
    navigator.vibrate([500, 200, 500, 200, 500]); // Vibrate pattern
  }

  // Play siren sound (if not in silent mode)
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;
    const duration = 10; // 10 seconds alarm

    // Create main oscillator (wailing siren)
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const lfo = audioCtx.createOscillator();
    
    const gain = audioCtx.createGain();
    const lfoGain = audioCtx.createGain();

    // LFO for frequency sweep (wailing effect)
    lfoGain.gain.setValueAtTime(300, now);
    lfo.frequency.setValueAtTime(2, now); // 2 Hz wobble
    lfo.connect(lfoGain);

    // Main tone
    osc1.frequency.setValueAtTime(800, now);
    lfoGain.connect(osc1.frequency);
    
    // Harmony
    osc2.frequency.setValueAtTime(600, now);
    lfoGain.connect(osc2.frequency);

    // Connect to output
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(audioCtx.destination);

    // Set volume
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.1, now + duration);

    // Start & stop
    osc1.start(now);
    osc2.start(now);
    lfo.start(now);
    
    osc1.stop(now + duration);
    osc2.stop(now + duration);
    lfo.stop(now + duration);

    // Keep vibrating throughout
    const vibratePattern = [500, 200]; // 500ms vibrate, 200ms pause
    const vibrateInterval = setInterval(() => {
      navigator.vibrate(vibratePattern);
    }, 700);

    // Stop vibration when audio ends
    setTimeout(() => clearInterval(vibrateInterval), duration * 1000);

  } catch (err) {
    console.error("Audio context error:", err);
  }
}

export function requestNotificationPermission() {
  if (!("Notification" in window)) {
    return Promise.resolve(false);
  }

  if (Notification.permission === "granted") {
    return Promise.resolve(true);
  }

  if (Notification.permission !== "denied") {
    return Notification.requestPermission().then((permission) => {
      return permission === "granted";
    });
  }

  return Promise.resolve(false);
}

export function showNotification(title, options = {}) {
  if (Notification.permission === "granted") {
    new Notification(title, {
      icon: "🚨",
      badge: "🚨",
      ...options,
    });
  }
}
