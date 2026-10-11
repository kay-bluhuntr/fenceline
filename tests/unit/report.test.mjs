import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dayOf, openEventLog } from '../../tools/event-log.mjs';
import { buildReport, readLogs, renderHtml, renderMarkdown } from '../../tools/report.mjs';

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
  log.close();
  await new Promise((r) => setTimeout(r, 50));
  const day = dayOf();
  let { files, events } = readLogs(dir, day, day);
  assert.equal(events.length, 3);
  assert.deepEqual(files, [{ day, events: 3, ok: true, brokenAt: 0 }]);
  const path = join(dir, `${day}.jsonl`);
  writeFileSync(path, readFileSync(path, 'utf8').replace('"said":null', '"said":"Bash: curl"'));
  ({ files } = readLogs(dir, day, day));
  assert.equal(files[0].ok, false);
  assert.match(renderHtml(buildReport([], { from: day, to: day, files })), /changed at line 2/);
  assert.deepEqual(readLogs(dir, '2000-01-01', '2000-01-02').files, []);
});
