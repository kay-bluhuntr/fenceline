// Boot, controls and the frame loop.
//
// The loop only runs while something on the map is changing. When the map is
// still (paused, or agents asleep in live mode) no frames are drawn at all,
// and a new event or click wakes it again.
import { LIMITS, REPO_URL } from './config.js';
import {
  state, hooks, setLayout, restoreSlots, resetWorld, clearWorld, dispatch, step,
  ageHighlights, activity, targetPoint, clockStr, nowStr, debugCounts, workspaceHeading
} from './world.js';
import { initRender, resize, render, readColours, invalidate, flash } from './render.js';
import { initLedger, setStatus, setQuiet, statsChanged } from './ledger.js';
import * as feed from './feed.js';
import { SCRIPT, INJECT } from './demo.js';

const $ = (s) => document.querySelector(s);
const wrap = $('#mapwrap'), clockEl = $('#clock');

/* ---------- loop ---------- */
let rafId = 0, lastTick = 0;

export function wake() {
  if (rafId) return;
  lastTick = performance.now() - 1000 / LIMITS.fpsMoving;
  rafId = requestAnimationFrame(frame);
}

function frame(now) {
  rafId = 0;
  const want = activity();
  const interval = 1000 / (want === 'fading' ? LIMITS.fpsFading : LIMITS.fpsMoving);
  if (want && now - lastTick < interval - 1) { rafId = requestAnimationFrame(frame); return; }
  const dt = Math.min(.1, (now - lastTick) / 1000);
  lastTick = now;
  if (state.playing) { schedule(); step(dt * state.speed); }
  ageHighlights(dt);
  render();
  state.renders++;
  updateClock();
  if (activity()) rafId = requestAnimationFrame(frame);
}

function schedule() {
  if (state.injectQ.length && state.simT >= state.injectQ[0].at) { dispatch(state.injectQ.shift().step); return; }
  if (state.mode === 'file') { feed.tickReplay(); return; }
  if (state.mode !== 'demo' || state.simT < state.demoNext) return;
  const backlog = Object.values(state.walkers).some(w => w.queue.length > 2);
  if (backlog) { state.demoNext = state.simT + .5; return; }
  const st = SCRIPT[state.demoIdx % SCRIPT.length];
  dispatch(st);
  state.demoIdx++;
  state.demoNext = state.simT + st.gap;
}

let lastClock = '';
function updateClock() {
  const c = state.mode === 'demo' ? clockStr(state.simT) : state.mode === 'live' ? nowStr() : (state.lastTs || '--:--:--');
  if (c !== lastClock) { clockEl.textContent = c; lastClock = c; }
}
setInterval(() => { if (state.mode === 'live' && !document.hidden) updateClock(); }, 1000);

function warmup(sec) {
  setQuiet(true);
  for (let t = 0; t < sec; t += .05) { schedule(); step(.05); }
  setQuiet(false);
}

/* ---------- wiring ---------- */
hooks.onBreach = flash;
hooks.onWorkspace = () => { $('#wsLabel').textContent = workspaceHeading(); };

initRender($('#map'), wrap);
initLedger({
  logEl: $('#log'), incEl: $('#incidents'), statusEl: $('#feedStatus'), incCountEl: $('#incCount'),
  statEls: { events: $('#sEvents'), outside: $('#sOutside'), ghost: $('#sGhost'), breach: $('#sBreach') },
  onSelect: (e) => {
    if (e.z === 'net' && !state.buildings[e.k]) return;
    const p = targetPoint(e.z, e.k);
    state.highlights = [{ x: p.x, y: p.y - 6, t: 0 }];
    wake();
  }
});
feed.initFeed({ wake, wsBtn: $('#wsBtn'), urlInput: $('#wsUrl'), fileInput: $('#fileIn') });
feed.onClear(() => clearWorld());

const playBtn = $('#play');
function setPlaying(p) { state.playing = p; playBtn.textContent = p ? 'Pause' : 'Play'; wake(); }
playBtn.addEventListener('click', () => setPlaying(!state.playing));

document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => {
  state.speed = +b.dataset.speed;
  document.querySelectorAll('[data-speed]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
}));

$('#inject').addEventListener('click', () => {
  let t = state.simT + .2;
  for (const st of INJECT) { state.injectQ.push({ at: t, step: st }); t += st.gap; }
  setPlaying(true);
});

$('#reset').addEventListener('click', () => {
  clearWorld();
  if (state.mode === 'demo') warmup(6);
  else if (state.mode === 'file') feed.startReplay();
  else setStatus(feed.isConnected() ? 'Map cleared. Still connected.' : 'Map cleared.', feed.isConnected() ? 'ok' : '');
  wake();
});

const PILL = { demo: 'Simulated feed', file: 'Replaying file', live: 'Live feed' };
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
function setMode(m, force = false) {
  if (m === state.mode && !force) return;
  if (state.mode === 'live') feed.disconnect();
  state.mode = m;
  document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x.dataset.mode === m ? 'true' : 'false'));
  $('#optFile').hidden = m !== 'file';
  $('#optLive').hidden = m !== 'live';
  $('#modePill').textContent = PILL[m];
  $('#inject').disabled = m !== 'demo';
  clearWorld();
  updateShare();
  if (m === 'demo') { warmup(6); setStatus('Scripted demo events. Switch to Replay file or Live to drive the map with your own events.'); }
  else if (m === 'file') { if (feed.hasReplay()) feed.startReplay(); else setStatus('Choose a .jsonl file with one event per line. The format is described at the bottom of the page.'); }
  else {
    setStatus(feed.liveHint());
    if (location.protocol !== 'file:') feed.connect();
  }
  wake();
}

/* ---------- sharing (hosted copies only) ---------- */
// A link to what's on screen: the demo, or a replay that was opened from a link.
// Live and picked files can't be shared, because they only exist on this Mac.
const shareBtn = $('#share');
function shareUrl() {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  if (state.mode === 'demo') u.searchParams.set('feed', 'demo');
  else if (state.mode === 'file' && feed.replayLink()) u.searchParams.set('replay', feed.replayLink());
  else return '';
  return u.toString();
}
function updateShare() { shareBtn.hidden = feed.isLocalPage || !shareUrl(); }
shareBtn.addEventListener('click', async () => {
  const url = shareUrl();
  if (!url) return;
  try { await navigator.clipboard.writeText(url); setStatus('Link copied. Anyone with it sees this replay in their browser.', 'ok'); }
  catch { setStatus(`Copy this link to share: ${url}`, 'ok'); }
});

/* ---------- environment ---------- */
const redraw = () => { readColours(); wake(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
new ResizeObserver(() => {
  const portrait = resize();
  if (portrait !== state.portrait) setLayout(portrait);
  wake();
}).observe(wrap);
if (document.fonts?.ready) document.fonts.ready.then(() => { invalidate(); wake(); });

// Read-only counters for tests and benchmarks.
window.fencelineDebug = debugCounts;

/* ---------- boot ---------- */
// Locally (npm start or the file opened from disk) Fenceline watches this Mac, so it
// opens Live. A hosted copy can't see the visitor's Mac, so it opens the demo instead.
// ?feed=demo|replay|live and ?replay=<path on this site> override either.
const params = new URLSearchParams(location.search);
const FEED_PARAM = { demo: 'demo', replay: 'file', file: 'file', live: 'live' };
const replayParam = params.get('replay');
const startMode = replayParam ? 'file' : FEED_PARAM[params.get('feed')] || (feed.isLocalPage ? 'live' : 'demo');

if (!feed.isLocalPage) {
  $('#hosted').hidden = false;
  $('#hostedRepo').href = REPO_URL;
  $('#sampleReplay').hidden = false;
  $('#brandSub').textContent = 'Simulated session';
}
feed.onReplayLoaded(updateShare);

setLayout(resize());
restoreSlots();
resetWorld();
setMode(startMode, true);
if (replayParam) feed.loadReplayUrl(replayParam);
statsChanged(state.stats);
wake();
