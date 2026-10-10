import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteOf, normalize, parseLines, esc, clip, vaultLabel, toolName, workspaceSegment } from '../../web/js/events.js';

test('siteOf groups hosts by registrable domain', () => {
  assert.equal(siteOf('api.github.com'), 'github.com');
  assert.equal(siteOf('https://docs.stripe.com/refunds?x=1'), 'stripe.com');
  assert.equal(siteOf('www.gov.uk'), 'gov.uk');
  assert.equal(siteOf('www.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(siteOf('digital.nhs.uk'), 'digital.nhs.uk');
  assert.equal(siteOf('api.anthropic.com:443'), 'anthropic.com');
  assert.equal(siteOf('10.0.0.5'), '10.0.0.5');
  assert.equal(siteOf('user@git.example.org/repo'), 'example.org');
});

test('toolName, workspaceSegment and vaultLabel pick stable map keys', () => {
  assert.equal(toolName('/opt/homebrew/bin/terraform plan'), 'terraform');
  assert.deepEqual(workspaceSegment('./src/app/main.py'), { seg: 'src', isDir: true });
  assert.deepEqual(workspaceSegment('README.md'), { seg: 'README.md', isDir: false });
  assert.equal(vaultLabel('/Users/kay/.ssh/id_ed25519').known, 'ssh');
  assert.equal(vaultLabel('~/Library/LaunchAgents/x.plist').known, 'launch');
  assert.deepEqual(vaultLabel('~/.kube/config'), { known: null, label: '~/.kube' });
});

test('normalize fills sensible defaults', () => {
  const base = { agent: 'claude-code', target: 'x' };
  assert.equal(normalize({ ...base, zone: 'vault', said: null }).v, 'breach');
  assert.equal(normalize({ ...base, zone: 'vault', said: 'cat x' }).v, 'warn');
  assert.equal(normalize({ ...base, zone: 'fence', said: null }).v, 'ok');
  assert.equal(normalize({ ...base, zone: 'net', said: 'fetch' }, { resolveKey: (z, t) => t, allowlist: [] }).rule, 'First visit to this domain');
  assert.equal(normalize({ ...base, zone: 'tools', said: 'x', verdict: 'BLOCKED' }).v, 'breach');
  assert.equal(normalize({ agent: 'GitHub-Copilot', zone: 'internet', target: 'a.b' }).a, 'copilot');
});

test('normalize rejects bad events with readable messages', () => {
  assert.throws(() => normalize(null), /JSON object/);
  assert.throws(() => normalize({ agent: 'cursor', zone: 'net', target: 'x' }), /unknown agent/);
  assert.throws(() => normalize({ agent: 'claude', zone: 'space', target: 'x' }), /unknown zone/);
  assert.throws(() => normalize({ agent: 'claude', zone: 'net', target: '   ' }), /missing target/);
  assert.throws(() => normalize({ __bad: '{oops' }), /not valid JSON/);
});

test('normalize clips long text so one event cannot flood the page', () => {
  const e = normalize({ agent: 'claude', zone: 'fence', target: 'a', title: 'x'.repeat(500), said: 'y'.repeat(5000), seen: Array(30).fill('z') }, { maxChars: 100 });
  assert.equal(e.title.length, 90);
  assert.equal(e.said.length, 100);
  assert.equal(e.seen.length, 8);
});

test('esc neutralises markup in agent-controlled text', () => {
  assert.equal(esc(`<img src=x onerror="alert('1')">`), '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;');
  assert.equal(clip('abcdef', 4), 'abc…');
});

test('parseLines accepts JSON Lines, arrays and marks bad lines', () => {
  assert.equal(parseLines('{"a":1}\n\n{"a":2}\n').length, 2);
  assert.equal(parseLines('[{"a":1},{"a":2},{"a":3}]').length, 3);
  assert.deepEqual(parseLines('{"a":1}\nnot json'), [{ a: 1 }, { __bad: 'not json' }]);
  assert.deepEqual(parseLines('   '), []);
});
