import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtersFromHash, matches } from '../../web/js/console.js';
import { normalize } from '../../web/js/events.js';

const ev = (raw) => ({ ...normalize(raw), raw });
const ssh = ev({ agent: 'claude-code', zone: 'vault', target: '/Users/me/.ssh/id_ed25519', said: null, seen: 'open id_ed25519 pid 7', session: 's1', workspace: '/Users/me/app' });
const fetch = ev({ agent: 'copilot', zone: 'net', target: 'docs.stripe.com', said: 'WebFetch docs.stripe.com', session: 's2' });
const none = filtersFromHash('');

test('no filters match everything', () => {
  assert.ok(matches(ssh, none) && matches(fetch, none));
});

test('each filter narrows on its own field', () => {
  assert.deepEqual([ssh, fetch].filter((e) => matches(e, { ...none, v: 'breach' })), [ssh]);
  assert.deepEqual([ssh, fetch].filter((e) => matches(e, { ...none, u: true })), [ssh]);
  assert.deepEqual([ssh, fetch].filter((e) => matches(e, { ...none, a: 'copilot' })), [fetch]);
  assert.deepEqual([ssh, fetch].filter((e) => matches(e, { ...none, z: 'net' })), [fetch]);
  assert.deepEqual([ssh, fetch].filter((e) => matches(e, { ...none, s: 's1' })), [ssh]);
  assert.deepEqual([ssh, fetch].filter((e) => matches(e, { ...none, q: 'ID_ED25519' })), [ssh], 'search is case-insensitive and covers OS observations');
});

test('filters round-trip through the URL hash', () => {
  assert.deepEqual(filtersFromHash('#v=breach&u=1&q=curl%20x'), { a: '', s: '', z: '', v: 'breach', u: true, q: 'curl x' });
});
