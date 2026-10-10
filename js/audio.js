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

function tone(freq, duration, gain, offset = 0) {
  try {
    const ctx = getCtx();
    const t = ctx.currentTime + offset;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  } catch (_) {}
}

export function playAdd() {
  if (!sfxOn()) return;
  tone(880, 0.04, 0.18);
  tone(1100, 0.06, 0.18, 0.04);
}

export function playDelete() {
  if (!sfxOn()) return;
  tone(100, 0.08, 0.12);
}

export function playNav() {
  if (!sfxOn()) return;
  tone(600, 0.025, 0.06);
}

export function playBudgetWarn() {
  if (!sfxOn()) return;
  tone(660, 0.10, 0.10);
  tone(550, 0.10, 0.10, 0.10);
  tone(440, 0.15, 0.10, 0.20);
}
