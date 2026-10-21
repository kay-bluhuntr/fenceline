import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dayOf, openEventLog } from '../../tools/event-log.mjs';
import { buildReport, mergeReports, readChecks, readLogs, renderHtml, renderMarkdown, toJson } from '../../tools/report.mjs';

const ev = (extra) => ({ ts: new Date().toISOString(), agent: 'claude-code', session: 's1', workspace: '/Users/dev/app', ...extra });
const EVENTS = [
  ev({ zone: 'tools', target: 'npm test', title: 'Bash: npm test', said: { source: 'hook', text: 'Bash: npm test' }, seen: [] }),
  ev({ zone: 'net', target: '104.20.21.8:80', title: 'Unmatched OS event: 104.20.21.8:80', said: null, seen: [{ source: 'poll', text: 'connect 104.20.21.8:80 pid 9', sampled: true }] }),
  ev({ zone: 'vault', target: '/Users/dev/.ssh/known_hosts', title: 'Unmatched OS event: known_hosts', said: null, seen: [{ source: 'poll', text: 'open known_hosts' }] }),
  ev({ zone: 'tools', target: 'sleep', title: 'Unmatched OS event: sleep', said: null, seen: 'exec sleep' }),
  ev({ session: 's2', workspace: '/Users/dev/api', zone: 'net', target: '172.66.0.1:80', title: 'Background: 172.66.0.1:80 (from Bash: npm install)', said: { source: 'hook', text: 'Background task of Bash: npm install' }, seen: [] }),
  ev({ zone: 'tools', target: '<img src=x onerror=alert(1)>', title: '<script>alert(1)</script>', said: null, seen: '<b>x</b>' })
];

test('the report counts verdicts the same way the page does', () => {
  const r = buildReport(EVENTS, { from: '2026-10-11', to: '2026-10-11' });
  assert.equal(r.total, 6);
  assert.equal(r.unreported, 4);
  assert.equal(r.breaches, 2);       // the internet connection and the SSH file
  assert.equal(r.checks, 2);         // the local processes
  assert.equal(r.background, 1);
  assert.equal(r.sessions.size, 2);
  assert.equal(r.incidents[0].verdict, 'breach');
  assert.deepEqual([...r.sensitive.keys()], ['/Users/dev/.ssh/known_hosts']);
});

test('hostile text is escaped in both formats', () => {
  const r = buildReport(EVENTS, { from: 'a', to: 'b' });
  const html = renderHtml(r);
  assert.equal(html.includes('<script>alert'), false);
  assert.equal(html.includes('<img src=x'), false);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(/<(script|img|iframe|link)\b/i.test(html.replace(/<link\b[^>]*>/g, '')), false, 'no active elements');
  assert.ok(renderMarkdown(r).includes('\\<script\\>'));
});

test('logs are read by date and a changed file is flagged', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'fl-report-')), 'logs');
  const log = openEventLog({ dir });
  for (const e of EVENTS.slice(0, 3)) log.write(e);
  log.write({ type: 'status', ts: new Date().toISOString(), observer: 'lite', detail: 'Lite observer' });
  log.close();
  await new Promise((r) => setTimeout(r, 50));
  const day = dayOf();
  let { files, events } = readLogs(dir, day, day);
  assert.equal(events.length, 4);
  assert.deepEqual(files, [{ day, events: 3, ok: true, brokenAt: 0 }], 'status lines are not counted as events');
  const path = join(dir, `${day}.jsonl`);
  writeFileSync(path, readFileSync(path, 'utf8').replace('"said":null', '"said":"Bash: curl"'));
  ({ files } = readLogs(dir, day, day));
  assert.equal(files[0].ok, false);
  assert.match(renderHtml(buildReport([], { from: day, to: day, files })), /changed at line 2/);
  assert.deepEqual(readLogs(dir, '2000-01-01', '2000-01-02').files, []);
});

test('coverage separates quiet days from days the collector was off', () => {
  const status = { type: 'status', ts: '2026-10-11T09:00:00', observer: 'lite', detail: 'Lite observer' };
  const files = [{ day: '2026-10-11', events: 7, ok: true, brokenAt: 0 }];
  const r = buildReport([status, ...EVENTS], { from: '2026-10-10', to: '2026-10-11', files });
  assert.equal(r.total, 6, 'status lines are not events');
  assert.deepEqual(r.coverage, [
    { day: '2026-10-10', logged: false, observers: [] },
    { day: '2026-10-11', logged: true, observers: ['lite'] }
  ]);
  const html = renderHtml(r);
  assert.match(html, /Not running/);
  assert.match(html, /Lite \(sampled\)/);
});

test('detection checks are read by date', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fl-checks-'));
  mkdirSync(join(dir, 'checks'));
  const check = { type: 'fence-check', ts: '2026-10-11T10:00:00', observer: 'lite', passed: 5, expected: 5, failed: 0, version: '0.3.0' };
  writeFileSync(join(dir, 'checks', 'a.json'), JSON.stringify(check));
  writeFileSync(join(dir, 'checks', 'b.json'), 'not json');
  assert.equal(readChecks(dir, '2026-10-11', '2026-10-11').length, 1);
  assert.equal(readChecks(dir, '2026-10-12', '2026-10-12').length, 0);
  const r = buildReport([], { from: '2026-10-11', to: '2026-10-11', fenceChecks: readChecks(dir, '2026-10-11', '2026-10-11') });
  assert.match(renderMarkdown(r), /5\/5 expected detections/);
});

test('developer reports merge into one team report', () => {
  const day = (d) => ({ day: d, events: 3, ok: true, brokenAt: 0 });
  const a = buildReport(EVENTS, { from: '2026-10-11', to: '2026-10-11', files: [day('2026-10-11')] });
  const b = buildReport(EVENTS.slice(0, 2), { from: '2026-10-09', to: '2026-10-11', files: [] });
  const viaFiles = (r, name) => JSON.parse(JSON.stringify(toJson(r, name)));
  const t = mergeReports([viaFiles(a, 'ada'), viaFiles(b, '<b>bob</b>')]);
  assert.deepEqual(t.developers, ['ada', '<b>bob</b>']);
  assert.equal(t.total, 8);
  assert.equal(t.breaches, 3);
  assert.equal(t.sessions.size, 3, 'the same session id stays separate per developer');
  assert.equal(t.from, '2026-10-09');
  assert.equal(t.coverage.length, 4);
  assert.equal(t.incidents[0].verdict, 'breach');
  const html = renderHtml(t);
  assert.match(html, /<th>Developer<\/th>/);
  assert.equal(html.includes('<b>bob'), false, 'developer names are escaped');
  const evil = '"><img src=x onerror=alert(1)>';
  const forged = mergeReports([{ type: 'fenceline-report', developer: 'm', from: '2026-10-11', to: '2026-10-11',
    incidents: [{ when: '', title: 't', rule: '', verdict: evil, seen: '' }],
    sessions: [['s', { workspace: 'w', events: evil, unreported: evil, breaches: evil }]],
    files: [{ day: '2026-10-11', ok: true, events: evil }, { day: '2026-10-11', ok: false, brokenAt: evil }] }]);
  assert.equal(renderHtml(forged).includes('<img'), false, 'every field from a merged file is escaped');
  assert.throws(() => mergeReports([{ total: 1 }]), /not a Fenceline report/);
});
