// Activity log, incidents and the stats bar.
// DOM writes are batched into one flush per animation frame, so a burst of
// hundreds of events costs one small DOM update instead of hundreds.
import { AGENTS, LIMITS } from './config.js';
import { esc } from './events.js';

let logEl, incEl, statusEl, incCountEl, statEls, onSelect = () => {};
let pendingRows = [], pendingInc = [], pendingStats = null, scheduled = false, incidents = 0, quiet = false;
const rowEvent = new WeakMap();
const SAMPLED_HINT = 'Found by periodic sampling. Real, but quick actions between samples can be missed.';

export function initLedger(opts) {
  ({ logEl, incEl, statusEl, incCountEl, statEls } = opts);
  onSelect = opts.onSelect;
  const pick = (ev) => {
    const el = ev.target.closest('[data-ev]');
    const e = el && rowEvent.get(el);
    if (e) onSelect(e);
  };
  logEl.addEventListener('click', pick);
  incEl.addEventListener('click', pick);
  logEl.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[data-ev]')) { ev.preventDefault(); pick(ev); }
  });
}

/** While quiet, new rows skip the highlight flash (used for the warm-up before first paint). */
export function setQuiet(q) { quiet = q; }

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(flush);
}

export function queueRow(e) {
  e.queued = true;
  e.quiet = quiet;
  pendingRows.push(e);
  if (pendingRows.length > LIMITS.logRows) pendingRows.shift();   // never build rows that would be trimmed straight away
  schedule();
}

export function markSeen(e) {
  if (e.rowEl) { const el = e.rowEl.querySelector('.seen'); if (el) el.innerHTML = seenHtml(e); }
  // A row still waiting in pendingRows reads e.arrived when it is built.
}

export function queueIncident(e) {
  incidents++;
  pendingInc.push(e);
  if (pendingInc.length > LIMITS.incidentsShown) pendingInc.shift();
  schedule();
}

export function statsChanged(stats) { pendingStats = stats; schedule(); }

export function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

export function clearLedger(hint) {
  pendingRows = []; pendingInc = []; incidents = 0;
  logEl.replaceChildren();
  if (hint) { const li = document.createElement('li'); li.className = 'emptyrow'; li.textContent = hint; logEl.append(li); }
  incEl.innerHTML = '<div class="empty">Out-of-bounds or unreported actions land here.</div>';
  incCountEl.textContent = 'none yet';
}

/* ---------- building ---------- */
function pills(e) {
  const out = [];
  if (e.v === 'breach') out.push('<span class="pill bad">Breach</span>');
  else if (e.v === 'warn') out.push('<span class="pill warn">Check</span>');
  else out.push(`<span class="pill ok">${e.z === 'fence' ? 'Inside' : 'Allowed'}</span>`);
  if (e.unreported) out.push('<span class="pill ghost">Seen only</span>');
  if (e.seen.length && e.seen.every(([, , sampled]) => sampled)) {
    out.push(`<span class="pill sampled" title="${SAMPLED_HINT}">Sampled</span>`);
  }
  return out.join('');
}
function seenHtml(e) {
  if (!e.arrived && !e.unreported) return '<div class="ln wait"><b>SEEN</b><code>waiting for OS event…</code></div>';
  return e.seen.map(([src, t, sampled]) => sampled
    ? `<div class="ln sampled"><b title="${SAMPLED_HINT}">${esc(src)}</b><code>${esc(t)}</code></div>`
    : `<div class="ln"><b>${esc(src)}</b><code>${esc(t)}</code></div>`).join('');
}
function buildRow(e) {
  const li = document.createElement('li');
  li.className = e.quiet ? 'row' : 'row fresh';
  li.tabIndex = 0;
  li.dataset.ev = '';
  const agent = AGENTS[e.a];
  li.innerHTML = `
    <div class="rh"><time>${esc(e.clock)}</time><span class="chip ${e.a === 'copilot' ? 'copilot' : 'claude'}">${esc(agent.name)}${e.sessionLabel ? ` · ${esc(e.sessionLabel)}` : ''}</span><span class="t">${esc(e.title)}</span>${pills(e)}</div>
    <div class="ln${e.said ? '' : ' none'}"><b>SAID</b><code>${e.said ? esc(e.said) : 'nothing reported'}</code></div>
    <div class="seen">${seenHtml(e)}</div>
    ${e.rule ? `<div class="rule">${esc(e.rule)}</div>` : ''}`;
  rowEvent.set(li, e);
  e.rowEl = li;
  return li;
}
function buildIncident(e) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'inc'; b.dataset.ev = '';
  b.innerHTML = `<span class="r1"><time>${esc(e.clock)}</time>${esc(AGENTS[e.a].name)}: ${esc(e.title)}</span><span class="r2">${esc(e.rule || '')}${e.unreported ? ' · never reported by the agent' : ''}</span>`;
  rowEvent.set(b, e);
  return b;
}

function flush() {
  scheduled = false;
  if (pendingRows.length) {
    logEl.querySelector('.emptyrow')?.remove();
    const frag = document.createDocumentFragment();
    for (const e of pendingRows) frag.prepend(buildRow(e));
    pendingRows = [];
    logEl.prepend(frag);
    while (logEl.childElementCount > LIMITS.logRows) logEl.lastElementChild.remove();
  }
  if (pendingInc.length) {
    incEl.querySelector('.empty')?.remove();
    const frag = document.createDocumentFragment();
    for (const e of pendingInc) frag.prepend(buildIncident(e));
    pendingInc = [];
    incEl.prepend(frag);
    while (incEl.childElementCount > LIMITS.incidentsShown) incEl.lastElementChild.remove();
    incCountEl.textContent = `${incidents} raised${incidents > LIMITS.incidentsShown ? ` · latest ${LIMITS.incidentsShown}` : ''}`;
  }
  if (pendingStats) {
    const s = pendingStats; pendingStats = null;
    statEls.events.textContent = s.events;
    statEls.outside.textContent = s.outside;
    statEls.ghost.textContent = s.ghost;
    statEls.breach.textContent = s.breach;
  }
}
