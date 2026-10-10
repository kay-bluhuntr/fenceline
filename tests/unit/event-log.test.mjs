import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dayOf, openEventLog, pruneLogs, verifyChain } from '../../tools/event-log.mjs';

const flush = () => new Promise((r) => setTimeout(r, 50));

test('events are appended to a private daily file with a verifiable chain', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'fl-')), 'logs');
  const log = openEventLog({ dir });
  log.write({ agent: 'claude-code', zone: 'tools', target: 'ls', said: 'Bash: ls' });
  log.write({ agent: 'claude-code', zone: 'net', target: '1.2.3.4:443', said: null });
  log.close(); await flush();
  const day = dayOf();
  const file = join(dir, `${day}.jsonl`);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const text = readFileSync(file, 'utf8');
  const lines = text.trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].target, '1.2.3.4:443');
  assert.deepEqual(verifyChain(text, day), { lines: 2, ok: true, brokenAt: 0 });

  // Reopening continues the same chain.
  const again = openEventLog({ dir });
  again.write({ agent: 'claude-code', zone: 'fence', target: 'a.js', said: 'Read: a.js' });
  again.close(); await flush();
  assert.equal(verifyChain(readFileSync(file, 'utf8'), day).ok, true);

  // Editing a line breaks the chain from that line.
  const edited = readFileSync(file, 'utf8').replace('"said":null', '"said":"Bash: curl"');
  writeFileSync(file, edited);
  assert.deepEqual(verifyChain(edited, day), { lines: 2, ok: false, brokenAt: 2 });
  // So does deleting one.
  const kept = readFileSync(file, 'utf8').split('\n');
  assert.equal(verifyChain([kept[0], kept[2]].join('\n'), day).brokenAt, 2);
});

test('files older than the retention period are deleted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fl-'));
  for (const name of ['2026-08-01.jsonl', '2026-09-15.jsonl', '2026-10-09.jsonl', 'notes.txt']) writeFileSync(join(dir, name), '');
  assert.deepEqual(pruneLogs(dir, 30, new Date(2026, 9, 10)), ['2026-08-01.jsonl']);
  assert.deepEqual(readdirSync(dir).sort(), ['2026-09-15.jsonl', '2026-10-09.jsonl', 'notes.txt']);
});
