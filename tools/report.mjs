#!/usr/bin/env node
// Summarise the collector's event log into a one-page report: the pilot deliverable.
//   node tools/report.mjs [--days 7] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--md] [--out FILE]
// Verdicts come from the page's own rules (web/js/events.js), so the report matches the map.
// The report contains commands and paths, so it's written readable only by you.
import { chmodSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
    files.push({ day, events: check.lines, ok: check.ok, brokenAt: check.brokenAt });
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { /* counted as broken by the chain check */ }
    }
  }
  return { files, events };
}

const top = (map, n = 12) => [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);
const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

/** Turn raw events into the report's numbers and lists. */
export function buildReport(raws, { from, to, files = [] } = {}) {
  const r = {
    from, to, files, total: 0, reported: 0, unreported: 0, breaches: 0, checks: 0, background: 0, noResult: 0,
    sessions: new Map(), days: new Map(), sites: new Map(), sensitive: new Map(), incidents: []
  };
  for (const raw of raws) {
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
  r.incidents.sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === 'breach' ? -1 : 1) || String(a.when).localeCompare(String(b.when)));
  return r;
}

const when = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

export function renderMarkdown(r) {
  const md = (t) => String(t).replace(/[|\\`*_[\]<>]/g, (c) => '\\' + c).replace(/\n/g, ' ');
  const out = [`# Fenceline report: ${r.from} to ${r.to}`, ''];
  out.push(`${r.total} events in ${r.sessions.size} sessions: **${r.breaches} breaches**, ${r.checks} checks, ${r.unreported} unreported, ${r.background} from background tasks, ${r.noResult} tool calls with no result.`, '');
  out.push('## Breaches and unreported actions', '');
  if (!r.incidents.length) out.push('None.', '');
  else {
    out.push('| When | Verdict | What | Why | Seen |', '|---|---|---|---|---|');
    for (const i of r.incidents.slice(0, MAX_LISTED)) out.push(`| ${when(i.when)} | ${i.verdict === 'breach' ? 'Breach' : 'Check'} | ${md(i.title)} | ${md(i.rule)} | ${md(i.seen)} |`);
    if (r.incidents.length > MAX_LISTED) out.push('', `…and ${r.incidents.length - MAX_LISTED} more.`);
    out.push('');
  }
  out.push('## Sessions', '', '| Workspace | Events | Unreported | Breaches |', '|---|---|---|---|');
  for (const s of [...r.sessions.values()].sort((a, b) => b.events - a.events)) {
    out.push(`| ${md(s.workspace || '?')} | ${s.events} | ${s.unreported} | ${s.breaches} |`);
  }
  out.push('', '## Sites reached', '', ...(r.sites.size ? top(r.sites).map(([k, n]) => `- ${md(k)} (${n})`) : ['None.']));
  out.push('', '## Sensitive files touched', '', ...(r.sensitive.size ? top(r.sensitive).map(([k, n]) => `- ${md(k)} (${n})`) : ['None.']));
  out.push('', '## Log integrity', '', ...(r.files.length ? r.files.map((f) => `- ${f.day}: ${f.ok ? `intact, ${f.events} events` : `**changed at line ${f.brokenAt}**`}`) : ['No log files in this period.']));
  out.push('', 'Generated by Fenceline. A breach is an unreported internet connection or sensitive-file access; a check is any other unreported or out-of-bounds action. Lite observations are sampled, so a missing event is not proof that nothing happened.', '');
  return out.join('\n');
}

export function renderHtml(r) {
  const rows = (list, cells) => list.map((x) => `<tr>${cells(x).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  const list = (map) => map.size ? `<ul>${top(map).map(([k, n]) => `<li>${esc(k)} <span>(${n})</span></li>`).join('')}</ul>` : '<p>None.</p>';
  const tiles = [['Events', r.total], ['Breaches', r.breaches], ['Checks', r.checks], ['Unreported', r.unreported], ['Sessions', r.sessions.size], ['Background', r.background]];
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fenceline report ${esc(r.from)} to ${esc(r.to)}</title>
<style>
:root{--bg:#F4F6F1;--surface:#fff;--ink:#1C2620;--muted:#5B695F;--line:#C9D2C4;--bad:#C0362C;--warn:#A97A0C}
@media (prefers-color-scheme:dark){:root{--bg:#0E1614;--surface:#15201D;--ink:#E2EBE4;--muted:#92A398;--line:#283631;--bad:#F0625A;--warn:#E2B341}}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 8px}
.sub{color:var(--muted);margin:0}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:18px 0}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:10px 12px}.tile b{display:block;font-size:24px;font-variant-numeric:tabular-nums}
.tile span{color:var(--muted);font-size:12px}.bad b{color:var(--bad)}table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--line)}
th,td{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid var(--line);overflow-wrap:break-word}
.inc td:nth-child(1),.inc td:nth-child(2){white-space:nowrap}.inc td:nth-child(3){min-width:180px}.inc td:nth-child(4){min-width:160px}.inc td:nth-child(5){word-break:break-all}th{font-size:12px;color:var(--muted);font-weight:500}
.v-breach{color:var(--bad);font-weight:600}.v-warn{color:var(--warn);font-weight:600}code,td.seen{font:12px ui-monospace,Menlo,monospace}ul{margin:0;padding-left:18px}li span{color:var(--muted)}
.wrap{overflow-x:auto}footer{color:var(--muted);font-size:12px;margin-top:28px}
</style></head><body><main>
<h1>Fenceline report</h1><p class="sub">${esc(r.from)} to ${esc(r.to)} · ${r.sessions.size} sessions</p>
<div class="tiles">${tiles.map(([k, v]) => `<div class="tile${k === 'Breaches' && v ? ' bad' : ''}"><b>${v}</b><span>${k}</span></div>`).join('')}</div>
<h2>Breaches and unreported actions</h2>
${r.incidents.length ? `<div class="wrap"><table class="inc"><thead><tr><th>When</th><th>Verdict</th><th>What</th><th>Why</th><th>Seen</th></tr></thead><tbody>
${rows(r.incidents.slice(0, MAX_LISTED), (i) => [esc(when(i.when)), `<span class="v-${i.verdict}">${i.verdict === 'breach' ? 'Breach' : 'Check'}</span>`, esc(i.title), esc(i.rule), `<span class="seen">${esc(i.seen)}</span>`])}
</tbody></table></div>${r.incidents.length > MAX_LISTED ? `<p class="sub">…and ${r.incidents.length - MAX_LISTED} more.</p>` : ''}` : '<p>None.</p>'}
<h2>Sessions</h2><div class="wrap"><table><thead><tr><th>Workspace</th><th>Events</th><th>Unreported</th><th>Breaches</th></tr></thead><tbody>
${rows([...r.sessions.values()].sort((a, b) => b.events - a.events), (s) => [esc(s.workspace || '?'), s.events, s.unreported, s.breaches])}
</tbody></table></div>
<h2>Sites reached</h2>${list(r.sites)}
<h2>Sensitive files touched</h2>${list(r.sensitive)}
<h2>Log integrity</h2>${r.files.length ? `<ul>${r.files.map((f) => `<li>${esc(f.day)}: ${f.ok ? `intact, ${f.events} events` : `<span class="v-breach">changed at line ${f.brokenAt}</span>`}</li>`).join('')}</ul>` : '<p>No log files in this period.</p>'}
<footer>Generated by Fenceline. A breach is an unreported internet connection or sensitive-file access; a check is any other unreported or out-of-bounds action. Lite observations are sampled, so a missing event is not proof that nothing happened. This report contains commands and file paths: share it with care.</footer>
</main></body></html>
`;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const dir = process.env.FENCELINE_LOG_DIR || DEFAULT_LOG_DIR;
  const to = arg('--to') || dayOf();
  const days = Number(arg('--days') || 7);
  const start = new Date(`${to}T12:00:00`); start.setDate(start.getDate() - (days - 1));
  const from = arg('--from') || dayOf(start);
  const markdown = process.argv.includes('--md');
  const out = resolve(arg('--out') || `fenceline-report-${from}-to-${to}.${markdown ? 'md' : 'html'}`);
  const { files, events } = readLogs(dir, from, to);
  const report = buildReport(events, { from, to, files });
  writeFileSync(out, markdown ? renderMarkdown(report) : renderHtml(report), { mode: 0o600 });
  chmodSync(out, 0o600);
  console.log(`${out}\n${report.total} events, ${report.breaches} breaches, ${report.checks} checks, ${report.sessions.size} sessions (${from} to ${to}).`);
  const changed = files.filter((f) => !f.ok);
  if (changed.length) console.log(`Warning: ${changed.map((f) => f.day).join(', ')} changed since they were written; see Log integrity.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
