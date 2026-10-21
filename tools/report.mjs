#!/usr/bin/env node
// Summarise the collector's event log into a one-page report: the pilot deliverable.
//   node tools/report.mjs [--days 7] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--md | --json [--name NAME]] [--out FILE]
//   node tools/report.mjs --merge a.json b.json … [--md] [--out FILE]   one team report from several --json reports
// Verdicts come from the page's own rules (web/js/events.js), so the report matches the map.
// The report contains commands and paths, so it's written readable only by you.
import { chmodSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LOG_DIR, dayOf, verifyChain } from './event-log.mjs';
import { esc, isSensitivePath, normalize, siteOf } from '../web/js/events.js';

const FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const MAX_LISTED = 30;

/** Read the daily log files from `from` to `to` (inclusive), checking each file's chain. */
export function readLogs(dir, from, to) {
  const files = [], events = [];
  let names = [];
  try { names = readdirSync(dir).filter((n) => FILE.test(n)).sort(); } catch { /* no logs yet */ }
  for (const name of names) {
    const day = name.match(FILE)[1];
    if (day < from || day > to) continue;
    const text = readFileSync(join(dir, name), 'utf8');
    const check = verifyChain(text, day);
    let n = 0;   // events, not the collector's status lines
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { const e = JSON.parse(line); events.push(e); if (e?.type !== 'status') n++; } catch { /* counted as broken by the chain check */ }
    }
    files.push({ day, events: n, ok: check.ok, brokenAt: check.brokenAt });
  }
  return { files, events };
}

/** Results of `npm run fence-check` saved in <dir>/checks/ from `from` to `to`. */
export function readChecks(dir, from, to) {
  let names = [];
  try { names = readdirSync(join(dir, 'checks')).filter((n) => n.endsWith('.json')).sort(); } catch { return []; }
  const out = [];
  for (const name of names) {
    try {
      const c = JSON.parse(readFileSync(join(dir, 'checks', name), 'utf8'));
      const day = dayOf(new Date(c.ts));
      if (c.type !== 'fence-check' || day < from || day > to) continue;
      out.push({ ts: String(c.ts), observer: String(c.observer), passed: Number(c.passed), expected: Number(c.expected),
        failed: Number(c.failed), version: String(c.version || ''), macos: String(c.macos || '') });
    } catch { /* unreadable check file */ }
  }
  return out;
}

const top = (map, n = 12) => [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);
const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

function daysBetween(from, to) {
  const out = [], d = new Date(`${from}T12:00:00`), end = new Date(`${to}T12:00:00`);
  if (isNaN(d) || isNaN(end)) return out;
  for (; d <= end && out.length < 366; d.setDate(d.getDate() + 1)) out.push(dayOf(d));
  return out;
}

const byVerdictThenTime = (a, b) => (a.verdict === b.verdict ? 0 : a.verdict === 'breach' ? -1 : 1) || String(a.when).localeCompare(String(b.when));

/** Turn raw events into the report's numbers and lists. */
export function buildReport(raws, { from, to, files = [], fenceChecks = [] } = {}) {
  const r = {
    from, to, files, fenceChecks, total: 0, reported: 0, unreported: 0, breaches: 0, checks: 0, background: 0, noResult: 0,
    sessions: new Map(), days: new Map(), sites: new Map(), sensitive: new Map(), incidents: [], coverage: []
  };
  const observers = new Map();   // day -> observers the collector reported running
  for (const raw of raws) {
    if (raw?.type === 'status') {
      const day = raw.ts ? dayOf(new Date(raw.ts)) : '';
      if (!observers.has(day)) observers.set(day, new Set());
      observers.get(day).add(String(raw.observer || 'none'));
      continue;
    }
    let e;
    try { e = normalize(raw, { maxChars: 400 }); } catch { continue; }
    r.total++;
    if (e.said) r.reported++; else r.unreported++;
    if (e.v === 'breach') r.breaches++;
    if (e.v === 'warn') r.checks++;
    if (/^Background: /.test(e.title)) r.background++;
    if (/^No result /.test(e.title)) r.noResult++;
    const day = raw.ts ? dayOf(new Date(raw.ts)) : 'unknown';
    bump(r.days, day);
    const key = raw.session || 'no session';
    const s = r.sessions.get(key) || { workspace: e.workspace || '', events: 0, unreported: 0, breaches: 0 };
    s.events++; if (!e.said) s.unreported++; if (e.v === 'breach') s.breaches++;
    r.sessions.set(key, s);
    if (e.z === 'net') bump(r.sites, siteOf(raw.target));
    if (e.z === 'vault' && isSensitivePath(raw.target)) bump(r.sensitive, String(raw.target));
    if (e.v === 'breach' || (!e.said && e.v === 'warn')) {
      r.incidents.push({ when: raw.ts || '', title: e.title, rule: e.rule || '', verdict: e.v, seen: e.seen.map(([src, t]) => `${src}: ${t}`).join(' · ') });
    }
  }
  r.incidents.sort(byVerdictThenTime);
  // A day with no log means the collector wasn't running, which is different from a quiet day.
  r.coverage = daysBetween(from, to).map((day) => {
    const f = files.find((x) => x.day === day);
    return { day, logged: !!f, observers: [...(observers.get(day) || [])] };
  });
  return r;
}

/* ---------- team roll-up ---------- */

const MAPS = ['sessions', 'days', 'sites', 'sensitive'];
const COUNTS = ['total', 'reported', 'unreported', 'breaches', 'checks', 'background', 'noResult'];

/** The report as plain JSON, for --merge on another machine. */
export function toJson(r, developer) {
  const out = { type: 'fenceline-report', developer, ...r };
  for (const k of MAPS) out[k] = [...r[k]];
  return out;
}

/** Combine several developers' --json reports into one. The files come from other people, so check their shape. */
export function mergeReports(parts) {
  const r = buildReport([], { from: '', to: '' });
  r.developers = [];
  for (const p of parts) {
    if (p?.type !== 'fenceline-report') throw new Error('not a Fenceline report made with --json');
    const developer = String(p.developer || `developer ${r.developers.length + 1}`);
    r.developers.push(developer);
    if (!r.from || String(p.from) < r.from) r.from = String(p.from);
    if (!r.to || String(p.to) > r.to) r.to = String(p.to);
    for (const k of COUNTS) r[k] += Number(p[k]) || 0;
    const tag = (x) => ({ ...x, developer });
    for (const k of ['files', 'incidents', 'coverage', 'fenceChecks']) r[k].push(...(p[k] || []).map(tag));
    for (const [k, s] of p.sessions || []) r.sessions.set(`${developer}\n${k}`, tag(s));
    for (const k of ['days', 'sites', 'sensitive']) for (const [key, n] of p[k] || []) r[k].set(key, (r[k].get(key) || 0) + (Number(n) || 0));
  }
  r.incidents.sort(byVerdictThenTime);
  return r;
}

/* ---------- rendering ---------- */

const when = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const OBSERVER = { es: 'Endpoint Security', lite: 'Lite (sampled)', none: 'None: agent reports only' };
const observerText = (c) => !c.logged ? 'Not running' : c.observers.length ? c.observers.map((o) => OBSERVER[o] || o).join(', ') : 'Running';
const checkText = (c) => `${c.passed}/${c.expected} expected detections${c.failed ? `, ${c.failed} failed` : ''}`;
const devs = (r) => (r.developers?.length ? r.developers : null);
const FOOTNOTE = 'A breach is an unreported internet connection or sensitive-file access; a check is any other unreported or out-of-bounds action. Lite observations are sampled, so a missing event is not proof that nothing happened. Coverage shows the days the collector was running; a day it was not running has no evidence either way.';

export function renderMarkdown(r) {
  const md = (t) => String(t).replace(/[|\\`*_[\]<>]/g, (c) => '\\' + c).replace(/\n/g, ' ');
  const team = devs(r);
  const dev = (x) => (team ? `${md(x.developer || '?')} | ` : '');
  const devHead = team ? 'Developer | ' : '', devRule = team ? '---|' : '';
  const out = [`# Fenceline ${team ? 'team ' : ''}report: ${r.from} to ${r.to}`, ''];
  if (team) out.push(`Developers: ${team.map(md).join(', ')}.`, '');
  out.push(`${r.total} events in ${r.sessions.size} sessions: **${r.breaches} breaches**, ${r.checks} checks, ${r.unreported} unreported, ${r.background} from background tasks, ${r.noResult} tool calls with no result.`, '');
  out.push('## Breaches and unreported actions', '');
  if (!r.incidents.length) out.push('None.', '');
  else {
    out.push(`| ${devHead}When | Verdict | What | Why | Seen |`, `|${devRule}---|---|---|---|---|`);
    for (const i of r.incidents.slice(0, MAX_LISTED)) out.push(`| ${dev(i)}${when(i.when)} | ${i.verdict === 'breach' ? 'Breach' : 'Check'} | ${md(i.title)} | ${md(i.rule)} | ${md(i.seen)} |`);
    if (r.incidents.length > MAX_LISTED) out.push('', `…and ${r.incidents.length - MAX_LISTED} more.`);
    out.push('');
  }
  out.push('## Coverage', '');
  if (!r.coverage.length) out.push('No days in this period.');
  else {
    out.push(`| ${devHead}Day | Collector and observer |`, `|${devRule}---|---|`);
    for (const c of r.coverage) out.push(`| ${dev(c)}${md(c.day)} | ${md(observerText(c))} |`);
  }
  out.push('', '## Detection checks', '', ...(r.fenceChecks.length
    ? r.fenceChecks.map((c) => `- ${team ? `${md(c.developer)}, ` : ''}${when(c.ts)}: ${checkText(c)}, ${md(OBSERVER[c.observer] || c.observer)}`)
    : ['None in this period. Run `npm run fence-check` to prove detection on this Mac.']));
  out.push('', '## Sessions', '', `| ${devHead}Workspace | Events | Unreported | Breaches |`, `|${devRule}---|---|---|---|`);
  for (const s of [...r.sessions.values()].sort((a, b) => b.events - a.events)) {
    out.push(`| ${dev(s)}${md(s.workspace || '?')} | ${s.events} | ${s.unreported} | ${s.breaches} |`);
  }
  out.push('', '## Sites reached', '', ...(r.sites.size ? top(r.sites).map(([k, n]) => `- ${md(k)} (${n})`) : ['None.']));
  out.push('', '## Sensitive files touched', '', ...(r.sensitive.size ? top(r.sensitive).map(([k, n]) => `- ${md(k)} (${n})`) : ['None.']));
  out.push('', '## Log integrity', '', ...(r.files.length ? r.files.map((f) => `- ${team ? `${md(f.developer)}, ` : ''}${f.day}: ${f.ok ? `intact, ${f.events} events` : `**changed at line ${f.brokenAt}**`}`) : ['No log files in this period.']));
  out.push('', `Generated by Fenceline. ${FOOTNOTE}`, '');
  return out.join('\n');
}

export function renderHtml(r) {
  const team = devs(r);
  const rows = (list, cells) => list.map((x) => `<tr>${(team ? [esc(x.developer || '?'), ...cells(x)] : cells(x)).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  const head = (cols) => `<thead><tr>${(team ? ['Developer', ...cols] : cols).map((c) => `<th>${c}</th>`).join('')}</tr></thead>`;
  const list = (map) => map.size ? `<ul>${top(map).map(([k, n]) => `<li>${esc(k)} <span>(${n})</span></li>`).join('')}</ul>` : '<p>None.</p>';
  const tiles = [['Events', r.total], ['Breaches', r.breaches], ['Checks', r.checks], ['Unreported', r.unreported], ['Sessions', r.sessions.size],
    ...(team ? [['Developers', team.length]] : [['Background', r.background]])];
  const title = `Fenceline ${team ? 'team ' : ''}report`;
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} ${esc(r.from)} to ${esc(r.to)}</title>
<style>
:root{--bg:#F4F6F1;--surface:#fff;--ink:#1C2620;--muted:#5B695F;--line:#C9D2C4;--bad:#C0362C;--warn:#A97A0C;--ok:#2F7D4F}
@media (prefers-color-scheme:dark){:root{--bg:#0E1614;--surface:#15201D;--ink:#E2EBE4;--muted:#92A398;--line:#283631;--bad:#F0625A;--warn:#E2B341;--ok:#6CC892}}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 8px}
.sub{color:var(--muted);margin:0}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:18px 0}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:10px 12px}.tile b{display:block;font-size:24px;font-variant-numeric:tabular-nums}
.tile span{color:var(--muted);font-size:12px}.bad b{color:var(--bad)}table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--line)}
th,td{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid var(--line);overflow-wrap:break-word}
.inc td:nth-child(1),.inc td:nth-child(2){white-space:nowrap}.inc td:nth-last-child(3){min-width:180px}.inc td:nth-last-child(2){min-width:160px}.inc td:last-child{word-break:break-all}th{font-size:12px;color:var(--muted);font-weight:500}
.v-breach{color:var(--bad);font-weight:600}.v-warn{color:var(--warn);font-weight:600}.v-ok{color:var(--ok);font-weight:600}code,.seen{font:12px ui-monospace,Menlo,monospace}ul{margin:0;padding-left:18px}li span{color:var(--muted)}
.wrap{overflow-x:auto}footer{color:var(--muted);font-size:12px;margin-top:28px}
</style></head><body><main>
<h1>${title}</h1><p class="sub">${esc(r.from)} to ${esc(r.to)} · ${r.sessions.size} sessions${team ? ` · ${team.map(esc).join(', ')}` : ''}</p>
<div class="tiles">${tiles.map(([k, v]) => `<div class="tile${k === 'Breaches' && v ? ' bad' : ''}"><b>${v}</b><span>${k}</span></div>`).join('')}</div>
<h2>Breaches and unreported actions</h2>
${r.incidents.length ? `<div class="wrap"><table class="inc">${head(['When', 'Verdict', 'What', 'Why', 'Seen'])}<tbody>
${rows(r.incidents.slice(0, MAX_LISTED), (i) => [esc(when(i.when)), `<span class="v-${esc(i.verdict)}">${i.verdict === 'breach' ? 'Breach' : 'Check'}</span>`, esc(i.title), esc(i.rule), `<span class="seen">${esc(i.seen)}</span>`])}
</tbody></table></div>${r.incidents.length > MAX_LISTED ? `<p class="sub">…and ${r.incidents.length - MAX_LISTED} more.</p>` : ''}` : '<p>None.</p>'}
<h2>Coverage</h2>${r.coverage.length ? `<div class="wrap"><table>${head(['Day', 'Collector and observer'])}<tbody>
${rows(r.coverage, (c) => [esc(c.day), c.logged ? esc(observerText(c)) : `<span class="v-warn">${observerText(c)}</span>`])}
</tbody></table></div>` : '<p>No days in this period.</p>'}
<h2>Detection checks</h2>${r.fenceChecks.length ? `<div class="wrap"><table>${head(['When', 'Observer', 'Result'])}<tbody>
${rows(r.fenceChecks, (c) => [esc(when(c.ts)), esc(OBSERVER[c.observer] || c.observer), `<span class="v-${c.failed ? 'breach' : 'ok'}">${esc(checkText(c))}</span>`])}
</tbody></table></div>` : '<p>None in this period. Run <code>npm run fence-check</code> to prove detection on this Mac.</p>'}
<h2>Sessions</h2><div class="wrap"><table>${head(['Workspace', 'Events', 'Unreported', 'Breaches'])}<tbody>
${rows([...r.sessions.values()].sort((a, b) => b.events - a.events), (s) => [esc(s.workspace || '?'), esc(s.events), esc(s.unreported), esc(s.breaches)])}
</tbody></table></div>
<h2>Sites reached</h2>${list(r.sites)}
<h2>Sensitive files touched</h2>${list(r.sensitive)}
<h2>Log integrity</h2>${r.files.length ? `<ul>${r.files.map((f) => `<li>${team ? `${esc(f.developer)}, ` : ''}${esc(f.day)}: ${f.ok ? `intact, ${esc(f.events)} events` : `<span class="v-breach">changed at line ${esc(f.brokenAt)}</span>`}</li>`).join('')}</ul>` : '<p>No log files in this period.</p>'}
<footer>Generated by Fenceline. ${FOOTNOTE} This report contains commands and file paths: share it with care.</footer>
</main></body></html>
`;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const markdown = process.argv.includes('--md');
  const json = process.argv.includes('--json');
  const merging = process.argv.indexOf('--merge');
  let report, out;
  if (merging >= 0) {
    const paths = [];
    for (const a of process.argv.slice(merging + 1)) { if (a.startsWith('--')) break; paths.push(a); }
    if (!paths.length) { console.error('Usage: npm run report -- --merge a.json b.json …'); process.exit(2); }
    report = mergeReports(paths.map((p) => {
      try { return JSON.parse(readFileSync(p, 'utf8')); } catch (err) { console.error(`Couldn't read ${p}: ${err.message}`); process.exit(2); }
    }));
    out = resolve(arg('--out') || `fenceline-team-report-${report.from}-to-${report.to}.${markdown ? 'md' : 'html'}`);
  } else {
    const dir = process.env.FENCELINE_LOG_DIR || DEFAULT_LOG_DIR;
    const to = arg('--to') || dayOf();
    const days = Number(arg('--days') || 7);
    const start = new Date(`${to}T12:00:00`); start.setDate(start.getDate() - (days - 1));
    const from = arg('--from') || dayOf(start);
    const { files, events } = readLogs(dir, from, to);
    report = buildReport(events, { from, to, files, fenceChecks: readChecks(dir, from, to) });
    out = resolve(arg('--out') || `fenceline-report-${from}-to-${to}.${json ? 'json' : markdown ? 'md' : 'html'}`);
  }
  const text = json && merging < 0 ? JSON.stringify(toJson(report, arg('--name') || userInfo().username), null, 2)
    : markdown ? renderMarkdown(report) : renderHtml(report);
  writeFileSync(out, text, { mode: 0o600 });
  chmodSync(out, 0o600);
  console.log(`${out}\n${report.total} events, ${report.breaches} breaches, ${report.checks} checks, ${report.sessions.size} sessions (${report.from} to ${report.to}).`);
  const changed = report.files.filter((f) => !f.ok);
  if (changed.length) console.log(`Warning: ${changed.map((f) => `${f.developer ? `${f.developer} ` : ''}${f.day}`).join(', ')} changed since they were written; see Log integrity.`);
  const notRunning = report.coverage.filter((c) => !c.logged).length;
  if (notRunning) console.log(`${notRunning} day(s) with no log: the collector wasn't running, so there is no evidence either way.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
