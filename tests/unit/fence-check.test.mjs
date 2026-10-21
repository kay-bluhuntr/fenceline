import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../../tools/fence-check.mjs';

const marks = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((id) => [id, { start: id * 100, end: id * 100 + 90 }]));
const ev = (at, raw, v) => ({ at, raw, v });
const unreported = (at, target, zone = 'vault') => ev(at, { zone, target, said: null }, 'breach');
const outcome = (results, id) => results.find((r) => r.id === id).outcome;

test('every scenario passes when the collector reports what it should', () => {
  const events = [
    ev(150, { zone: 'tools', target: 'cat package.json >/dev/null; sleep 1.5', said: { text: 'Bash' } }, 'ok'),
    unreported(250, '/t/.ssh/id_canary_held'),
    unreported(350, '93.184.215.14:443', 'net'),
    unreported(450, '/t/.ssh/id_canary_detached'),
    unreported(550, '/t/.ssh/id_canary_quick')
  ];
  const r = score(events, marks, { observer: 'lite', online: true, forgery: 'Fenceline hook: collector refused the event' });
  assert.deepEqual(r.map((x) => x.outcome.split(':')[0]), ['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
});

test('misses, false positives and accepted forgeries are scored honestly', () => {
  const events = [
    ev(150, { zone: 'tools', target: 'cat package.json >/dev/null; sleep 1.5', said: { text: 'Bash' } }, 'ok'),
    ev(160, { zone: 'tools', target: 'sleep', said: null }, 'warn'),        // a false positive in step 1
    ev(650, { zone: 'fence', target: '/FORGED-shell', said: { text: 'Read' } }, 'ok'),
    ev(750, { zone: 'fence', target: '/FORGED-exec', said: { text: 'Read' } }, 'ok')
  ];
  const lite = score(events, marks, { observer: 'lite', online: false, forgery: 'refused' });
  assert.equal(outcome(lite, 1), 'fail');
  assert.equal(outcome(lite, 2), 'fail');
  assert.match(outcome(lite, 3), /^skipped/);
  assert.equal(outcome(lite, 5), 'documented miss', 'a short read is a documented Lite miss, not a failure');
  assert.equal(outcome(lite, 6), 'fail', 'a forged report that got through fails even if the hook said refused');
  assert.match(outcome(lite, 7), /^known gap/);
  const es = score([], marks, { observer: 'es', online: true, forgery: '' });
  assert.equal(outcome(es, 5), 'fail', 'Endpoint Security must catch short reads');
  assert.match(outcome(es, 3), /^skipped: Endpoint Security/);
});
