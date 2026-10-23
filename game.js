/* game.js — UI wiring, run logic (levels / endless / daily), physics, juice, rendering. */
(() => {
'use strict';
const TAU = Math.PI * 2;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = n => '₦' + Math.round(n).toLocaleString('en-NG');
const S = () => Store.data;

/* ---------- canvas ---------- */
const canvas = $('#game'), ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
addEventListener('resize', resize); resize();

/* ---------- content tables ---------- */
const FRUIT = {
  apple:  { color: '#ef4444', flesh: '#fee2e2', r: 44 },
  orange: { color: '#f97316', flesh: '#ffedd5', r: 46 },
  lemon:  { color: '#facc15', flesh: '#fefce8', r: 40 },
  kiwi:   { color: '#65a30d', flesh: '#d9f99d', r: 38, seeds: true },
  melon:  { color: '#16a34a', flesh: '#fb7185', r: 52, stripes: true },
  ice:    { color: '#38bdf8', flesh: '#e0f7ff', r: 42, crystal: true },
  golden: { color: '#fbbf24', flesh: '#fef3c7', r: 40, gold: true }
};
const TRAILS = { purple: 'Neon Purple', lightning: 'White Lightning', glitch: 'Glitch' };
const SHOP = [
  { kind: 'trail', id: 'purple',    name: 'Neon Purple',     price: 0,     desc: 'Default glow. Always yours.' },
  { kind: 'trail', id: 'lightning', name: 'White Lightning', price: 15000, desc: 'Jagged arc-flash trail.' },
  { kind: 'trail', id: 'glitch',    name: 'Glitch',          price: 25000, desc: 'RGB split and tearing.' },
  { kind: 'skin',  id: 'classic',   name: 'Classic Fruit',   price: 0,     desc: 'Default painted fruit.' },
  { kind: 'skin',  id: 'neon',      name: 'Neon Outline',    price: 8000,  desc: 'Glowing rim in fruit colour.' },
  { kind: 'skin',  id: 'matrix',    name: 'Matrix Grid',     price: 12000, desc: 'Green wireframe fruit.' }
];
const LEVEL_NAMES = ['Hello World', 'Compile', 'Debug', 'Deploy', 'Production', 'Hotfix', 'Rollback', 'Refactor', 'Scale Out', 'Kernel Panic'];
const LEVEL_TARGETS = [6000, 10000, 14000, 18000, 24000, 30000, 36000, 42000, 50000, 60000];
const UNLOCK_TEXT = [
  'Basic fruit. Slice them, do not miss them.',
  'BOMBS online. Slicing one costs a life.',
  'ICE fruit: slicing it slows time for 3 s.',
  'MOVING BOMBS drift sideways. Watch the sway.',
  'FRENZY waves: fruit storms every 15 s.',
  'Faster arcs, denser waves.',
  'Bombs everywhere. Stay calm.',
  'Maximum fruit count per throw.',
  'Everything, everywhere, all at once.',
  'Final boss. Good luck.'
];
const LEVELS = LEVEL_NAMES.map((name, i) => ({
  idx: i, name, target: LEVEL_TARGETS[i], unlock: UNLOCK_TEXT[i],
  speed: 1 + i * 0.07,
  interval: Math.max(0.85, 1.9 - i * 0.11),
  maxFruits: i < 2 ? 1 : i < 5 ? 2 : 3,
  bombs: i === 0 ? 0 : Math.min(0.3, 0.1 + i * 0.025),
  golden: i === 0 ? 0 : 0.03,
  types: i < 1 ? ['apple', 'orange', 'lemon'] : ['apple', 'orange', 'lemon', 'kiwi', 'melon'],
  ice: i >= 2, movingBombs: i >= 3, frenzy: i >= 4
}));
const BASE_G = 1.6;      // gravity multiplier of screen height (scaled by speed²)

/* Build the per-run config, applying Rehab Mode adjustments. */
function cfgFor(lvl, rehab, endless) {
  const c = Object.assign({}, lvl);
  if (endless) c.target = 0;
  if (rehab) {
    c.speed *= 0.6; c.interval *= 1.5; c.bombs *= 0.5; c.frenzy = false; c.movingBombs = false;
  }
  c.sizeMul = rehab ? 1.35 : 1;
  return c;
}

/* ---------- sound (WebAudio synth, no files) ---------- */
const Sfx = (() => {
  let ac = null;
  function actx() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(f, dur, type = 'sine', vol = 0.15, slideTo = null, delay = 0) {
    if (S().settings.muted) return;
    const a = actx(); if (!a) return;
    const t = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol = 0.2, hp = 800) {
    if (S().settings.muted) return;
    const a = actx(); if (!a) return;
    const len = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf; f.type = 'highpass'; f.frequency.value = hp; g.gain.value = vol;
    src.connect(f).connect(g).connect(a.destination); src.start();
  }
  return {
    slice() { noise(0.09, 0.22); tone(900, 0.12, 'triangle', 0.1, 300); },
    bomb() { tone(160, 0.55, 'sawtooth', 0.22, 40); noise(0.55, 0.35, 200); },
    coin() { tone(1320, 0.12, 'square', 0.05); tone(1760, 0.18, 'square', 0.05, null, 0.07); },
    combo() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, 'triangle', 0.1, null, i * 0.06)); },
    golden() { [880, 1108, 1318, 1760].forEach((f, i) => tone(f, 0.2, 'sine', 0.13, null, i * 0.05)); },
    freeze() { tone(1400, 0.4, 'sine', 0.1, 300); },
    miss() { tone(220, 0.25, 'sawtooth', 0.06, 110); },
    tick() { tone(660, 0.05, 'square', 0.04); },
    click() { tone(600, 0.04, 'square', 0.035); },
    win() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.3, 'triangle', 0.12, null, i * 0.09)); },
    lose() { tone(330, 0.7, 'sawtooth', 0.1, 55); }
  };
})();

/* ---------- colour helpers ---------- */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round(r + (t - r) * p); g = Math.round(g + (t - g) * p); b = Math.round(b + (t - b) * p);
  return `rgb(${r},${g},${b})`;
}

/* ---------- drawing: fruit bodies, bombs ---------- */
/* Draws one fruit. If `cut` is given, the drawing is clipped to one half-plane
   ({side:±1, a: cut angle in the fruit's local frame}). */
function drawBody(c, type, r, cut) {
  const F = FRUIT[type];
  c.save();
  if (cut) {
    c.rotate(cut.a);
    c.beginPath(); c.rect(-r * 3, cut.side > 0 ? 0 : -r * 3, r * 6, r * 3); c.clip();
  }
  const g = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.05);
  if (F.gold) { g.addColorStop(0, '#fffbeb'); g.addColorStop(0.5, '#fde047'); g.addColorStop(1, '#92400e'); }
  else if (F.crystal) { g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#38bdf8'); g.addColorStop(1, '#0c4a6e'); }
  else { g.addColorStop(0, shade(F.color, 0.45)); g.addColorStop(0.6, F.color); g.addColorStop(1, shade(F.color, -0.45)); }
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
  if (F.stripes) {
    c.strokeStyle = 'rgba(5,60,20,.55)'; c.lineWidth = r * 0.16;
    for (let k = -2; k <= 2; k++) { c.beginPath(); c.ellipse(k * r * 0.36, 0, r * 0.12, r * 0.98, 0, 0, TAU); c.stroke(); }
  }
  if (cut) {                                // flesh face visible on the cut half
    const fg = c.createRadialGradient(0, 0, 0, 0, 0, r * 0.84);
    fg.addColorStop(0, '#ffffff'); fg.addColorStop(0.3, F.flesh); fg.addColorStop(1, shade(F.flesh, -0.15));
    c.fillStyle = fg; c.beginPath(); c.arc(0, 0, r * 0.84, 0, TAU); c.fill();
    if (F.seeds) { c.fillStyle = '#111'; for (let k = 0; k < 10; k++) { const an = k / 10 * TAU; c.beginPath(); c.arc(Math.cos(an) * r * 0.5, Math.sin(an) * r * 0.5, 2, 0, TAU); c.fill(); } }
  }
  c.fillStyle = 'rgba(255,255,255,.28)';
  c.beginPath(); c.ellipse(-r * 0.38, -r * 0.42, r * 0.22, r * 0.12, -0.6, 0, TAU); c.fill();
  if (F.crystal) {
    c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(-r * .5, -r * .1); c.lineTo(r * .1, -r * .6); c.lineTo(r * .5, r * .2); c.moveTo(r * .1, -r * .6); c.lineTo(-r * .1, r * .4); c.stroke();
  }
  if (!cut && !F.gold) {                    // stem
    c.strokeStyle = '#3f2a14'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, -r * 0.95); c.quadraticCurveTo(r * 0.1, -r * 1.3, r * 0.3, -r * 1.2); c.stroke();
  }
  c.restore();
}

/* A full fruit or half, with skin styling. */
function drawFruit(c, f, cut, skin, isHalf) {
  const F = FRUIT[f.type];
  c.save(); c.translate(f.x, f.y); c.rotate(f.rot);
  drawBody(c, f.type, f.r, cut);
  if (skin === 'neon' && !isHalf) {
    c.shadowColor = F.color; c.shadowBlur = 18; c.strokeStyle = F.color; c.lineWidth = 3;
    c.beginPath(); c.arc(0, 0, f.r, 0, TAU); c.stroke();
  } else if (skin === 'matrix') {
    c.save();
    c.beginPath(); c.arc(0, 0, f.r, 0, TAU); c.clip();
    c.strokeStyle = 'rgba(34,255,136,.55)'; c.lineWidth = 1;
    for (let y = -f.r; y < f.r; y += 5) { c.beginPath(); c.moveTo(-f.r, y); c.lineTo(f.r, y); c.stroke(); }
    c.restore();
    c.shadowColor = '#22ff88'; c.shadowBlur = 12; c.strokeStyle = '#22ff88'; c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, f.r, 0, TAU); c.stroke();
  }
  c.restore();
}

function drawBomb(c, b) {
  const col = b.wobble ? '#fb7185' : '#a855f7';
  c.save(); c.translate(b.x, b.y); c.rotate(b.rot);
  const g = c.createRadialGradient(-b.r * .35, -b.r * .4, 2, 0, 0, b.r);
  g.addColorStop(0, '#3b3b4f'); g.addColorStop(.6, '#111118'); g.addColorStop(1, '#030305');
  c.shadowColor = col; c.shadowBlur = 22;
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, b.r, 0, TAU); c.fill();
  c.strokeStyle = col; c.lineWidth = 2.5; c.stroke();
  c.shadowBlur = 0;
  c.strokeStyle = '#d4d4d8'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(b.r * .3, -b.r * .8); c.quadraticCurveTo(b.r * .6, -b.r * 1.3, b.r * .9, -b.r * 1.1); c.stroke();
  const fl = 0.6 + Math.random() * 0.4;
  c.shadowColor = '#fde68a'; c.shadowBlur = 14; c.fillStyle = `rgba(253,230,138,${fl})`;
  c.beginPath(); c.arc(b.r * .9, -b.r * 1.1, 4 + Math.random() * 2, 0, TAU); c.fill();
  c.shadowBlur = 0; c.strokeStyle = '#ff3b6b'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(-b.r * .3, -b.r * .3); c.lineTo(b.r * .3, b.r * .3); c.moveTo(b.r * .3, -b.r * .3); c.lineTo(-b.r * .3, b.r * .3); c.stroke();
  c.restore();
}

/* ---------- trail (purple neon / lightning / glitch) ---------- */
const trail = [];   // {x,y,t} screen px
function drawTrail() {
  const n = trail.length; if (n < 2) return;
  const style = S().equipped.trail;
  const path = (dx = 0, jit = false) => {
    ctx.beginPath();
    trail.forEach((p, i) => {
      const x = p.x + dx + (jit ? rnd(-5, 5) : 0), y = p.y + (jit ? rnd(-5, 5) : 0);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  };
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (style === 'lightning') {
    ctx.shadowColor = '#67e8f9'; ctx.shadowBlur = 20; ctx.strokeStyle = 'rgba(103,232,249,.9)'; ctx.lineWidth = 6; path(0, true);
    ctx.shadowBlur = 0; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; path(0, true);
  } else if (style === 'glitch') {
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,0,80,.85)'; path(-5);
    ctx.strokeStyle = 'rgba(0,255,255,.85)'; path(5);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; path(0);
  } else {
    ctx.shadowColor = '#a855f7'; ctx.shadowBlur = 28;
    ctx.strokeStyle = 'rgba(139,92,246,.35)'; ctx.lineWidth = 26; path();
    ctx.shadowBlur = 14; ctx.strokeStyle = 'rgba(168,85,247,.85)'; ctx.lineWidth = 10; path();
    ctx.shadowBlur = 0; ctx.strokeStyle = '#f5f3ff'; ctx.lineWidth = 3; path();
  }
  ctx.restore();
}

/* ---------- runtime state ---------- */
let run = null;                 // current run (see createRun)
let phase = 'idle';             // idle | calib | countdown | play | paused | over
let particles = [], texts = [];
let mouseMode = false, camReady = false, calib = null, cdT = 0, lastHud = {};
let tipNow = { x: 0, y: 0, active: false };

function createRun(mode, idx) {
  const rehab = S().settings.rehab;
  const lvl = mode === 'level' ? LEVELS[idx] : mode === 'endless' ? LEVELS[9] : LEVELS[3];
  const cfg = cfgFor(lvl, rehab, mode === 'endless');
  const seed = mode === 'daily' ? Meta.dailySeed() : (Date.now() & 0x7fffffff);
  return {
    mode, idx, cfg, rehab, target: mode === 'level' ? cfg.target : 0,
    score: 0, lives: 3, streak: 0, bestStreak: 0, sliced: 0, perfects: 0, combos5: 0,
    swipeCount: 0, lastSliceT: -9, fruits: [], halves: [],
    elapsed: 0, slowT: 0, frenzyCycle: 0, frenzyT: 0, nextSpawn: 1,
    shake: 0, flash: 0, endTimer: 0, win: false, bonus: 0,
    timeLeft: mode === 'daily' ? 60 : 0, rng: mulberry32(seed),
    officialDaily: mode === 'daily' && !Meta.ensureDay().attempted,
    reach: { minX: 1, maxX: 0, minY: 1, maxY: 0 }, reps: 0, big: false
  };
}

/* ---------- spawning ---------- */
function launch(type) {
  const r = run, cfg = r.cfg;
  const isBomb = type === 'bomb';
  const F = isBomb ? { color: '#a855f7', flesh: '#111' } : FRUIT[type];
  const sc = clamp(Math.min(W, H) / 800, 0.7, 1.3) * cfg.sizeMul;
  const rad = (isBomb ? 40 : F.r) * sc;
  const x0 = W * rnd(0.15, 0.85), y0 = H + rad;
  const xl = W * rnd(0.12, 0.88);
  const peak = H * (r.rehab ? rnd(0.22, 0.34) : rnd(0.16, 0.46));
  const g = BASE_G * H * cfg.speed * cfg.speed;
  const h = Math.max(40, y0 - peak);
  const vy = -Math.sqrt(2 * g * h);
  const T = 2 * Math.abs(vy) / g;
  const vx = (xl - x0) / T;
  r.fruits.push({
    type, bomb: isBomb, golden: type === 'golden', ice: type === 'ice',
    x: x0, y: y0, vx, vy, r: rad, rot: 0, spin: rnd(-2, 2), ph: rnd(0, TAU), age: 0,
    sliced: false, wobble: isBomb && cfg.movingBombs && Math.random() < 0.6,
    color: F.color, flesh: F.flesh
  });
}

function spawnWave(frenzy) {
  const r = run, cfg = r.cfg;
  const n = 1 + Math.floor(r.rng() * cfg.maxFruits) + (frenzy ? 3 : 0);
  for (let i = 0; i < n; i++) {
    const roll = r.rng();
    let type;
    if (roll < cfg.bombs) type = 'bomb';
    else if (roll < cfg.bombs + cfg.golden) type = 'golden';
    else if (cfg.ice && r.rng() < 0.12) type = 'ice';
    else type = cfg.types[Math.floor(r.rng() * cfg.types.length)];
    launch(type);
  }
}

/* ---------- juice ---------- */
function burst(x, y, color, flesh, n) {
  for (let i = 0; i < n; i++) {
    const a = rnd(0, TAU), s = rnd(120, 520);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 180, life: rnd(0.5, 1), max: 1,
      size: rnd(2, 6), color: Math.random() < 0.6 ? color : flesh });
  }
}
function floatText(x, y, text, color, size = 22) {
  texts.push({ x, y, text, color, size, life: 1.1, max: 1.1 });
}
function addScore(amount, x, y, label, color) {
  const r = run;
  r.score += amount;
  Store.addWallet(amount);
  if (label) floatText(x, y - 40, label, color || '#e9d5ff', 13);
  floatText(x, y, '+' + fmt(amount), color || '#fbbf24', 26);
  Sfx.coin();
  if (!r.big && r.score >= 20000) r.big = true;
}

/* A slice was detected through fruit f along segment a→b. */
function sliceFruit(f, a, b, now) {
  const r = run;
  f.sliced = true;
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);
  const off = Math.abs((f.x - a.x) * dy - (f.y - a.y) * dx) / L;   // centre → cut line
  const perfect = off < f.r * 0.3;

  if (f.bomb) return bombHit(f);
  if (f.ice) { r.slowT = 3; Sfx.freeze(); floatText(f.x, f.y - 30, 'TIME SLOW', '#67e8f9', 18); banner('TIME SLOW', 'ice fruit · 45% speed'); }

  // Halves with separation impulse along the cut normal.
  const nx = -Math.sin(ang), ny = Math.cos(ang), sc = f.r / 44;
  [1, -1].forEach(side => {
    r.halves.push({
      type: f.type, x: f.x + nx * side * 4, y: f.y + ny * side * 4, r: f.r, rot: f.rot,
      a: ang - f.rot, s: side,
      vx: f.vx + nx * side * 150 * sc, vy: f.vy + ny * side * 150 * sc - 120 * sc,
      spin: f.spin + side * rnd(3, 6), life: 1
    });
  });
  burst(f.x, f.y, f.color, f.flesh, perfect ? 34 : 20);
  if (perfect) burst(f.x, f.y, '#e9d5ff', '#ffffff', 10);

  // Swipe combos: consecutive slices within 0.4 s of each other.
  if (now - r.lastSliceT > 0.4) r.swipeCount = 0;
  r.lastSliceT = now; r.swipeCount++;
  r.sliced++; r.reps++; r.streak++; Meta.bump('slices');
  r.bestStreak = Math.max(r.bestStreak, r.streak);
  Sfx.slice();

  const mult = r.streak >= 10 ? 2 : 1;
  if (r.streak === 10) banner('STREAK x2', '10 clean slices · double naira');
  if (f.golden) {
    Sfx.golden(); burst(f.x, f.y, '#fde047', '#fff7cc', 40);
    addScore(10000, f.x, f.y, 'GOLDEN FRUIT', '#fde047');
  } else {
    let pay = 1000;
    let label = perfect ? 'PERFECT CUT +₦500' : (mult > 1 ? 'STREAK x2' : null);
    if (perfect) { pay += 500; r.perfects++; Meta.bump('perfects'); }
    pay *= mult;
    addScore(pay, f.x, f.y, label, perfect ? '#e879f9' : null);
  }
  if (r.swipeCount === 3) { Sfx.combo(); addScore(1500, a.x, a.y - 60, 'COMBO x3 BONUS', '#c4b5fd'); banner('COMBO x3', '+₦1,500'); }
  if (r.swipeCount === 5) { r.combos5++; Meta.setMax('combo5', 1); Sfx.combo(); addScore(5000, b.x, b.y - 90, 'COMBO x5 BONUS', '#f0abfc'); banner('COMBO x5', '+₦5,000 · legendary'); }
  if (r.swipeCount >= 2 && r.swipeCount !== 3 && r.swipeCount !== 5) floatText(b.x, b.y - 80, 'x' + r.swipeCount, '#c4b5fd', 18);
}

function bombHit(f) {
  const r = run;
  r.lives--; r.streak = 0; r.shake = 0.6; r.flash = 0.4;
  Sfx.bomb(); burst(f.x, f.y, '#ff3b6b', '#444', 30);
  floatText(f.x, f.y - 20, 'BOOM  -1 LIFE', '#ff3b6b', 22);
  banner(r.lives > 0 ? 'BOOM' : 'SYSTEM FAILURE', r.lives > 0 ? 'bombs cost a life' : '');
  const el = $('#h-lives'); el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
  if (r.lives <= 0) { r.endTimer = 1.1; r.win = false; }
}

/* Banner text in the HUD. */
let bannerTimer = null;
function banner(text, sub) {
  const el = $('#banner');
  el.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

/* ---------- main step ---------- */
function stepRun(dt, tip, now) {
  const r = run, cfg = r.cfg;
  r.elapsed += dt;
  if (r.slowT > 0) r.slowT -= dt;
  const ts = r.slowT > 0 ? 0.45 : 1, s = dt * ts;
  if (r.shake > 0) r.shake -= dt;
  if (r.flash > 0) r.flash -= dt;

  // Endless ramps speed up over time; daily counts down.
  r.speedNow = cfg.speed * (r.mode === 'endless' ? 1 + Math.min(1, r.elapsed / 120) * 0.8 : 1);
  if (r.mode === 'daily') {
    const prev = Math.ceil(r.timeLeft);
    r.timeLeft -= dt;
    if (Math.ceil(r.timeLeft) !== prev && r.timeLeft <= 5 && r.timeLeft > 0) Sfx.tick();
    if (r.timeLeft <= 0) { r.timeLeft = 0; return endRun(); }
  }
  if (r.endTimer > 0) { r.endTimer -= dt; if (r.endTimer <= 0) return endRun(); }

  // Frenzy storm every 15 s on levels that unlock it.
  if (cfg.frenzy) {
    r.frenzyCycle += dt;
    if (r.frenzyCycle > 15) { r.frenzyCycle = 0; r.frenzyT = 5; banner('FRENZY WAVE', 'fruit storm incoming'); }
    if (r.frenzyT > 0) r.frenzyT -= dt;
  }
  const frenzy = r.frenzyT > 0;

  // Spawn.
  r.nextSpawn -= s;
  if (r.nextSpawn <= 0 && r.endTimer <= 0) {
    spawnWave(frenzy);
    r.nextSpawn = (cfg.interval / r.speedNow) * (frenzy ? 0.5 : 1) * (0.85 + r.rng() * 0.3);
  }

  // Physics: gravity scales with speed² so arcs keep their height but run faster.
  const g = BASE_G * H * r.speedNow * r.speedNow;
  for (const f of r.fruits) {
    f.age += s; f.vy += g * s; f.x += f.vx * s; f.y += f.vy * s; f.rot += f.spin * s;
    if (f.wobble) f.x += Math.sin(f.age * 3 + f.ph) * 160 * s;
    if (!f.sliced && !f.bomb && f.vy > 0 && f.y > H + f.r * 1.6) {
      f.sliced = true; r.streak = 0; Sfx.miss();  // a missed fruit breaks the streak, costs no life
    }
  }
  r.fruits = r.fruits.filter(f => !f.sliced && f.y < H + f.r * 2.5);
  for (const h of r.halves) {
    h.vy += g * s; h.x += h.vx * s; h.y += h.vy * s; h.rot += h.spin * s;
    h.life -= dt * 0.8;
  }
  r.halves = r.halves.filter(h => h.life > 0 && h.y < H + 200);

  // Trail + slicing.
  if (tip.active) trail.push({ x: tip.x * W, y: tip.y * H, t: now });
  while (trail.length && now - trail[0].t > 0.2) trail.shift();
  if (r.rehab && tip.active) {                // range-of-motion tracking
    const rr = r.reach;
    rr.minX = Math.min(rr.minX, tip.x); rr.maxX = Math.max(rr.maxX, tip.x);
    rr.minY = Math.min(rr.minY, tip.y); rr.maxY = Math.max(rr.maxY, tip.y);
  }
  if (trail.length >= 2 && tip.active) {
    const a = trail[trail.length - 2], b = trail[trail.length - 1];
    if (b.t - a.t < 0.06 && Math.hypot(b.x - a.x, b.y - a.y) > 1) checkSlices(a, b, now);
  }
}

function segDist(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - a.x) * dx + (py - a.y) * dy) / L2, 0, 1);
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}
function checkSlices(a, b, now) {
  for (const f of run.fruits) {
    if (f.sliced) continue;
    if (segDist(f.x, f.y, a, b) < f.r * 0.9) sliceFruit(f, a, b, now);
  }
}

/* ---------- rendering ---------- */
function draw(tip) {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (run && run.shake > 0) { const m = run.shake * 18; ctx.translate(rnd(-m, m), rnd(-m, m)); }
  if (run) {
    const skin = S().equipped.skin;
    for (const f of run.fruits) { if (f.sliced) continue; f.bomb ? drawBomb(ctx, f) : drawFruit(ctx, f, null, skin, false); }
    for (const h of run.halves) drawFruit(ctx, h, { side: h.s, a: h.a }, skin, true);
  }
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  if (run && run.flash > 0) {
    ctx.fillStyle = `rgba(255,40,90,${run.flash * 0.35})`; ctx.fillRect(0, 0, W, H);
  }
  drawTrail();
  if (tip.active && phase !== 'idle') {      // fingertip cursor
    ctx.save(); ctx.shadowColor = '#e9d5ff'; ctx.shadowBlur = 16; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(tip.x * W, tip.y * H, 5, 0, TAU); ctx.fill(); ctx.restore();
  }
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const t of texts) {
    ctx.globalAlpha = clamp(t.life / t.max * 1.6, 0, 1);
    ctx.font = `700 ${t.size}px "JetBrains Mono", monospace`;
    ctx.shadowColor = t.color; ctx.shadowBlur = 12; ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.restore();
}

/* ---------- main loop ---------- */
let lastT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000)); lastT = t;
  const now = t / 1000;
  const tip = HandTracker.update(dt);
  tipNow = tip;
  if (phase === 'calib') {
    if (tip.active) trail.push({ x: tip.x * W, y: tip.y * H, t: now });
    while (trail.length && now - trail[0].t > 0.2) trail.shift();
    updateCalib(tip);
  } else if (phase === 'countdown') {
    if (tip.active) trail.push({ x: tip.x * W, y: tip.y * H, t: now });
    while (trail.length && now - trail[0].t > 0.2) trail.shift();
    updateCountdown(dt);
  } else if (phase === 'play') {
    stepRun(dt, tip, now);
    updateHud();
    if (run.mode === 'level' && run.score >= run.target && !run.win && run.endTimer <= 0) { run.win = true; run.endTimer = 0.9; banner('LEVEL CLEAR', 'target reached'); }
  } else if (phase === 'paused' || phase === 'over') {
    // frozen: keep drawing the last frame
  }
  // Particles & floating text always animate.
  for (const p of particles) { p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 1.4; }
  particles = particles.filter(p => p.life > 0);
  for (const t2 of texts) { t2.y -= 46 * dt; t2.life -= dt; }
  texts = texts.filter(t2 => t2.life > 0);
  if (phase === 'idle' && !particles.length && !texts.length) { ctx.clearRect(0, 0, W, H); return; }
  draw(tip);
}

/* ---------- HUD ---------- */
function setIf(sel, key, val) {
  if (lastHud[key] === val) return;
  lastHud[key] = val;
  const el = $(sel); if (el) el.textContent = val;
}
function updateHud() {
  const r = run;
  setIf('#h-score', 'score', Math.round(r.score).toLocaleString('en-NG'));
  setIf('#h-wallet', 'wallet', Math.round(S().wallet).toLocaleString('en-NG'));
  const lv = r.mode === 'daily' ? 'DAILY' : r.mode === 'endless' ? '∞' : String(r.idx + 1).padStart(2, '0');
  setIf('#h-lvl', 'lvl', lv);
  setIf('#h-level', 'lname', r.mode === 'daily' ? 'Daily Challenge' : r.mode === 'endless' ? 'Infinite Loop' : LEVELS[r.idx].name);
  const lives = Array.from({ length: 3 }, (_, i) => `<span class="${i < r.lives ? '' : 'lost'}">${i < r.lives ? '♥' : '♡'}</span>`).join(' ');
  setIf('#h-lives', 'lives', lives);
  const mult = r.streak >= 10 ? ' · x2 ACTIVE' : '';
  setIf('#h-streak', 'streak', `STREAK ${r.streak}${mult}${r.slowT > 0 ? ' · SLOW' : ''}`);
  const sEl = $('#h-streak'); sEl.classList.toggle('hot', r.streak >= 10);
  if (r.mode === 'level') {
    const pct = clamp(r.score / r.target, 0, 1) * 100;
    $('#h-target').style.width = pct + '%';
    setIf('#h-target-txt', 'tt', `TARGET ${fmt(r.target)} · ${Math.floor(pct)}%`);
  } else if (r.mode === 'daily') {
    $('#h-target').style.width = (clamp(1 - r.timeLeft / 60, 0, 1) * 100) + '%';
    setIf('#h-target-txt', 'tt', `TIME ${Math.ceil(r.timeLeft)}s`);
  } else {
    $('#h-target').style.width = (clamp(r.elapsed / 120, 0, 1) * 100) + '%';
    setIf('#h-target-txt', 'tt', `RAMP ${Math.floor(clamp(r.elapsed / 120, 0, 1) * 100)}%`);
  }
}

/* ---------- phases: calibration, countdown ---------- */
function setCamMsg(t) { const el = $('#cam-msg'); if (el) el.textContent = t; }
function beginCalibration() {
  showScreen('camera');
  $('#cam-status').classList.add('hidden');
  $('#cam-err').classList.add('hidden');
  $('#cam-calib').classList.remove('hidden');
  $('#skip-calib').classList.add('hidden');
  calib = { dir: 0, ext: 0, prevX: null, swings: 0, t0: performance.now() };
  $('#calib-bar').style.width = '0%';
  phase = 'calib';
  setTimeout(() => { if (phase === 'calib') $('#skip-calib').classList.remove('hidden'); }, 7000);
}
function updateCalib(tip) {
  const st = $('#calib-state');
  if (!tip.active) { st.textContent = 'show your index finger to the camera…'; calib.prevX = null; return; }
  st.textContent = 'tracking ✓ — now wave';
  const x = tip.x;
  if (calib.prevX !== null) {
    const d = x - calib.prevX;
    if (Math.abs(d) > 0.004) {
      const sgn = Math.sign(d);
      if (sgn !== calib.dir) {
        if (calib.dir === 0) calib.ext = calib.prevX;
        else { if (Math.abs(calib.prevX - calib.ext) > 0.12) calib.swings++; calib.ext = calib.prevX; }
        calib.dir = sgn;
        $('#calib-bar').style.width = Math.min(100, calib.swings / 3 * 100) + '%';
      }
    }
  }
  calib.prevX = x;
  if (calib.swings >= 3) finishCalibration();
}
function finishCalibration() {
  phase = 'idle';
  S().settings.calibrated = true; Store.save();
  toast('CALIBRATED · finger tracking online');
  afterSetup();
}
/* After camera + calibration, resume whatever run was requested before setup. */
function afterSetup() {
  if (pendingAfterCam) { const p = pendingAfterCam; pendingAfterCam = null; return startRun(p.mode, p.idx); }
  showScreen('levels');
}
function updateCountdown(dt) {
  cdT -= dt;
  const el = $('#countdown');
  const label = cdT > 2.2 ? '3' : cdT > 1.4 ? '2' : cdT > 0.6 ? '1' : 'GO';
  if (el.dataset.v !== label) {
    el.dataset.v = label; el.textContent = label;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    Sfx.tick();
  }
  if (cdT <= 0) { el.textContent = ''; el.dataset.v = ''; phase = 'play'; }
}

/* ---------- run lifecycle ---------- */
function startRun(mode, idx) {
  if (!mouseMode && !camReady) { pendingAfterCam = { mode, idx }; return beginCamera(); }
  if (phase === 'calib') return;
  run = createRun(mode, idx);
  particles = []; texts = []; trail.length = 0; lastHud = {};
  $('#banner').classList.remove('show'); $('#countdown').textContent = '';
  $('#h-target').style.width = '0%';
  hideModals();
  showScreen('game');
  phase = 'countdown'; cdT = 3;
  Sfx.click();
}
function hideModals() { $('#s-pause').classList.remove('on'); $('#s-over').classList.remove('on'); }

function endRun() {
  if (!run || phase === 'over') return;
  const r = run;
  phase = 'over';
  const D = S();
  let stars = 0;
  if (r.mode === 'level' && r.win) {
    stars = 1; if (r.lives >= 2) stars = 2; if (r.lives === 3 && r.score >= r.target * 1.6) stars = 3;
    D.unlockedLevel = Math.max(D.unlockedLevel, Math.min(11, r.idx + 2));
  }
  if (r.mode === 'level') {
    D.levelStars[r.idx] = Math.max(D.levelStars[r.idx] || 0, stars);
    D.bests[r.idx] = Math.max(D.bests[r.idx] || 0, Math.round(r.score));
  }
  if (r.mode === 'endless') D.bestEndless = Math.max(D.bestEndless, Math.round(r.score));
  if (r.mode === 'daily') {
    D.daily.best = Math.max(D.daily.best, Math.round(r.score));
    if (r.officialDaily) { r.bonus = Math.round(r.score * 0.5); Store.addWallet(r.bonus); D.daily.attempted = true; }
  }
  if (r.big) Meta.setMax('big', 1);
  D.runsPlayed++;
  if (r.rehab && r.reps >= 0) {
    const rr = r.reach, secs = Math.round(r.elapsed);
    const reach = {
      l: Math.round(clamp(0.5 - rr.minX, 0, 0.5) * 100), r: Math.round(clamp(rr.maxX - 0.5, 0, 0.5) * 100),
      u: Math.round(clamp(0.5 - rr.minY, 0, 0.5) * 100), d: Math.round(clamp(rr.maxY - 0.5, 0, 0.5) * 100)
    };
    D.rehabHistory.push({ date: Meta.todayKey(), reps: r.sliced, secs, reach });
    D.rehabHistory = D.rehabHistory.slice(-30);
  }
  const rank = Leaderboard.submit({ name: D.settings.name || 'anon', score: Math.round(r.score), mode: r.mode, level: modeLabel(r), date: Meta.todayKey() });
  Store.save();
  r.stars = stars; r.rank = rank;
  if (r.win) Sfx.win(); else Sfx.lose();
  showOver(stars);
}
function modeLabel(r) { return r.mode === 'level' ? LEVELS[r.idx].name : r.mode === 'endless' ? 'Infinite Loop' : 'Daily'; }

let lastSummary = '';
function showOver(stars) {
  const r = run;
  const title = r.mode === 'daily' ? 'DAILY COMPLETE' : r.win ? 'LEVEL CLEARED' : (r.mode === 'level' ? 'SYSTEM FAILURE' : 'RUN ENDED');
  $('#over-title').textContent = title;
  $('#over-exit').textContent = r.win || r.mode !== 'level' ? '> exit 0' : '> exit 1';
  $('#over-stars').innerHTML = r.mode === 'level'
    ? [1, 2, 3].map((i, k) => `<span class="${i <= stars ? 'on pop' : ''}" style="animation-delay:${k * 0.15}s">★</span>`).join('')
    : '';
  if (r.mode !== 'level') $('#over-stars').innerHTML = `<span class="on" style="font-size:20px;letter-spacing:2px">SCORE ${fmt(r.score)}</span>`;
  const rows = [
    ['Score', fmt(r.score), 'g'],
    ['Fruits sliced', r.sliced],
    ['Perfect cuts', r.perfects],
    ['Best streak', r.bestStreak],
    ['Combos x5', r.combos5],
    ['Time', Math.round(r.elapsed) + 's'],
    ['Lives left', r.lives],
    ['Leaderboard rank', r.rank ? '#' + r.rank : 'off board']
  ];
  if (r.mode === 'daily') rows.push(['Daily bonus', r.bonus ? '+' + fmt(r.bonus) : 'practice (no bonus)', 'g']);
  if (r.rehab) rows.push(['Rehab reps', r.sliced]);
  $('#over-stats').innerHTML = rows.map(([k, v, c]) => `<div class="kv"><span>${k}</span><b class="${c || ''}">${v}</b></div>`).join('');
  const nextBtn = $('#over-next');
  const canNext = r.mode === 'level' && r.win && r.idx < 9;
  nextBtn.classList.toggle('hidden', !canNext);
  if (r.mode === 'level' && r.win && r.idx === 9) { nextBtn.textContent = '∞ UNLOCK ENDLESS'; nextBtn.classList.remove('hidden'); nextBtn.dataset.next = 'endless'; }
  else nextBtn.dataset.next = 'level';
  lastSummary = `SLICE NAIRA · ${modeLabel(r)} · ${fmt(r.score)} · ${r.sliced} slices · ${r.perfects} perfect cuts${r.mode === 'level' ? ' · ' + '★'.repeat(stars) : ''} — can you beat me? #SliceNaira`;
  $('#s-over').classList.add('on');
  phase = 'over';
  $('#h-wallet').parentElement.classList.add('bump');
}

function pauseGame() {
  if (phase !== 'play' && phase !== 'countdown') return;
  phase = 'paused';
  $('#s-pause').classList.add('on');
  $$('#s-pause .mute-state').forEach(e => e.textContent = S().settings.muted ? 'OFF' : 'ON');
}
function resumeGame() {
  if (phase !== 'paused') return;
  $('#s-pause').classList.remove('on');
  phase = 'play';
}

/* ---------- screens & render helpers ---------- */
const SCREENS = ['landing', 'camera', 'levels', 'daily', 'shop', 'stats', 'game'];
function showScreen(name) {
  for (const s of SCREENS) $('#s-' + s).classList.toggle('on', s === name);
  if (name !== 'game' && phase !== 'idle') {          // leaving any run or setup phase
    if (phase === 'calib' || phase === 'countdown' || phase === 'play' || phase === 'paused' || phase === 'over') {
      phase = 'idle'; run = null; trail.length = 0; particles = []; texts = [];
    }
    hideModals();
  }
  const renders = { levels: renderLevels, daily: renderDaily, shop: renderShop, stats: renderStats, landing: renderLanding };
  if (renders[name]) renders[name]();
  updateWallets();
}
function updateWallets() { $$('.wv').forEach(e => e.textContent = Math.round(S().wallet).toLocaleString('en-NG')); }
function renderToggles() {
  $$('.rehab-state').forEach(e => e.textContent = S().settings.rehab ? 'ON' : 'OFF');
  $$('.mute-state').forEach(e => e.textContent = S().settings.muted ? 'OFF' : 'ON');
}
let toastT = null;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2400);
}

function renderLanding() {
  renderToggles();
  const cnt = S().streak.count || 0;
  $('#streak-chip').innerHTML = cnt ? `🔥${cnt}` : '';
}
function renderLevels() {
  const D = S(), grid = $('#level-grid'); grid.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const locked = i + 1 > D.unlockedLevel;
    const stars = D.levelStars[i] || 0;
    const b = document.createElement('button');
    b.className = 'lvl' + (locked ? ' locked' : '');
    b.innerHTML = `<span class="no">LVL ${String(i + 1).padStart(2, '0')}${locked ? ' · LOCKED' : ''}</span>
      <span class="nm">${L.name}</span>
      <span class="tg">target ${fmt(L.target)}</span>
      <span class="ds">${locked ? 'Clear the previous level to unlock.' : L.unlock}</span>
      <span class="st">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>
      <span class="dim small">best ${fmt(D.bests[i] || 0)}</span>`;
    if (!locked) b.onclick = () => { Sfx.click(); startRun('level', i); };
    grid.appendChild(b);
  });
  const endless = D.unlockedLevel >= 11;
  const e = document.createElement('button');
  e.className = 'lvl endless' + (endless ? '' : ' locked');
  e.innerHTML = `<span class="tag">${endless ? 'OPEN' : 'LOCKED'}</span><span class="no">MODE</span>
    <span class="nm">∞ Infinite Loop</span><span class="tg">no target · speed ramps</span>
    <span class="ds">${endless ? 'Survive as long as you can. Best ' + fmt(D.bestEndless) : 'Clear Kernel Panic to unlock.'}</span>`;
  if (endless) e.onclick = () => { Sfx.click(); startRun('endless', 0); };
  grid.appendChild(e);
}
function renderDaily() {
  const D = Meta.ensureDay(), st = S().streak;
  $('#daily-info').textContent = `DATE ${Meta.todayKey()} · SEED ${Meta.dailySeed()} · ${D.attempted ? 'official run complete' : 'official run available'}`;
  $('#daily-best').textContent = `today's best: ${fmt(D.best)}`;
  $('#streak-text').textContent = `Day ${st.count} streak · today's login reward ${fmt(Meta.loginReward())}${Meta.canClaim() ? '' : ' (claimed)'}`;
  $('#flame').textContent = '🔥 ' + st.count;
  const cb = $('#claim-btn'); cb.disabled = !Meta.canClaim(); cb.textContent = Meta.canClaim() ? `CLAIM ${fmt(Meta.loginReward())}` : 'CLAIMED TODAY ✓';
  const days = $('#streak-days'); days.innerHTML = '';
  for (let d = 1; d <= 7; d++) {
    const el = document.createElement('div');
    const amt = Math.min(25000, 5000 + (d - 1) * 2500);
    el.className = 'day' + (d <= st.count ? ' on' : '') + (d === st.count + (Meta.canClaim() ? 0 : 0) && d === (st.count) ? ' today' : '');
    el.innerHTML = `<span>D${d}</span><b>${(amt / 1000)}k</b>`;
    days.appendChild(el);
  }
  const ms = $('#missions'); ms.innerHTML = '';
  Meta.MISSIONS.forEach(m => {
    const val = Math.min(m.need, D.m[m.key] || 0), done = val >= m.need, claimed = !!D.claimed[m.id];
    const row = document.createElement('div'); row.className = 'mission';
    row.innerHTML = `<span class="mt">${m.label} <span class="dim small">· ${fmt(m.reward)}</span></span>
      ${claimed ? '<span class="chip">CLAIMED</span>' : done ? `<button class="btn small" data-act="mission" data-id="${m.id}">CLAIM</button>` : `<span class="dim small">${val}/${m.need}</span>`}
      <div class="mb"><i style="width:${val / m.need * 100}%"></i></div>`;
    ms.appendChild(row);
  });
  const tb = $('#lb-body'); tb.innerHTML = '';
  const top = Leaderboard.top();
  if (!top.length) tb.innerHTML = `<tr><td colspan="5" class="dim">No scores yet. Play a run.</td></tr>`;
  top.forEach((e, i) => {
    const tr = document.createElement('tr');
    if (e.name === S().settings.name) tr.className = 'me';
    tr.innerHTML = `<td>${i + 1}</td><td>${escapeHtml(e.name)}</td><td>${fmt(e.score)}</td><td>${e.level}</td><td>${e.date}</td>`;
    tb.appendChild(tr);
  });
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function renderShop() {
  const grid = $('#shop-grid'); grid.innerHTML = '';
  const D = S();
  SHOP.forEach(it => {
    const owned = (it.kind === 'trail' ? D.owned.trails : D.owned.skins).includes(it.id);
    const eq = it.kind === 'trail' ? D.equipped.trail === it.id : D.equipped.skin === it.id;
    const pv = it.kind === 'trail' ? `<div class="pv-line pv-${it.id === 'purple' ? 'purple' : it.id === 'lightning' ? 'light' : 'glitch'}"></div>`
      : `<div class="pv-${it.id === 'classic' ? 'ball' : it.id === 'neon' ? 'neon' : 'matrix'}"></div>`;
    const card = document.createElement('div'); card.className = 'item' + (eq ? ' eq' : '');
    let btn;
    if (eq) btn = '<button class="btn disabled" disabled>EQUIPPED</button>';
    else if (owned) btn = `<button class="btn" data-act="equip" data-kind="${it.kind}" data-id="${it.id}">EQUIP</button>`;
    else btn = `<button class="btn" data-act="buy" data-kind="${it.kind}" data-id="${it.id}" ${D.wallet < it.price ? 'disabled' : ''}>BUY · ${fmt(it.price)}</button>`;
    card.innerHTML = `<div class="pv">${pv}</div><div class="nm">${it.name}</div><div class="ds">${it.desc}</div>
      <div class="pr">${it.price ? fmt(it.price) : 'FREE'}</div>${btn}`;
    grid.appendChild(card);
  });
}

function renderStats() {
  const D = S(), n = $('#name-input'); if (document.activeElement !== n) n.value = D.settings.name;
  const cleared = Object.values(D.levelStars).filter(v => v > 0).length;
  $('#profile').innerHTML = [
    ['Wallet', fmt(D.wallet), 'g'], ['Runs played', D.runsPlayed], ['Levels cleared', cleared + ' / 10'],
    ['Best endless', fmt(D.bestEndless)], ['Login streak', D.streak.count + ' day(s)'],
    ['Calibrated', D.settings.calibrated ? 'yes' : 'no']
  ].map(([k, v, c]) => `<div class="kv"><span>${k}</span><b class="${c || ''}">${v}</b></div>`).join('');
  $('#best-list').innerHTML = LEVELS.map((L, i) => `<div class="kv"><span>${String(i + 1).padStart(2, '0')} ${L.name}</span><b>${fmt(D.bests[i] || 0)} <span class="dim">${'★'.repeat(D.levelStars[i] || 0)}</span></b></div>`).join('')
    + `<div class="kv"><span>∞ Infinite Loop</span><b>${fmt(D.bestEndless)}</b></div>`;
  const hist = D.rehabHistory.slice(-10);
  const avg = k => hist.length ? Math.round(hist.reduce((a, h) => a + h.reach[k], 0) / hist.length) : 0;
  const last = D.rehabHistory[D.rehabHistory.length - 1];
  const bar = (label, k) => `<div class="bar"><span>${label}</span><div class="track"><i style="display:block;height:100%;width:${Math.min(100, avg(k) * 2)}%;background:linear-gradient(90deg,#7c3aed,#e879f9);box-shadow:0 0 10px #a855f7"></i></div><b>${avg(k)}%</b></div>`;
  $('#reach-bars').innerHTML = bar('LEFT', 'l') + bar('RIGHT', 'r') + bar('UP', 'u') + bar('DOWN', 'd')
    + `<p class="dim small">Sessions: ${D.rehabHistory.length} · total reps ${D.rehabHistory.reduce((a, h) => a + h.reps, 0)}${last ? ' · last ' + last.reps + ' reps' : ''}</p>`;
  $('#rehab-list').textContent = hist.length ? hist.slice().reverse().map(h => `${h.date}  ${h.reps} reps · ${h.secs}s`).join('   |   ') : 'No rehab sessions yet. Turn on REHAB MODE and play.';
  drawHistory(hist);
}
function drawHistory(hist) {
  const c = $('#hist'), cx = c.getContext('2d');
  const w = c.clientWidth, h = c.clientHeight, d = window.devicePixelRatio || 1;
  c.width = w * d; c.height = h * d; cx.setTransform(d, 0, 0, d, 0, 0);
  cx.clearRect(0, 0, w, h);
  if (!hist.length) { cx.fillStyle = '#8b8ba3'; cx.font = '13px "JetBrains Mono"'; cx.fillText('> no data yet', 16, h / 2); return; }
  const max = Math.max(10, ...hist.map(x => x.reps));
  const bw = (w - 40) / Math.max(hist.length, 10);
  hist.forEach((x, i) => {
    const bh = (x.reps / max) * (h - 50), bx = 20 + i * bw + bw * 0.15, by = h - 26 - bh;
    cx.shadowColor = '#a855f7'; cx.shadowBlur = 12;
    cx.fillStyle = '#8b5cf6'; cx.fillRect(bx, by, bw * 0.7, bh);
    cx.shadowBlur = 0; cx.fillStyle = '#e9d5ff'; cx.font = '11px "JetBrains Mono"'; cx.textAlign = 'center';
    cx.fillText(x.reps, bx + bw * 0.35, by - 6);
  });
  cx.strokeStyle = 'rgba(168,85,247,.4)'; cx.beginPath(); cx.moveTo(20, h - 26); cx.lineTo(w - 20, h - 26); cx.stroke();
}

/* ---------- actions & wiring ---------- */
let pendingAfterCam = null;
function beginCamera(force) {
  showScreen('camera');
  if (camReady && !force) return beginCalibration();
  $('#cam-status').classList.remove('hidden');
  $('#cam-calib').classList.add('hidden'); $('#cam-err').classList.add('hidden');
  $('#skip-calib').classList.add('hidden');
  setCamMsg('Requesting camera access…');
  HandTracker.init(msg => setCamMsg(msg)).then(() => {
    camReady = true; mouseMode = false; HandTracker.setMode('camera');
    beginCalibration();
  }).catch(e => {
    const raw = String(e && e.message || e);
    const msg = raw.replace(/^[A-Z_]+:\s*/, '');
    $('#cam-status').classList.add('hidden');
    const box = $('#cam-err'); box.textContent = msg; box.classList.remove('hidden');
    phase = 'idle';
  });
}
function useMouse() {
  mouseMode = true; HandTracker.setMode('mouse'); phase = 'idle';
  if (pendingAfterCam) { const p = pendingAfterCam; pendingAfterCam = null; toast('MOUSE / TOUCH mode · move your pointer to slice'); return startRun(p.mode, p.idx); }
  $('#skip-calib').classList.add('hidden');
  toast('MOUSE / TOUCH mode · move your pointer to slice');
  showScreen('levels');
}
function finishSkip() { phase = 'idle'; afterSetup(); }

const actions = {
  play: () => { Sfx.click(); if (camReady) showScreen('levels'); else beginCamera(); },
  mouse: () => { Sfx.click(); useMouse(); },
  'cam-retry': () => beginCamera(true),
  'skip-calib': () => finishSkip(),
  recal: () => { Sfx.click(); if (mouseMode) return toast('Mouse mode has no calibration.'); beginCamera(true); },
  rehab: () => { S().settings.rehab = !S().settings.rehab; Store.save(); renderToggles(); toast(S().settings.rehab ? 'REHAB MODE on · slower, bigger fruit, reach tracking' : 'REHAB MODE off'); },
  mute: () => { S().settings.muted = !S().settings.muted; Store.save(); renderToggles(); toast(S().settings.muted ? 'sound muted' : 'sound on'); },
  'play-daily': () => { Sfx.click(); startRun('daily', 0); },
  claim: () => {
    const amt = Meta.claimLogin();
    if (amt) { toast(`+${fmt(amt)} login reward · day ${S().streak.count}`); Sfx.golden(); }
    showScreen('daily');
  },
  mission: (b) => { const amt = Meta.claimMission(b.dataset.id); if (amt) { toast(`mission complete · +${fmt(amt)}`); Sfx.coin(); } showScreen('daily'); },
  buy: (b) => {
    const it = SHOP.find(x => x.kind === b.dataset.kind && x.id === b.dataset.id);
    if (!it) return;
    if (!Store.spend(it.price)) return toast('not enough ₦ — play to earn more');
    const D = S();
    if (it.kind === 'trail') D.owned.trails.push(it.id); else D.owned.skins.push(it.id);
    Store.save(); Sfx.coin(); toast(`${it.name} unlocked`); renderShop(); updateWallets();
  },
  equip: (b) => {
    const D = S();
    if (b.dataset.kind === 'trail') D.equipped.trail = b.dataset.id; else D.equipped.skin = b.dataset.id;
    Store.save(); Sfx.click(); renderShop();
  },
  pause: () => pauseGame(),
  resume: () => resumeGame(),
  restart: () => { if (!run) return; const m = run.mode, i = run.idx; hideModals(); startRun(m, i); },
  quit: () => { hideModals(); phase = 'idle'; run = null; trail.length = 0; particles = []; texts = []; showScreen('levels'); },
  retry: () => { if (!run) return; const m = run.mode, i = run.idx; hideModals(); startRun(m, i); },
  next: (b) => {
    const r = run; hideModals();
    if (b.dataset.next === 'endless') return (() => { S().unlockedLevel = 11; Store.save(); startRun('endless', 0); })();
    startRun('level', Math.min(9, r.idx + 1));
  },
  share: async () => {
    const text = lastSummary;
    try { if (navigator.share) { await navigator.share({ title: 'SLICE NAIRA', text }); return; } } catch (e) { /* user cancelled */ }
    try { await navigator.clipboard.writeText(text); toast('score copied to clipboard'); }
    catch (e) { toast(text.slice(0, 80) + '…'); }
  },
  reset: () => { if (confirm('Erase wallet, scores, streak and settings on this device?')) { Store.reset(); location.reload(); } }
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act],[data-go]');
  if (!b || b.disabled) return;
  if (b.dataset.go) { Sfx.click(); showScreen(b.dataset.go); }
  if (b.dataset.act && actions[b.dataset.act]) actions[b.dataset.act](b);
});
$('#name-input').addEventListener('change', e => { S().settings.name = (e.target.value || 'anon').slice(0, 14); Store.save(); toast('name saved'); });

addEventListener('keydown', e => {
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
    if (phase === 'paused') resumeGame(); else pauseGame();
  }
  if (e.key === 'm' || e.key === 'M') { S().settings.muted = !S().settings.muted; Store.save(); renderToggles(); }
});
// Pause automatically if the tab is hidden.
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

/* Typewriter line on the landing page. */
(function typewriter() {
  const lines = ['> slice fruit with your index finger', '> dodge the bombs, keep the naira', '> same game, rehab mode for recovery'];
  let li = 0, ci = 0, del = false; const el = $('#typed');
  function tick() {
    const line = lines[li];
    if (!del) { el.textContent = line.slice(0, ++ci); if (ci >= line.length) { del = true; return setTimeout(tick, 1800); } }
    else { el.textContent = line.slice(0, --ci); if (ci <= 0) { del = false; li = (li + 1) % lines.length; return setTimeout(tick, 400); } }
    setTimeout(tick, del ? 18 : 42);
  }
  tick();
})();

/* Boot */
Meta.checkLogin();
renderToggles(); updateWallets(); renderLanding();
requestAnimationFrame(loop);
window.SliceNaira = { run: () => run, phase: () => phase };
})();
