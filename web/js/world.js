// The simulated world: layout, characters, and what happens when an event arrives.
import { LIMITS, ALLOWLIST, DEFAULT_SLOTS, NET_SLOTS, DEFAULT_WORKSPACE } from './config.js';
import { siteOf, toolName, workspaceSegment, vaultLabel, clip } from './events.js';
import * as ledger from './ledger.js';

export const state = {
  W: 720, H: 500, s: 1, portrait: null, L: null,
  tiles: [], tools: [], vault: [],
  walkers: {}, ghosts: [], trails: [], rings: [], cracks: [], highlights: [],
  buildings: {}, hot: {}, lastUsed: {},
  stats: { events: 0, outside: 0, ghost: 0, breach: 0, fastForwarded: 0 },
  simT: 0, fenceAlarm: 0, renders: 0,
  mode: 'demo', playing: true, speed: 1,
  injectQ: [], replayQ: [], demoNext: .4, demoIdx: 0,
  accepted: 0, rejected: 0, lastTs: null,
  workspace: DEFAULT_WORKSPACE, staticDirty: true
};

// Set by main.js so the world can ask for visual side effects without importing the renderer.
export const hooks = { onBreach: () => {}, onWorkspace: () => {} };

/* ---------- layout ---------- */
function buildLayout(p) {
  const { tools, vault } = state;
  if (!p) {
    return {
      fence: { x: 200, y: 190, w: 320, h: 220 },
      slots: [...Array(NET_SLOTS)].map((_, i) => ({ x: 20 + 680 / NET_SLOTS * (i + .5), y: 70 })),
      zones: [
        { x: 14, y: 14, w: 692, h: 128, label: 'THE INTERNET' },
        { x: 14, y: 168, w: 158, h: 318, label: 'TOOLS' },
        { x: 548, y: 168, w: 158, h: 318, label: 'REST OF YOUR MAC' }
      ],
      gates: { net: { x: 360, y: 190, side: 'top' }, tools: { x: 200, y: 300, side: 'left' }, vault: { x: 520, y: 300, side: 'right' } },
      tools: tools.map((k, i) => ({ k, x: 72, y: 214 + i * 56, sx: 122, sy: 214 + i * 56 })),
      vault: vault.map(([k, label], i) => ({ k, label, x: 650, y: 222 + i * 66, sx: 596, sy: 222 + i * 66 }))
    };
  }
  return {
    fence: { x: 140, y: 296, w: 440, h: 280 },
    slots: [...Array(NET_SLOTS)].map((_, i) => ({ x: 20 + 680 / 3 * (i % 3 + .5), y: 80 + Math.floor(i / 3) * 104 })),
    zones: [
      { x: 14, y: 14, w: 692, h: 236, label: 'THE INTERNET' },
      { x: 14, y: 616, w: 692, h: 118, label: 'TOOLS' },
      { x: 14, y: 752, w: 692, h: 134, label: 'REST OF YOUR MAC' }
    ],
    gates: { net: { x: 360, y: 296, side: 'top' }, tools: { x: 250, y: 576, side: 'bottom' }, vault: { x: 470, y: 576, side: 'bottom' } },
    tools: tools.map((k, i) => ({ k, x: 20 + 680 / tools.length * (i + .5), y: 676, sx: 20 + 680 / tools.length * (i + .5), sy: 640 })),
    vault: vault.map(([k, label], i) => ({ k, label, x: 20 + 680 / vault.length * (i + .5), y: 816, sx: 20 + 680 / vault.length * (i + .5), sy: 780 }))
  };
}
// Slot changes only move dynamic sprites; the cached static layer stays valid.
function relayout() { if (state.portrait !== null) state.L = buildLayout(state.portrait); }

export function setLayout(portrait) {
  const first = state.portrait === null;
  state.portrait = portrait;
  state.L = buildLayout(portrait);
  state.staticDirty = true;
  if (!first) relayoutWorld();
}

export function tilePos(i) {
  const f = state.L.fence, cols = [.27, .73], rows = [.32, .74];
  return { x: f.x + f.w * cols[i % 2], y: f.y + f.h * rows[Math.floor(i / 2)] };
}

export function restoreSlots() {
  state.tiles = DEFAULT_SLOTS.tiles.map(t => [...t]);
  state.tools = [...DEFAULT_SLOTS.tools];
  state.vault = DEFAULT_SLOTS.vault.map(v => [...v]);
  relayout();
}

/* ---------- reset ---------- */
export function resetWorld() {
  state.walkers = {};
  for (const id of ['claude', 'copilot']) {
    state.walkers[id] = { id, x: 0, y: 0, path: [], queue: [], task: null, state: 'idle', wait: .3 + Math.random(), trail: null, phase: Math.random() * 6, idleFor: 0, asleep: false };
  }
  centreWalkers();
  Object.assign(state, {
    ghosts: [], trails: [], rings: [], cracks: [], highlights: [],
    buildings: {}, hot: {}, lastUsed: {},
    stats: { events: 0, outside: 0, ghost: 0, breach: 0, fastForwarded: 0 },
    simT: 0, fenceAlarm: 0, injectQ: [], replayQ: [], demoNext: .4, demoIdx: 0,
    accepted: 0, rejected: 0, lastTs: null
  });
  ALLOWLIST.forEach((d, i) => { state.buildings[d] = { key: d, slot: i, kind: 'known', built: 1, born: -1 }; });
}

export function clearWorld() {
  restoreSlots();
  resetWorld();
  setWorkspace(DEFAULT_WORKSPACE);
  const hint = { file: 'Choose a .jsonl file to replay it here.', live: 'Connect to a collector to see live events here.' }[state.mode];
  ledger.clearLedger(hint);
  ledger.statsChanged(state.stats);
}

export function setWorkspace(ws) {
  if (ws === state.workspace) return;
  state.workspace = ws;
  state.staticDirty = true;
  hooks.onWorkspace(ws);
}

function centreWalkers() {
  const f = state.L.fence; let i = 0;
  for (const w of Object.values(state.walkers)) { w.x = f.x + f.w * (.42 + i * .16); w.y = f.y + f.h * .52; i++; }
}

function relayoutWorld() {
  // The layout changed shape: finish in-flight trips instantly and start clean.
  for (const w of Object.values(state.walkers)) {
    if (w.task && w.state === 'going') arrive(w.task);
    w.task = null; w.path = []; w.state = 'idle'; w.wait = .5; w.trail = null;
  }
  for (const g of state.ghosts) if (!g.arrived) arrive(g.task);
  state.ghosts = []; state.trails = []; state.rings = []; state.cracks = [];
  centreWalkers();
}

/* ---------- map slots ---------- */
function busyKeys() {
  const busy = new Set();
  for (const w of Object.values(state.walkers)) {
    if (w.task) busy.add(w.task.z + ':' + w.task.k);
    for (const e of w.queue) busy.add(e.z + ':' + e.k);
  }
  for (const g of state.ghosts) busy.add(g.task.z + ':' + g.task.k);
  return busy;
}

// Least recently used slot that nothing is heading to right now.
function lruIndex(zone, keys) {
  const busy = busyKeys();
  let best = 0, bestT = Infinity;
  keys.forEach((k, i) => {
    const id = zone + ':' + k;
    if (busy.has(id)) return;
    const t = state.lastUsed[id] ?? -1;
    if (t < bestT) { bestT = t; best = i; }
  });
  return best;
}

function claim(zone, keys, i) { delete state.lastUsed[zone + ':' + keys[i]]; }

export function resolveKey(z, target) {
  if (z === 'net') return siteOf(target);
  if (z === 'fence') {
    const { seg, isDir } = workspaceSegment(target);
    const hit = state.tiles.find(t => t[0] === seg || t[1].replace(/\/$/, '') === seg);
    if (hit) return hit[0];
    const i = lruIndex('fence', state.tiles.map(t => t[0]));
    claim('fence', state.tiles.map(t => t[0]), i);
    state.tiles[i] = [seg, clip(seg, 10) + (isDir ? '/' : '')];
    return seg;
  }
  if (z === 'tools') {
    const name = toolName(target);
    if (state.tools.includes(name)) return name;
    const i = lruIndex('tools', state.tools);
    claim('tools', state.tools, i);
    state.tools[i] = name;
    relayout();
    return name;
  }
  const { known, label } = vaultLabel(target);
  if (known && state.vault.some(v => v[0] === known)) return known;
  // Known places keep their proper label (~/.ssh) even after being evicted and coming back.
  const slot = known ? DEFAULT_SLOTS.vault.find(v => v[0] === known) : [label, label];
  const hit = state.vault.find(v => v[0] === slot[0] || v[1] === slot[1]);
  if (hit) return hit[0];
  const i = lruIndex('vault', state.vault.map(v => v[0]));
  claim('vault', state.vault.map(v => v[0]), i);
  state.vault[i] = [...slot];
  relayout();
  return slot[0];
}

function getBuilding(key, bad) {
  const b0 = state.buildings[key];
  if (b0) { if (bad) b0.kind = 'bad'; return b0; }
  const used = new Set(Object.values(state.buildings).map(b => b.slot));
  let slot = [...Array(NET_SLOTS).keys()].find(i => !used.has(i));
  if (slot === undefined) {
    const busy = busyKeys();
    const candidates = Object.values(state.buildings).filter(b => !ALLOWLIST.includes(b.key));
    const old = (candidates.filter(b => !busy.has('net:' + b.key)).length ? candidates.filter(b => !busy.has('net:' + b.key)) : candidates)
      .sort((a, b) => (state.lastUsed['net:' + a.key] ?? a.born) - (state.lastUsed['net:' + b.key] ?? b.born))[0];
    slot = old.slot;
    delete state.buildings[old.key];
    delete state.lastUsed['net:' + old.key];
  }
  return (state.buildings[key] = { key, slot, kind: bad ? 'bad' : 'new', built: 0, born: state.simT });
}

export function targetPoint(z, k) {
  const L = state.L;
  if (z === 'fence') { const i = Math.max(0, state.tiles.findIndex(t => t[0] === k)); const p = tilePos(i); return { x: p.x, y: p.y + 30 }; }
  if (z === 'tools') { const t = L.tools.find(t => t.k === k) || L.tools[0]; return { x: t.sx, y: t.sy }; }
  if (z === 'vault') { const v = L.vault.find(v => v.k === k) || L.vault[0]; return { x: v.sx, y: v.sy }; }
  const b = state.buildings[k];
  if (!b) { const g = L.gates.net; return { x: g.x, y: g.y - 40 }; }   // building was recycled mid-trip
  const sl = L.slots[b.slot];
  return { x: sl.x, y: sl.y + 40 };
}

function gateHops(z) {
  const g = state.L.gates[z], d = 18;
  if (g.side === 'top') return [{ x: g.x, y: g.y + d }, { x: g.x, y: g.y - d }];
  if (g.side === 'bottom') return [{ x: g.x, y: g.y - d }, { x: g.x, y: g.y + d }];
  if (g.side === 'left') return [{ x: g.x + d, y: g.y }, { x: g.x - d, y: g.y }];
  return [{ x: g.x - d, y: g.y }, { x: g.x + d, y: g.y }];
}
function randInside() {
  const f = state.L.fence, m = 34;
  return { x: f.x + m + Math.random() * (f.w - 2 * m), y: f.y + m + Math.random() * (f.h - 2 * m) };
}
function insideFence(x, y) { const f = state.L.fence; return x > f.x && x < f.x + f.w && y > f.y && y < f.y + f.h; }

/* ---------- events ---------- */
function verdictFor(step) {
  if (step.v === 'breach') return 'breach';
  if (step.z === 'net' && !ALLOWLIST.includes(step.k)) {
    const b = state.buildings[step.k];
    return b && b.built ? (step.v === 'warn' ? 'warn' : 'ok') : 'warn';
  }
  return step.v;
}

function pad(n) { return String(Math.floor(n)).padStart(2, '0'); }
export function clockStr(t) {
  const x = Math.floor(22 * 3600 + 41 * 60 + 7 + t) % 86400;
  return `${pad(x / 3600)}:${pad((x % 3600) / 60)}:${pad(x % 60)}`;
}
export function fmtTs(ts) { const d = new Date(ts); return isNaN(d) ? null : d.toLocaleTimeString('en-GB', { hour12: false }); }
export function nowStr() { return new Date().toLocaleTimeString('en-GB', { hour12: false }); }

export function dispatch(step) {
  if (step.workspace) setWorkspace(step.workspace);
  const v = verdictFor(step);
  if (step.z === 'net') {
    const b = getBuilding(step.k, v === 'breach');
    if (v === 'ok' && b.kind === 'new' && b.built) b.kind = 'known';
  }
  const e = {
    ...step, v, rule: v === 'ok' ? undefined : step.rule,
    unreported: !step.said, at: state.simT, arrived: false, queued: false, rowEl: null
  };
  e.clock = (step.ts && fmtTs(step.ts)) || (state.mode === 'live' ? nowStr() : clockStr(state.simT));
  if (step.ts && fmtTs(step.ts)) state.lastTs = e.clock;
  state.lastUsed[e.z + ':' + e.k] = state.simT;

  const w = state.walkers[e.a];
  w.asleep = false; w.idleFor = 0;
  // Log every event when it happens; unreported ones already carry their OS observation.
  ledger.queueRow(e);
  if (e.said) {
    // Back-pressure: if this agent already has a backlog, show the result now instead of
    // queueing another walk. Keeps the map in real time under bursts.
    if (w.queue.length >= LIMITS.queuePerAgent) return fastForward(e);
    w.queue.push(e);
  } else {
    if (state.ghosts.length >= LIMITS.maxGhosts) return fastForward(e);
    state.ghosts.push({ task: e, x: w.x, y: w.y, path: [targetPoint(e.z, e.k)], arrived: false, fade: 1, wasIn: insideFence(w.x, w.y), trail: newTrail('ghost') });
  }
}

function fastForward(e) { state.stats.fastForwarded++; arrive(e); }

export function arrive(e) {
  if (e.arrived) return;
  e.arrived = true;
  const p = targetPoint(e.z, e.k);
  if (e.z === 'net') { const b = state.buildings[e.k]; if (b && !b.built) b.built = .001; }
  const col = e.v === 'breach' ? 'bad' : e.v === 'warn' ? 'warn' : (e.unreported ? 'ghost' : 'ok');
  state.rings.push({ x: p.x, y: p.y - 14, t: 0, life: 1.1, col });
  if (state.rings.length > LIMITS.maxRings) state.rings.shift();
  state.hot[e.z + ':' + e.k] = e.v === 'breach' ? 6 : 2.5;
  if (e.queued) ledger.markSeen(e); else ledger.queueRow(e);
  const st = state.stats;
  st.events++;
  if (e.z !== 'fence') st.outside++;
  if (e.unreported) st.ghost++;
  if (e.v === 'breach') { st.breach++; state.fenceAlarm = 1.6; ledger.queueIncident(e); hooks.onBreach(); }
  ledger.statsChanged(st);
}

/* ---------- trails ---------- */
function newTrail(kind, col) {
  const t = { kind, col, pts: [], age: 0, life: kind === 'ghost' ? 45 : 12 };
  state.trails.push(t);
  if (state.trails.length > LIMITS.maxTrails) state.trails.shift();
  return t;
}
function addPt(t, x, y) { const l = t.pts[t.pts.length - 1]; if (!l || Math.hypot(l.x - x, l.y - y) > 7) t.pts.push({ x, y }); }

/* ---------- simulation ---------- */
const SPEED = 120;
export function step(dt) {
  state.simT += dt;
  for (const w of Object.values(state.walkers)) stepWalker(w, dt);
  for (const g of state.ghosts) {
    if (g.arrived) { g.fade -= dt / 1.4; continue; }
    const t = g.path[0], dx = t.x - g.x, dy = t.y - g.y, d = Math.hypot(dx, dy), mv = SPEED * .85 * dt;
    if (d <= mv) { g.x = t.x; g.y = t.y; g.arrived = true; arrive(g.task); }
    else { g.x += dx / d * mv; g.y += dy / d * mv; }
    addPt(g.trail, g.x, g.y);
    const inn = insideFence(g.x, g.y);
    if (g.wasIn && !inn) state.cracks.push({ x: g.x, y: g.y, age: 0 });
    g.wasIn = inn;
  }
  state.ghosts = state.ghosts.filter(g => g.fade > 0);
  for (const t of state.trails) t.age += dt;
  state.trails = state.trails.filter(t => t.age < t.life);
  for (const r of state.rings) r.t += dt;
  state.rings = state.rings.filter(r => r.t < r.life);
  for (const c of state.cracks) c.age += dt;
  state.cracks = state.cracks.filter(c => c.age < 15);
  for (const b of Object.values(state.buildings)) if (b.built && b.built < 1) b.built = Math.min(1, b.built + dt * 2.2);
  for (const k in state.hot) { state.hot[k] -= dt; if (state.hot[k] <= 0) delete state.hot[k]; }
  if (state.fenceAlarm > 0) state.fenceAlarm -= dt;
}

function stepWalker(w, dt) {
  w.phase += dt * 9;
  if (w.path.length) {
    const t = w.path[0], dx = t.x - w.x, dy = t.y - w.y, d = Math.hypot(dx, dy), mv = SPEED * dt;
    if (d <= mv) { w.x = t.x; w.y = t.y; w.path.shift(); } else { w.x += dx / d * mv; w.y += dy / d * mv; }
    if (w.trail) addPt(w.trail, w.x, w.y);
    return;
  }
  if (w.state === 'going') { arrive(w.task); w.state = 'acting'; w.wait = .7; return; }
  if (w.state === 'acting') {
    w.wait -= dt;
    if (w.wait <= 0) {
      const e = w.task;
      w.path = e.z === 'fence' ? [randInside()] : [...gateHops(e.z).reverse(), randInside()];
      w.state = 'returning';
    }
    return;
  }
  if (w.state === 'returning') { w.state = 'idle'; w.task = null; w.trail = null; w.wait = .4 + Math.random() * .8; w.idleFor = 0; return; }
  if (w.asleep) return;
  w.idleFor += dt;
  w.wait -= dt;
  if (w.wait > 0) return;
  if (w.queue.length) {
    const e = w.queue.shift();
    w.task = e; w.state = 'going';
    const tp = targetPoint(e.z, e.k);
    w.path = e.z === 'fence' ? [tp] : [...gateHops(e.z), tp];
    w.trail = e.z === 'fence' ? null : newTrail('walk', e.v === 'breach' ? 'bad' : e.v === 'warn' ? 'warn' : 'ok');
    if (w.trail) addPt(w.trail, w.x, w.y);
  } else if (w.idleFor > LIMITS.idleSleepSec && state.mode !== 'demo') {
    w.asleep = true;   // nothing to do: stop wandering so the render loop can sleep too
  } else {
    w.path = [randInside()]; w.wait = 1 + Math.random() * 1.6;
  }
}

export function ageHighlights(dt) {
  for (const h of state.highlights) h.t += dt;
  state.highlights = state.highlights.filter(h => h.t < 2.6);
}

/** 'moving' needs smooth frames, 'fading' needs occasional frames, null means the loop can stop. */
export function activity() {
  if (state.highlights.length) return 'moving';
  if (!state.playing) return null;
  if (state.mode === 'demo' || state.injectQ.length || (state.mode === 'file' && state.replayQ.length)) return 'moving';
  for (const w of Object.values(state.walkers)) if (!w.asleep) return 'moving';
  if (state.ghosts.length || state.rings.length || state.fenceAlarm > 0) return 'moving';
  for (const b of Object.values(state.buildings)) if (b.built && b.built < 1) return 'moving';
  if (state.trails.length || state.cracks.length || Object.keys(state.hot).length) return 'fading';
  return null;
}

export function debugCounts() {
  return {
    walkerQueue: Object.values(state.walkers).reduce((n, w) => n + w.queue.length, 0),
    ghosts: state.ghosts.length, trails: state.trails.length, rings: state.rings.length,
    fastForwarded: state.stats.fastForwarded, renders: state.renders
  };
}
