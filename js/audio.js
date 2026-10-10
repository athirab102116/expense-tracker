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

// ── Shared tone helper (fairy wand sounds) ──────────────────────────────────
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

// ── Fairy wand action sounds ─────────────────────────────────────────────────
export function playAdd() {
  if (!sfxOn()) return;
  tone(1047, 0.07, 0.12, 0.00);
  tone(1319, 0.07, 0.12, 0.07);
  tone(1568, 0.07, 0.10, 0.14);
  tone(2093, 0.09, 0.09, 0.22);
  tone(2637, 0.12, 0.07, 0.31);
}

export function playDelete() {
  if (!sfxOn()) return;
  tone(2093, 0.07, 0.10, 0.00);
  tone(1568, 0.07, 0.08, 0.07);
  tone(1047, 0.10, 0.06, 0.14);
}

export function playNav() {
  if (!sfxOn()) return;
  tone(2637, 0.05, 0.06, 0.00);
  tone(3136, 0.04, 0.04, 0.04);
}

export function playBudgetWarn() {
  if (!sfxOn()) return;
  tone(1760, 0.10, 0.10, 0.00);
  tone(1397, 0.10, 0.10, 0.10);
  tone(1047, 0.14, 0.08, 0.20);
}

// ── Per-category sound helpers ────────────────────────────────────────────────
// Bell: triangle oscillator, instant on, exponential decay
function catBell(ctx, freq, dur, gain) {
  const osc = ctx.createOscillator(), g = ctx.createGain();
  const t = ctx.currentTime;
  osc.type = 'triangle';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t); osc.stop(t + dur + 0.02);
}

// Pluck: sine, fast attack then quick decay (harp-like)
function catPluck(ctx, freq, dur, gain) {
  const osc = ctx.createOscillator(), g = ctx.createGain();
  const t = ctx.currentTime;
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t); osc.stop(t + dur + 0.02);
}

// Glass: two detuned sines, gentle attack (shimmery)
function catGlass(ctx, freq, dur, gain) {
  for (const df of [0, 2]) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = 'sine';
    osc.frequency.value = freq + df;
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(gain * 0.5, t + 0.018);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
}

// Harp: sine fundamental + quiet 2nd harmonic
function catHarp(ctx, freq, dur, gain) {
  for (const [f, gv] of [[freq, gain], [freq * 2, gain * 0.25]]) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = 'sine';
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(gv, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
}

// Pop: sine with quick pitch drop (soft bubble)
function catPop(ctx, freq, dur, gain) {
  const osc = ctx.createOscillator(), g = ctx.createGain();
  const t = ctx.currentTime;
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq * 1.4, t);
  osc.frequency.exponentialRampToValueAtTime(freq, t + dur * 0.6);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t); osc.stop(t + dur + 0.02);
}

// Crystal: sine + high 3rd harmonic (bright, clear)
function catCrystal(ctx, freq, dur, gain) {
  for (const [f, gv] of [[freq, gain], [freq * 3, gain * 0.18]]) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = 'sine';
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(gv, t + 0.014);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
}

// Wind chime: triangle fundamental + perfect fifth
function catChime(ctx, freq, dur, gain) {
  for (const [f, gv] of [[freq, gain], [freq * 1.5, gain * 0.55]]) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = 'triangle';
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(gv, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
}

// ── Per-category sound map (pentatonic C D E G A, varied timbres) ───────────
const CAT_SOUNDS = {
  food:          ctx => catBell(ctx,   659, 0.30, 0.09),   // E5 bell
  groceries:     ctx => catPluck(ctx,  784, 0.22, 0.09),   // G5 pluck
  transport:     ctx => catGlass(ctx,  880, 0.36, 0.10),   // A5 glass
  shopping:      ctx => catBell(ctx,  1047, 0.26, 0.09),   // C6 bright bell
  bills:         ctx => catHarp(ctx,   587, 0.28, 0.09),   // D5 harp
  rent:          ctx => catPluck(ctx,  392, 0.20, 0.09),   // G4 low pluck
  entertainment: ctx => catChime(ctx,  523, 0.30, 0.09),   // C5 chime
  health:        ctx => catPop(ctx,    330, 0.14, 0.09),   // E4 soft pop
  education:     ctx => catCrystal(ctx,440, 0.32, 0.08),   // A4 crystal
  travel:        ctx => catChime(ctx, 1175, 0.28, 0.08),   // D6 high chime
  other:         ctx => catBell(ctx,   262, 0.24, 0.07),   // C4 low bell
  // Custom category name fallback handled in playCategorySound
  boyfriend:     ctx => catGlass(ctx, 1047, 0.30, 0.09),   // C6 glass (hot pink vibes)
};

const FALLBACK_SOUNDS = [
  ctx => catBell(ctx,  784, 0.26, 0.08),
  ctx => catPluck(ctx, 659, 0.22, 0.08),
  ctx => catGlass(ctx, 523, 0.30, 0.08),
];

export function playCategorySound(catId) {
  if (!sfxOn()) return;
  try {
    const ctx = getCtx();
    const fn = CAT_SOUNDS[catId]
      || FALLBACK_SOUNDS[Math.abs(catId.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % FALLBACK_SOUNDS.length];
    fn(ctx);
  } catch (_) {}
}
