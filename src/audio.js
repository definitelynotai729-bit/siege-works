// Siegeworks sound: everything is synthesized with Web Audio, so there are no files to load.
// Browsers only allow sound after the player interacts; the first shot or button press unlocks it.
(function (root) {
  'use strict';
  let ctx = null, master = null, noiseBuf = null, muted = false, lastHit = 0, hitsThisSecond = 0, secondStart = 0;
  try { muted = localStorage.getItem('sw_muted') === '1'; } catch (e) {}

  function ensure() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.55;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp); comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  function noise(dur, freq, q, gain, type, delay) {
    const c = ensure(); if (!c || muted) return;
    const t = c.currentTime + (delay || 0);
    const src = c.createBufferSource(); src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  function tone(freq, dur, gain, type, slide, delay) {
    const c = ensure(); if (!c || muted) return;
    const t = c.currentTime + (delay || 0);
    const o = c.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slide && slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0008, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function allowHit() {
    const now = performance.now();
    if (now - secondStart > 1000) { secondStart = now; hitsThisSecond = 0; }
    if (hitsThisSecond >= 14 || now - lastHit < 25) return false;
    hitsThisSecond++; lastHit = now; return true;
  }

  root.SWAudio = {
    unlock: ensure,
    isMuted: () => muted,
    setMuted(m) {
      muted = !!m;
      try { localStorage.setItem('sw_muted', muted ? '1' : '0'); } catch (e) {}
      if (master) master.gain.value = muted ? 0 : 0.55;
      if (!muted) ensure();
    },
    launch(type) {
      noise(0.32, 500, 0.7, 0.45, 'lowpass');
      tone(type === 'boulder' ? 70 : 110, 0.28, 0.35, 'sine', 0.45);
      noise(0.12, 2400, 1.5, 0.12, 'bandpass', 0.02); // creak of the arm
    },
    hit(mat, e) {
      if (!allowHit()) return;
      const g = Math.min(0.85, 0.1 + Math.log10(1 + e) / 4.5);
      if (mat === 'w') { noise(0.11, 1500, 1.4, g, 'bandpass'); tone(240, 0.09, g * 0.45, 'triangle', 0.7); }
      else if (mat === 's') { noise(0.2, 650, 0.9, g, 'lowpass'); tone(105, 0.16, g * 0.55, 'sine', 0.6); }
      else if (mat === 'i') { tone(540, 0.45, g * 0.22, 'square', 0.985); tone(812, 0.35, g * 0.14, 'triangle', 0.99); noise(0.06, 3200, 2, g * 0.4, 'highpass'); }
      else if (mat === 'h') { tone(1180, 0.12, g * 0.4, 'triangle', 0.8); }
      else { noise(0.16, 380, 0.7, g * 0.7, 'lowpass'); }
    },
    breakBlock(mat) {
      if (mat === 'w') { noise(0.28, 2600, 0.9, 0.45, 'bandpass'); noise(0.18, 900, 0.8, 0.3, 'lowpass', 0.03); }
      else if (mat === 's') { noise(0.4, 900, 0.6, 0.55, 'lowpass'); tone(80, 0.3, 0.3, 'sine', 0.5); }
      else { tone(420, 0.6, 0.25, 'square', 0.6); noise(0.3, 2000, 1, 0.35, 'bandpass'); }
    },
    blast() { noise(1.1, 280, 0.6, 1.0, 'lowpass'); tone(52, 0.7, 0.7, 'sine', 0.45); noise(0.5, 1800, 0.8, 0.3, 'bandpass', 0.05); },
    heart() { tone(988, 0.6, 0.32, 'triangle', 0.5); tone(1480, 0.45, 0.16, 'sine', 0.5, 0.04); noise(0.25, 4000, 1, 0.2, 'highpass'); },
    win() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.42, 0.22, 'triangle', 1, i * 0.1)); },
    lose() { [220, 174.6].forEach((f, i) => tone(f, 0.7, 0.2, 'triangle', 1, i * 0.28)); },
    click() { tone(1400, 0.04, 0.08, 'square', 1); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
