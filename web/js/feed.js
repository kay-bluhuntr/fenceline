// Where events come from: replaying a .jsonl file, or a live WebSocket.
// Both paths go through normalize(), which treats every field as untrusted.
import { state, dispatch, resolveKey } from './world.js';
import { clip, normalize, parseLines } from './events.js';
import { isTranscript, summaryNumbers, transcriptToEvents } from './transcript.js';
import { setStatus } from './ledger.js';
import { LIMITS, ALLOWLIST } from './config.js';

let replayRaw = [], replaySrc = '', ws = null, wake = () => {}, wsBtn, urlInput;
// Set while replaying a Claude Code transcript: its summary for the "Your agent's day" card.
let transcriptDay = null;
// Live mode keeps trying to reach the collector until the user stops it,
// so starting the collector after the page (or restarting it) just works.
let retryTimer = 0, retryDelay = 0, wantLive = false;
const RETRY_MIN_MS = 1000, RETRY_MAX_MS = 15000;
export const isLocalPage = location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
let lastProblem = '';
let observerNote = '';   // from the collector's status message: which OS observer is running

export function initFeed(opts) {
  wake = opts.wake; wsBtn = opts.wsBtn; urlInput = opts.urlInput;
  opts.fileInput.addEventListener('change', onFile);
  wsBtn.addEventListener('click', toggleSocket);
}

function ingest(raw) {
  // A status message from the collector, not an event: say which OS observer is running.
  if (raw && raw.type === 'status') {
    observerNote = clip(String(raw.detail || raw.observer || ''), 160);
    return true;
  }
  try {
    dispatch(normalize(raw, { resolveKey, allowlist: ALLOWLIST, maxChars: LIMITS.maxFieldChars }));
    state.accepted++;
    return true;
  } catch (err) {
    state.rejected++;
    lastProblem = err.message;
    return false;
  }
}

function countsText() {
  const parts = [`${state.accepted} shown`];
  if (state.stats.fastForwarded) parts.push(`${state.stats.fastForwarded} without animation to keep up`);
  if (state.rejected) parts.push(`${state.rejected} skipped (last problem: ${lastProblem})`);
  return parts.join(', ');
}

/* ---------- replay ---------- */
export function hasReplay() { return replayRaw.length > 0; }

/** Seconds between events: real gaps, clamped. A transcript is squeezed to play in about a minute and a half. */
function replayGaps(raws, transcript) {
  let prev = null;
  const gaps = raws.map((raw, i) => {
    const t = raw && raw.ts ? Date.parse(raw.ts) : NaN;
    const real = prev !== null && !isNaN(t) ? (t - prev) / 1000 : NaN;
    if (!isNaN(t)) prev = t;
    if (i === 0) return 0;
    if (!transcript) return isNaN(real) ? 1.6 : Math.min(4, Math.max(.5, real));
    return isNaN(real) ? .4 : Math.min(3, Math.max(.15, real));
  });
  const total = gaps.reduce((a, b) => a + b, 0);
  const scale = transcript && total > LIMITS.transcriptSeconds ? LIMITS.transcriptSeconds / total : 1;
  return gaps.map((g) => (scale < 1 ? Math.max(.05, g * scale) : g));
}

export function startReplay() {
  if (!replayRaw.length) { setStatus('Choose a .jsonl file with one event per line.'); return; }
  const gaps = replayGaps(replayRaw, !!transcriptDay);
  let at = state.simT + .4;
  state.replayQ = replayRaw.map((raw, i) => { at += gaps[i]; return { at, raw }; });
  setStatus(transcriptDay
    ? `Replaying your Claude Code session: ${transcriptDay.toolCalls} tool calls. It never leaves this browser.`
    : `Replaying ${state.replayQ.length} events.`, 'ok');
  state.playing = true;
  wake();
}

/** Called once per tick by the scheduler in main.js. */
export function tickReplay() {
  let n = 0;
  while (state.replayQ.length && state.simT >= state.replayQ[0].at && n < 50) { ingest(state.replayQ.shift().raw); n++; }
  if (n && !state.replayQ.length) {
    setStatus(`Replay finished: ${countsText()}. Reset plays it again.`, state.rejected ? 'bad' : 'ok');
  }
}

/** The same-origin path of the replay loaded from a link, or '' for a picked file. */
export function replayLink() { return replaySrc; }

/**
 * Loads a replay from a path on this site, as in ?replay=replays/poisoned-package.jsonl.
 * Same origin only: a link must not be able to make this page show a feed from
 * somewhere else, because a fabricated breach would look like the real thing.
 */
export async function loadReplayUrl(path) {
  const name = clip(String(path), 80);
  if (location.protocol === 'file:') { setStatus('Replay links work on the hosted page or with npm start. Choose the file instead.', 'bad'); return false; }
  let url;
  try { url = new URL(String(path), location.href); } catch { url = null; }
  if (!url || url.origin !== location.origin || !/\.(jsonl|ndjson|json)$/i.test(url.pathname)) {
    setStatus('Replay links can only open .jsonl files from this site. Choose the file instead.', 'bad');
    return false;
  }
  setStatus(`Loading ${name}…`);
  try {
    const res = await fetch(url, { credentials: 'omit', cache: 'no-cache' });
    if (!res.ok) throw new Error(`the site answered ${res.status}`);
    if (Number(res.headers.get('content-length')) > LIMITS.maxReplayBytes) throw new Error('the file is too large');
    const text = await res.text();
    if (text.length > LIMITS.maxReplayBytes) throw new Error('the file is too large');
    if (state.mode !== 'file') return false;   // the user switched feeds while it loaded
    replayRaw = parseLines(text);
    transcriptDay = null;
    if (!replayRaw.length) { setStatus(`${name} has no events in it.`, 'bad'); return false; }
    const base = new URL('.', location.href).pathname;
    replaySrc = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname;
    clearHook();
    startReplay();
    loadedHook();
    dayHook(null);
    return true;
  } catch (e) {
    setStatus(`Couldn't load ${name}: ${e.message}. Choose the file instead.`, 'bad');
    return false;
  }
}

function onFile(ev) {
  const f = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (f) loadFile(f);
}

/**
 * Replay a file from disk: Fenceline events, or a Claude Code session transcript.
 * The file is read in the browser and never sent anywhere.
 */
export function loadFile(f) {
  const name = clip(f.name, 80);
  if (f.size > LIMITS.maxLocalFileBytes) { setStatus(`${name} is too large to replay here.`, 'bad'); return; }
  const rd = new FileReader();
  rd.onload = () => {
    const items = parseLines(String(rd.result));
    transcriptDay = null;
    if (isTranscript(items)) {
      const { events, summary } = transcriptToEvents(items);
      if (!events.length) { setStatus(`${name} is a Claude Code session with no tool calls to show.`, 'bad'); return; }
      replayRaw = events;
      transcriptDay = summaryNumbers(summary);
    } else {
      replayRaw = items;
      if (!replayRaw.length) { setStatus(`${name} has no events in it.`, 'bad'); return; }
    }
    replaySrc = '';
    clearHook();
    startReplay();
    loadedHook();
    dayHook(transcriptDay);
  };
  rd.onerror = () => setStatus(`Couldn't read ${name}. Try choosing it again.`, 'bad');
  rd.readAsText(f);
}
let clearHook = () => {}, loadedHook = () => {}, dayHook = () => {};
export function onClear(fn) { clearHook = fn; }
export function onReplayLoaded(fn) { loadedHook = fn; }
/** Called with the transcript summary when a session transcript is loaded, or null for other files. */
export function onTranscriptDay(fn) { dayHook = fn; }

/* ---------- live ---------- */
export function disconnect() {
  wantLive = false;
  clearTimeout(retryTimer); retryTimer = 0;
  if (ws) { const s0 = ws; ws = null; try { s0.close(); } catch { /* already closed */ } }
  observerNote = '';
  wsBtn.textContent = 'Connect';
}
export function isConnected() { return !!ws; }

function toggleSocket() {
  if (ws || retryTimer) { disconnect(); setStatus('Disconnected.'); return; }
  connect();
}

export function connect() {
  wantLive = true; retryDelay = 0;
  clearTimeout(retryTimer); retryTimer = 0;
  if (!ws) connectSocket();
}

function scheduleRetry(message) {
  wsBtn.textContent = 'Stop';
  retryDelay = Math.min(RETRY_MAX_MS, retryDelay ? retryDelay * 2 : RETRY_MIN_MS);
  setStatus(`${message} Retrying in ${Math.round(retryDelay / 1000)} s.`, 'bad');
  retryTimer = setTimeout(() => { retryTimer = 0; if (wantLive && !ws) connectSocket(); }, retryDelay);
}

function connectSocket() {
  const url = urlInput.value.trim();
  if (!/^wss?:\/\/\S+$/.test(url)) { wantLive = false; setStatus('Use a ws:// or wss:// address, such as ws://127.0.0.1:8765.', 'bad'); return; }
  let sock;
  try { sock = new WebSocket(url); } catch (e) { wantLive = false; setStatus(`Couldn't open ${url}: ${e.message}`, 'bad'); return; }
  ws = sock; wsBtn.textContent = 'Cancel';
  setStatus(`Connecting to ${url}…`);
  let opened = false, statusTimer = 0;
  sock.onopen = () => {
    if (ws !== sock) return;
    opened = true; retryDelay = 0; wsBtn.textContent = 'Disconnect';
    setStatus(`Connected to ${url}. Waiting for events.`, 'ok');
  };
  sock.onmessage = (m) => {
    if (ws !== sock) return;
    const data = typeof m.data === 'string' ? m.data : '';
    if (data.length > LIMITS.maxMessageBytes) { state.rejected++; lastProblem = 'message too large'; }
    else {
      const items = parseLines(data);
      const n = Math.min(items.length, LIMITS.maxLinesPerMessage);
      for (let i = 0; i < n; i++) ingest(items[i]);
      if (items.length > n) { state.rejected += items.length - n; lastProblem = `more than ${LIMITS.maxLinesPerMessage} lines in one message`; }
    }
    wake();
    // One status update per 250 ms at most, however fast events arrive.
    if (!statusTimer) statusTimer = setTimeout(() => {
      statusTimer = 0;
      if (ws === sock) setStatus(`Connected to ${url}. ${observerNote ? `${observerNote}. ` : ''}${countsText()}.`, state.rejected ? 'bad' : 'ok');
    }, 250);
  };
  // A failed attempt fires error then close; both outcomes are handled in onclose.
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null; wsBtn.textContent = 'Connect'; observerNote = '';
    const message = opened ? 'Connection closed by the collector.'
      : isLocalPage ? `Couldn't connect to ${url}. Start it with npm run collector.`
      : `Couldn't connect to ${url}. Hosted copies of this page may be blocked from reaching your Mac; run it locally with npm start.`;
    if (wantLive) scheduleRetry(message); else setStatus(message, 'bad');
  };
}

export function liveHint() {
  return isLocalPage
    ? 'Enter your collector’s WebSocket address and connect.'
    : 'Enter your collector’s WebSocket address. If this hosted copy can’t reach it, run Fenceline locally with npm start.';
}
