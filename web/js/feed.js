// Where events come from: replaying a .jsonl file, or a live WebSocket.
// Both paths go through normalize(), which treats every field as untrusted.
import { state, dispatch, resolveKey } from './world.js';
import { normalize, parseLines } from './events.js';
import { setStatus } from './ledger.js';
import { LIMITS, ALLOWLIST } from './config.js';

let replayRaw = [], ws = null, wake = () => {}, wsBtn, urlInput;
const isLocalPage = location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
let lastProblem = '';

export function initFeed(opts) {
  wake = opts.wake; wsBtn = opts.wsBtn; urlInput = opts.urlInput;
  opts.fileInput.addEventListener('change', onFile);
  wsBtn.addEventListener('click', toggleSocket);
}

function ingest(raw) {
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

export function startReplay() {
  if (!replayRaw.length) { setStatus('Choose a .jsonl file with one event per line.'); return; }
  let at = state.simT + .4, prev = null;
  state.replayQ = replayRaw.map((raw, i) => {
    const t = raw && raw.ts ? Date.parse(raw.ts) : NaN;
    if (i > 0) at += prev !== null && !isNaN(t) ? Math.min(4, Math.max(.5, (t - prev) / 1000)) : 1.6;
    if (!isNaN(t)) prev = t;
    return { at, raw };
  });
  setStatus(`Replaying ${state.replayQ.length} events.`, 'ok');
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

function onFile(ev) {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    replayRaw = parseLines(String(rd.result));
    ev.target.value = '';
    if (!replayRaw.length) { setStatus(`${f.name} has no events in it.`, 'bad'); return; }
    clearHook();
    startReplay();
  };
  rd.onerror = () => setStatus(`Couldn't read ${f.name}. Try choosing it again.`, 'bad');
  rd.readAsText(f);
}
let clearHook = () => {};
export function onClear(fn) { clearHook = fn; }

/* ---------- live ---------- */
export function disconnect() {
  if (ws) { const s0 = ws; ws = null; try { s0.close(); } catch { /* already closed */ } }
  wsBtn.textContent = 'Connect';
}
export function isConnected() { return !!ws; }

function toggleSocket() {
  if (ws) { disconnect(); setStatus('Disconnected.'); return; }
  const url = urlInput.value.trim();
  if (!/^wss?:\/\/\S+$/.test(url)) { setStatus('Use a ws:// or wss:// address, such as ws://localhost:8765.', 'bad'); return; }
  let sock;
  try { sock = new WebSocket(url); } catch (e) { setStatus(`Couldn't open ${url}: ${e.message}`, 'bad'); return; }
  ws = sock; wsBtn.textContent = 'Cancel';
  setStatus(`Connecting to ${url}…`);
  let opened = false, statusTimer = 0;
  sock.onopen = () => {
    if (ws !== sock) return;
    opened = true; wsBtn.textContent = 'Disconnect';
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
      if (ws === sock) setStatus(`Connected to ${url}. ${countsText()}.`, state.rejected ? 'bad' : 'ok');
    }, 250);
  };
  sock.onerror = () => {
    if (ws !== sock || opened) return;
    setStatus(isLocalPage
      ? `Couldn't connect to ${url}. Check your collector is running and listening there.`
      : `Couldn't connect to ${url}. Hosted copies of this page may be blocked from reaching your Mac; run it locally with npm start.`, 'bad');
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null; wsBtn.textContent = 'Connect';
    if (opened) setStatus('Connection closed by the collector.', 'bad');
  };
}

export function liveHint() {
  return isLocalPage
    ? 'Enter your collector’s WebSocket address and connect.'
    : 'Enter your collector’s WebSocket address. If this hosted copy can’t reach it, run Fenceline locally with npm start.';
}
