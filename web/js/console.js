// The console: every event in one filterable table, with what the agent said beside what
// the Mac saw, and a coverage line that says whether anything was actually watching.
// One render per animation frame, however many events arrive.
import { AGENTS, ALLOWLIST, LIMITS } from './config.js';
import { esc, normalize } from './events.js';

const SHOWN = 500;                     // rows drawn at once; the rest are counted, filtered and exported
const ZONE = { fence: 'Workspace', net: 'Internet', tools: 'Process', vault: 'Outside workspace' };
const VERDICT = { breach: ['bad', 'Breach'], warn: ['warn', 'Check'], ok: ['ok', 'Allowed'] };
const OBSERVER = { es: 'Endpoint Security: every process launch and file open', lite: 'Lite: sampled, so short actions can be missed',
  none: 'None: only what the agent reports is shown, so nothing can show as unreported' };

let els, events = [], observer = '', feedLabel = '', scheduled = false, seq = 0;   // seq numbers rows, so an open one stays open
let filters = { a: '', s: '', z: '', v: '', u: false, q: '' };

/** True when event `e` passes filters `f`. Pure, so it's unit-tested in Node. */
export function matches(e, f) {
  if (f.a && e.a !== f.a) return false;
  if (f.s && (e.session || e.workspace || '') !== f.s) return false;
  if (f.z && e.z !== f.z) return false;
  if (f.v && e.v !== f.v) return false;
  if (f.u && e.said) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    const text = [e.title, e.said, e.rule, e.raw?.target, e.k, e.workspace, ...e.seen.map(([, t]) => t)].join('\n').toLowerCase();
    if (!text.includes(q)) return false;
  }
  return true;
}

/** Filters to and from the URL hash, so a filtered view can be linked. */
export function filtersFromHash(hash) {
  const p = new URLSearchParams(String(hash).replace(/^#/, ''));
  return { a: p.get('a') || '', s: p.get('s') || '', z: p.get('z') || '', v: p.get('v') || '', u: p.get('u') === '1', q: p.get('q') || '' };
}
function filtersToHash(f) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v === true ? '1' : v);
  return p.toString();
}

export function initConsole(opts) {
  els = opts;
  filters = filtersFromHash(location.hash);
  const { fAgent, fSession, fZone, fVerdict, fUnreported, fText, exportBtn } = els;
  fAgent.value = filters.a; fZone.value = filters.z; fVerdict.value = filters.v; fUnreported.checked = filters.u; fText.value = filters.q;
  const read = () => {
    filters = { a: fAgent.value, s: fSession.value, z: fZone.value, v: fVerdict.value, u: fUnreported.checked, q: fText.value.trim() };
    try { history.replaceState(null, '', `${location.pathname}${location.search}${filtersToHash(filters) ? '#' + filtersToHash(filters) : ''}`); } catch { /* file: pages can refuse */ }
    schedule();
  };
  for (const el of [fAgent, fSession, fZone, fVerdict, fUnreported]) el.addEventListener('change', read);
  fText.addEventListener('input', read);
  exportBtn.addEventListener('click', exportShown);
  schedule();
}

/** One event as the map dispatched it (demo and live), or as normalised from a file. */
export function addEvent(e) {
  events.push({ ...e, n: ++seq });
  if (events.length > LIMITS.consoleEvents) events.shift();
  schedule();
}
/** A whole replay file at once, so an analyst sees it all without waiting for the map to play it. */
export function loadRaw(raws) {
  events = []; observer = '';
  for (const raw of raws) {
    if (raw?.type === 'status') { observer = String(raw.observer || ''); continue; }
    try { events.push({ ...normalize(raw, { allowlist: ALLOWLIST, maxChars: LIMITS.maxFieldChars }), raw, n: ++seq }); } catch { /* the status line counts skipped events */ }
  }
  events = events.slice(-LIMITS.consoleEvents);
  schedule();
}
export function clearConsole() { events = []; observer = ''; schedule(); }
export function setObserver(name) { observer = String(name || ''); schedule(); }
export function setFeedLabel(label) { feedLabel = label; schedule(); }

function schedule() {
  if (scheduled || !els) return;
  scheduled = true;
  requestAnimationFrame(render);
}

const when = (e) => {
  const d = e.ts ? new Date(e.ts) : null;
  return d && !isNaN(d) ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : esc(e.clock || '');
};
const sessionKey = (e) => e.session || e.workspace || '';

function row(e, open) {
  const [cls, label] = VERDICT[e.v] || VERDICT.ok;
  const sampled = e.seen.length && e.seen.every(([, , s]) => s);
  const seen = e.seen.map(([src, t, s]) => `<div${s ? ' class="sampled"' : ''}><b>${esc(src)}</b> ${esc(t)}</div>`).join('');
  return `<tr class="v-${esc(e.v)}" data-n="${e.n}">
<td class="when">${when(e)}</td>
<td>${esc(AGENTS[e.a]?.name || e.a)}${e.workspace ? `<div class="muted">${esc(e.workspace)}</div>` : ''}</td>
<td><details${open.has(String(e.n)) ? ' open' : ''}><summary>${esc(e.title)}</summary><pre>${esc(JSON.stringify(e.raw ?? exportable(e), null, 2))}</pre></details><div class="muted">${esc(ZONE[e.z] || e.z)}</div></td>
<td><span class="pill ${cls}">${label}</span>${e.said ? '' : '<span class="pill ghost">Seen only</span>'}${sampled ? '<span class="pill sampled" title="Found by periodic sampling. Real, but quick actions between samples can be missed.">Sampled</span>' : ''}${e.rule ? `<div class="muted">${esc(e.rule)}</div>` : ''}</td>
<td class="code">${e.said ? esc(e.said) : '<span class="muted">nothing reported</span>'}</td>
<td class="code">${seen}</td></tr>`;
}

function render() {
  scheduled = false;
  const shown = events.filter((e) => matches(e, filters));
  // Keep the workspace list in step with the sessions seen so far.
  const sessions = new Map();
  for (const e of events) if (sessionKey(e) && !sessions.has(sessionKey(e))) sessions.set(sessionKey(e), e.workspace || sessionKey(e));
  const want = ['', ...sessions.keys()].join('\n');
  if (els.fSession.dataset.keys !== want) {
    els.fSession.innerHTML = `<option value="">All workspaces</option>${[...sessions].map(([k, label]) => `<option value="${esc(k)}">${esc(label)}</option>`).join('')}`;
    els.fSession.dataset.keys = want;
    els.fSession.value = sessions.has(filters.s) ? filters.s : '';
  }
  const unreported = events.filter((e) => !e.said).length, breaches = events.filter((e) => e.v === 'breach').length;
  const sampled = events.some((e) => e.seen.some(([, , s]) => s));
  els.coverage.innerHTML = [
    `<span><b>Feed</b> ${esc(feedLabel)}</span>`,
    `<span><b>Observer</b> ${esc(OBSERVER[observer] || (observer ? observer : feedLabel === 'Live' ? 'waiting for the collector' : 'as recorded in the events'))}</span>`,
    `<span><b>Sessions</b> ${sessions.size}</span>`,
    `<span><b>Events</b> ${events.length} · ${unreported} seen only · <em class="${breaches ? 'bad' : ''}">${breaches} breaches</em></span>`,
    sampled ? '<span class="pill sampled">Some observations are sampled</span>' : ''
  ].join('');
  els.count.textContent = !events.length ? 'No events yet.'
    : `Showing ${Math.min(shown.length, SHOWN)} of ${shown.length} matching${shown.length !== events.length ? ` (${events.length} in all)` : ''}, newest first.`;
  const open = new Set([...els.rows.querySelectorAll('details[open]')].map((d) => d.closest('tr').dataset.n));
  els.rows.innerHTML = shown.slice(-SHOWN).reverse().map((e) => row(e, open)).join('');
  els.exportBtn.disabled = !shown.length;
}

/** A dispatched event without the map's bookkeeping, for export when there's no raw event. */
function exportable(e) {
  const { rowEl, queued, quiet, arrived, at, raw, n, ...rest } = e;
  return rest;
}

function exportShown() {
  const lines = events.filter((e) => matches(e, filters)).map((e) => JSON.stringify(e.raw ?? exportable(e)));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'application/x-ndjson' }));
  a.download = `fenceline-events-${new Date().toISOString().slice(0, 10)}.jsonl`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
