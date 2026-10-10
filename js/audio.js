let _ctx = null;

function getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function sfxOn() {
  return localStorage.getItem('sfx') !== 'false';
}

export function toggleSound() {
  const next = !sfxOn();
  localStorage.setItem('sfx', String(next));
  return next;
}

// Triangle oscillator gives a soft, bell-like fairy tone
function tone(freq, duration, gain, offset = 0) {
  try {
    const ctx = getCtx();
    const t = ctx.currentTime + offset;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  } catch (_) {}
}

// ✨ Ascending fairy sparkle — like coins raining from a wand
export function playAdd() {
  if (!sfxOn()) return;
  tone(1047, 0.07, 0.12, 0.00);   // C6
  tone(1319, 0.07, 0.12, 0.07);   // E6
  tone(1568, 0.07, 0.10, 0.14);   // G6
  tone(2093, 0.09, 0.09, 0.22);   // C7
  tone(2637, 0.12, 0.07, 0.31);   // E7 — shimmering peak
}

// 🌬️ Descending dissolve — spell undone, sparkles fade
export function playDelete() {
  if (!sfxOn()) return;
  tone(2093, 0.07, 0.10, 0.00);
  tone(1568, 0.07, 0.08, 0.07);
  tone(1047, 0.10, 0.06, 0.14);
}

// 🪄 Single wand tap — soft fairy chime
export function playNav() {
  if (!sfxOn()) return;
  tone(2637, 0.05, 0.06, 0.00);   // E7
  tone(3136, 0.04, 0.04, 0.04);   // G7 shimmer
}

// ⚠️ Gentle warning chime — fairy alarm bells
export function playBudgetWarn() {
  if (!sfxOn()) return;
  tone(1760, 0.10, 0.10, 0.00);   // A6
  tone(1397, 0.10, 0.10, 0.10);   // F6
  tone(1047, 0.14, 0.08, 0.20);   // C6 — resolve
}
