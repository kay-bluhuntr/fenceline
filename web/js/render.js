// Canvas renderer. Everything that never moves (ground, zones, workspace floor)
// is drawn once into an offscreen layer and blitted each frame.
import { state, tilePos } from './world.js';
import { AGENTS } from './config.js';

const FONT = {
  mono: "'JetBrains Mono', ui-monospace, Menlo, monospace",
  pix: "'Silkscreen', 'Courier New', monospace",
  sans: "'IBM Plex Sans', system-ui, sans-serif"
};
const TOKENS = ['bg', 'surface', 'ink', 'muted', 'line', 'grass', 'grass2', 'zone', 'fence', 'accent', 'agent2', 'ok', 'warn', 'bad', 'ghost'];
const C = {};
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let canvas, ctx, wrap, g, dpr = 1;
const layer = document.createElement('canvas');
const lctx = layer.getContext('2d');
const tagWidths = new Map();

export function initRender(canvasEl, wrapEl) {
  canvas = canvasEl; wrap = wrapEl; ctx = canvas.getContext('2d');
  readColours();
}

export function readColours() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of TOKENS) C[k] = cs.getPropertyValue('--' + k).trim();
  invalidate();
}
export function invalidate() { state.staticDirty = true; tagWidths.clear(); }

/** Returns the portrait flag the current width calls for. */
export function resize() {
  const cw = wrap.clientWidth || 600;
  const portrait = cw < 620;
  state.W = 720; state.H = portrait ? 900 : 500;
  state.s = cw / state.W;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.style.height = (state.H * state.s) + 'px';
  const w = Math.round(cw * dpr), h = Math.round(state.H * state.s * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; invalidate(); }
  return portrait;
}

export function flash() { wrap.classList.remove('alarm'); void wrap.offsetWidth; wrap.classList.add('alarm'); }

/* ---------- primitives (draw into g) ---------- */
function withA(a, fn) { g.save(); g.globalAlpha *= a; fn(); g.restore(); }
function txt(str, x, y, o = {}) {
  g.font = `${o.w || 400} ${(o.size || 11) / state.s}px ${FONT[o.f || 'mono']}`;
  g.fillStyle = o.col || C.ink; g.textAlign = o.align || 'center'; g.textBaseline = o.base || 'middle';
  g.fillText(str, x, y);
}
function rrect(x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }

/* ---------- static layer ---------- */
function drawStatic() {
  layer.width = canvas.width; layer.height = canvas.height;
  g = lctx;
  g.setTransform(state.s * dpr, 0, 0, state.s * dpr, 0, 0);
  const { W, H, L } = state;
  g.fillStyle = C.grass; g.fillRect(0, 0, W, H);
  g.fillStyle = C.grass2;
  const q = 24;
  for (let y = 0; y < H; y += q) for (let x = (y / q) % 2 ? q : 0; x < W; x += q * 2) g.fillRect(x, y, q, q);
  for (const z of L.zones) {
    rrect(z.x, z.y, z.w, z.h, 8); g.fillStyle = C.zone; g.fill();
    g.setLineDash([5, 5]); g.strokeStyle = C.line; g.lineWidth = 1.5; g.stroke(); g.setLineDash([]);
    txt(z.label, z.x + 10, z.y + 12, { f: 'pix', size: 9, col: C.muted, align: 'left' });
  }
  const f = L.fence;
  g.fillStyle = C.grass2; g.fillRect(f.x, f.y, f.w, f.h);
  withA(.06, () => { g.fillStyle = C.accent; g.fillRect(f.x, f.y, f.w, f.h); });
  txt('WORKSPACE · ' + state.workspace, f.x + 4, f.y - 11, { f: 'pix', size: 9, col: C.muted, align: 'left' });
  state.staticDirty = false;
}

/* ---------- dynamic parts ---------- */
function drawTiles() {
  state.tiles.forEach(([k, label], i) => {
    const p = tilePos(i), w = 76, h = 34, hot = state.hot['fence:' + k];
    rrect(p.x - w / 2, p.y - h / 2, w, h, 4); g.fillStyle = C.surface; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = hot ? C.ok : C.line; g.stroke();
    txt(label, p.x, p.y, { size: 11 });
  });
}

function drawRails() {
  const f = state.L.fence, alarm = state.fenceAlarm > 0, gapW = 30;
  const col = alarm ? C.bad : C.fence;
  const sides = [
    { a: { x: f.x, y: f.y }, b: { x: f.x + f.w, y: f.y }, side: 'top' },
    { a: { x: f.x + f.w, y: f.y }, b: { x: f.x + f.w, y: f.y + f.h }, side: 'right' },
    { a: { x: f.x, y: f.y + f.h }, b: { x: f.x + f.w, y: f.y + f.h }, side: 'bottom' },
    { a: { x: f.x, y: f.y }, b: { x: f.x, y: f.y + f.h }, side: 'left' }
  ];
  g.save();
  g.globalAlpha = alarm && !reduced ? .55 + .45 * Math.sin(state.fenceAlarm * 14) : 1;
  if (alarm) { g.shadowColor = C.bad; g.shadowBlur = 12; }
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2;
  for (const sd of sides) {
    const horiz = sd.a.y === sd.b.y;
    const gates = Object.values(state.L.gates).filter(x => x.side === sd.side).map(x => horiz ? x.x : x.y).sort((a, b) => a - b);
    let start = horiz ? sd.a.x : sd.a.y;
    const end = horiz ? sd.b.x : sd.b.y, segs = [];
    for (const gx of gates) { segs.push([start, gx - gapW / 2]); start = gx + gapW / 2; }
    segs.push([start, end]);
    g.beginPath();
    for (const [s0, s1] of segs) for (const off of [-3, 3]) {
      if (horiz) { g.moveTo(s0, sd.a.y + off); g.lineTo(s1, sd.a.y + off); }
      else { g.moveTo(sd.a.x + off, s0); g.lineTo(sd.a.x + off, s1); }
    }
    g.stroke();
    for (const [s0, s1] of segs) for (let q = s0; q <= s1 + .1; q += 20) {
      const qq = Math.min(q, s1);
      if (horiz) g.fillRect(qq - 2.5, sd.a.y - 6, 5, 12); else g.fillRect(sd.a.x - 6, qq - 2.5, 12, 5);
    }
  }
  g.restore();
  g.fillStyle = C.fence;
  for (const gt of Object.values(state.L.gates)) {
    if (gt.side === 'top' || gt.side === 'bottom') { g.fillRect(gt.x - gapW / 2 - 4, gt.y - 8, 6, 16); g.fillRect(gt.x + gapW / 2 - 2, gt.y - 8, 6, 16); }
    else { g.fillRect(gt.x - 8, gt.y - gapW / 2 - 4, 16, 6); g.fillRect(gt.x - 8, gt.y + gapW / 2 - 2, 16, 6); }
  }
}

function drawBuildings() {
  const bySlot = [];
  for (const b of Object.values(state.buildings)) bySlot[b.slot] = b;
  state.L.slots.forEach((sl, i) => {
    const b = bySlot[i];
    if (!b || !b.built) {
      rrect(sl.x - 28, sl.y - 16, 56, 34, 3);
      g.setLineDash([3, 4]); g.strokeStyle = C.line; g.lineWidth = 1.5; g.stroke(); g.setLineDash([]);
      txt(b ? '?' : 'empty plot', sl.x, sl.y + 1, { size: b ? 14 : 9, col: C.muted, f: b ? 'pix' : 'mono' });
      if (b) txt(b.key, sl.x, sl.y + 32, { size: 10, col: C.muted });
      return;
    }
    const e = 1 - Math.pow(1 - Math.min(1, b.built), 3);
    const hot = state.hot['net:' + b.key];
    const roof = b.kind === 'bad' ? C.bad : b.kind === 'new' ? C.warn : C.muted;
    g.save(); g.translate(sl.x, sl.y + 18); g.scale(1, e); g.translate(-sl.x, -(sl.y + 18));
    g.fillStyle = C.surface; g.strokeStyle = hot ? roof : C.ink; g.lineWidth = 1.5;
    g.fillRect(sl.x - 26, sl.y - 6, 52, 24); g.strokeRect(sl.x - 26, sl.y - 6, 52, 24);
    g.beginPath(); g.moveTo(sl.x - 31, sl.y - 6); g.lineTo(sl.x, sl.y - 22); g.lineTo(sl.x + 31, sl.y - 6); g.closePath();
    g.fillStyle = roof; g.fill();
    g.fillStyle = C.line;
    for (const wx of [-17, -5, 7]) g.fillRect(sl.x + wx, sl.y, 8, 6);
    g.fillStyle = C.ink; g.fillRect(sl.x + 15, sl.y + 6, 6, 12);
    g.restore();
    const label = b.key.length > 22 ? b.key.slice(0, 21) + '…' : b.key;
    txt(label, sl.x, sl.y + 30, { size: 10, col: b.kind === 'bad' ? C.bad : b.kind === 'new' ? C.warn : C.ink, w: b.kind === 'known' ? 400 : 500 });
    if (b.kind === 'bad') txt('UNKNOWN', sl.x, sl.y - 30, { f: 'pix', size: 8, col: C.bad });
    else if (b.kind === 'new') txt('NEW', sl.x, sl.y - 30, { f: 'pix', size: 8, col: C.warn });
  });
}

function drawTools() {
  for (const t of state.L.tools) {
    const hot = state.hot['tools:' + t.k];
    g.fillStyle = C.surface; g.strokeStyle = hot ? C.ok : C.ink; g.lineWidth = 1.5;
    g.fillRect(t.x - 17, t.y - 8, 34, 20); g.strokeRect(t.x - 17, t.y - 8, 34, 20);
    g.beginPath(); g.moveTo(t.x - 21, t.y - 8); g.lineTo(t.x, t.y - 20); g.lineTo(t.x + 21, t.y - 8); g.closePath();
    g.fillStyle = C.fence; g.fill();
    txt('>_', t.x, t.y + 2, { size: 9, col: C.muted });
    txt(t.k.length > 12 ? t.k.slice(0, 11) + '…' : t.k, t.x, t.y + 24, { size: 10 });
  }
}

function drawVault() {
  for (const v of state.L.vault) {
    const hot = state.hot['vault:' + v.k];
    const hc = hot ? (hot > 3 ? C.bad : C.warn) : C.ink;
    g.save();
    if (hot && hot > 3) { g.shadowColor = C.bad; g.shadowBlur = 14; }
    g.fillStyle = C.surface; g.strokeStyle = hc; g.lineWidth = hot ? 2.5 : 1.5;
    rrect(v.x - 20, v.y - 15, 40, 30, 3); g.fill(); g.stroke();
    g.restore();
    g.beginPath(); g.arc(v.x, v.y, 7, 0, Math.PI * 2); g.strokeStyle = hc; g.lineWidth = 1.5; g.stroke();
    g.beginPath(); g.moveTo(v.x, v.y); g.lineTo(v.x + 5, v.y - 3); g.stroke();
    txt(v.label, v.x, v.y + 27, { size: 10, col: hot ? hc : C.ink });
  }
}

function drawTrails() {
  for (const t of state.trails) {
    if (t.pts.length < 2) continue;
    const a = Math.max(0, 1 - t.age / t.life);
    if (t.kind === 'ghost') {
      g.fillStyle = C.ghost;
      withA(.25 + .65 * a, () => {
        g.beginPath();
        t.pts.forEach((p, i) => { const off = i % 2 ? 2.5 : -2.5; g.rect(p.x + off - 1.5, p.y - 1.5, 3, 3); });
        g.fill();
      });
    } else {
      g.strokeStyle = C[t.col]; g.lineWidth = 2; g.setLineDash([6, 5]);
      withA(.8 * a, () => { g.beginPath(); t.pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke(); });
      g.setLineDash([]);
    }
  }
  g.strokeStyle = C.bad; g.lineWidth = 2.5;
  for (const c of state.cracks) {
    withA(Math.max(0, 1 - c.age / 15), () => {
      g.beginPath(); g.moveTo(c.x - 7, c.y - 7); g.lineTo(c.x - 2, c.y - 1); g.lineTo(c.x - 5, c.y + 3); g.lineTo(c.x + 7, c.y + 7);
      g.moveTo(c.x + 7, c.y - 7); g.lineTo(c.x + 1, c.y - 2); g.lineTo(c.x - 7, c.y + 6); g.stroke();
    });
  }
}

function drawRings() {
  for (const r of state.rings) {
    const k = r.t / r.life;
    withA(1 - k, () => { g.strokeStyle = C[r.col]; g.lineWidth = 2.5; g.beginPath(); g.arc(r.x, r.y, 8 + k * 26, 0, Math.PI * 2); g.stroke(); });
  }
  for (const h of state.highlights) {
    const k = (h.t % 1.3) / 1.3;
    withA(1 - k, () => { g.strokeStyle = C.ink; g.lineWidth = 2; g.beginPath(); g.arc(h.x, h.y - 10, 14 + k * 22, 0, Math.PI * 2); g.stroke(); });
  }
}

function robot(x, y, col, phase, moving, ghost) {
  const bob = moving && !reduced ? Math.abs(Math.sin(phase)) * 2 : 0;
  g.save(); g.translate(x, y - bob);
  if (!ghost) { g.fillStyle = C.ink; withA(.18, () => { g.beginPath(); g.ellipse(0, bob + 1, 9, 3, 0, 0, Math.PI * 2); g.fill(); }); }
  g.fillStyle = col;
  const lg = moving && !reduced ? Math.sin(phase) * 2 : 0;
  if (!ghost) { g.fillRect(-5, -4 + lg, 3, 4); g.fillRect(2, -4 - lg, 3, 4); }
  else { g.beginPath(); g.moveTo(-7, -4); for (let i = 0; i <= 4; i++) g.lineTo(-7 + i * 3.5, i % 2 ? 0 : -4); g.lineTo(7, -8); g.lineTo(-7, -8); g.fill(); }
  g.fillRect(-7, -14, 14, 10);
  g.fillRect(-6, -25, 12, 10);
  g.fillRect(-1, -30, 2, 5); g.fillRect(-2, -32, 4, 3);
  g.fillStyle = C.surface; g.fillRect(-4, -22, 3, 3); g.fillRect(1, -22, 3, 3);
  g.restore();
}

function tag(x, y, label, col) {
  const s = state.s, key = label;
  g.font = `600 ${10 / s}px ${FONT.sans}`;
  let tw = tagWidths.get(key);
  if (tw === undefined) { tw = g.measureText(label).width; tagWidths.set(key, tw); }
  const pad = 5 / s, h = 15 / s;
  rrect(x - tw / 2 - pad, y - h, tw + pad * 2, h, 3 / s); g.fillStyle = col; g.fill();
  txt(label, x, y - h / 2, { f: 'sans', size: 10, w: 600, col: C.bg });
}

function drawActors() {
  const list = [];
  for (const w of Object.values(state.walkers)) list.push({ y: w.y, draw: () => {
    const col = C[AGENTS[w.agent].colour];
    robot(w.x, w.y, col, w.phase, w.path.length > 0, false);
    tag(w.x, w.y - 36, w.label || AGENTS[w.agent].name, col);
    if (w.asleep) txt('z z', w.x + 16, w.y - 58, { f: 'pix', size: 9, col: C.muted });
  } });
  for (const gh of state.ghosts) list.push({ y: gh.y, draw: () => withA(.62 * Math.max(0, gh.fade), () => {
    robot(gh.x, gh.y, C.ghost, 0, false, true);
    tag(gh.x, gh.y - 36, 'unreported', C.ghost);
  }) });
  list.sort((a, b) => a.y - b.y);
  for (const it of list) it.draw();
}

export function render() {
  if (!state.L) return;
  if (state.staticDirty) drawStatic();
  g = ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer, 0, 0);
  ctx.setTransform(state.s * dpr, 0, 0, state.s * dpr, 0, 0);
  drawTiles(); drawRails(); drawBuildings(); drawTools(); drawVault();
  drawTrails(); drawRings(); drawActors();
}
