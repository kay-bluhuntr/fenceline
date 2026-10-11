import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateHost, siteOf, normalize, parseLines, esc, clip, vaultLabel, toolName, workspaceSegment } from '../../web/js/events.js';

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
  assert.equal(toolName('D=/tmp/x; C=~/y; rm -rf $C'), 'rm');
  assert.equal(toolName('pw; ls'), 'pw');
  assert.equal(toolName('A=1'), 'A=1');
  assert.deepEqual(workspaceSegment('./src/app/main.py'), { seg: 'src', isDir: true });
  assert.deepEqual(workspaceSegment('README.md'), { seg: 'README.md', isDir: false });
  assert.equal(vaultLabel('/Users/kay/.ssh/id_ed25519').known, 'ssh');
  assert.equal(vaultLabel('~/Library/LaunchAgents/x.plist').known, 'launch');
  assert.deepEqual(vaultLabel('~/.kube/config'), { known: null, label: '~/.kube' });
});

test('normalize fills sensible defaults', () => {
  const base = { agent: 'claude-code', target: 'x' };
  assert.equal(normalize({ ...base, zone: 'vault', said: null }).v, 'warn');
  assert.equal(normalize({ ...base, zone: 'vault', target: '~/.ssh/id_rsa', said: null }).v, 'breach');
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

test('normalize keeps the sampled flag on observations', () => {
  const e = normalize({ agent: 'claude-code', zone: 'tools', target: 'git', said: null,
    seen: [{ source: 'poll', text: 'exec git', sampled: true }, { source: 'es', text: 'exec git' }, 'plain'] });
  assert.deepEqual(e.seen.map(([src, , sampled]) => [src, sampled]), [['POLL', true], ['ES', false], ['SEEN', false]]);
});

test('unreported actions are a breach only for the internet or a sensitive file', () => {
  const v = (zone, target) => normalize({ agent: 'claude-code', zone, target, said: null, seen: 'x' });
  assert.equal(v('net', 'collect.mystery-host.example').v, 'breach');
  assert.equal(v('net', '140.82.112.3:443').v, 'breach');
  assert.equal(v('net', '192.168.1.20:8080').v, 'warn');
  assert.equal(v('net', 'http://printer.local/status').v, 'warn');
  assert.equal(v('vault', '/Users/me/.ssh/id_ed25519').v, 'breach');
  assert.equal(v('vault', '~/.config/gh/hosts.yml').v, 'breach');
  assert.equal(v('vault', '/private/etc/services').v, 'warn');
  assert.equal(v('tools', 'sleep').v, 'warn');
  assert.equal(v('fence', 'src/a.js').v, 'ok');
  assert.equal(v('net', '140.82.112.3:443').rule, 'Unreported connection to the internet');
  assert.equal(v('vault', '/Users/me/.aws/credentials').rule, 'Unreported access to a sensitive file');
  assert.equal(v('tools', 'sleep').rule, 'Unreported local process');
  // An explicit verdict from the producer still wins.
  assert.equal(normalize({ agent: 'claude-code', zone: 'tools', target: 'nc', said: null, verdict: 'breach' }).v, 'breach');
});

test('private hosts: IPv4 ranges, IPv6 and local names', () => {
  for (const h of ['10.1.2.3', '172.16.0.1:22', '172.31.255.1', '100.100.1.1', '169.254.1.1', '127.0.0.1:8765', '::1', 'fd12:3456::1', 'fe80::1', 'nas.lan', 'localhost:3000'])
    assert.equal(isPrivateHost(h), true, h);
  for (const h of ['8.8.8.8', '172.32.0.1', '100.128.0.1', 'example.com', '2606:4700::6810:84e5:443', 'https://api.github.com/x'])
    assert.equal(isPrivateHost(h), false, h);
});

test('long workspace paths keep their last folders, with the home folder shortened', () => {
  const e = normalize({ agent: 'claude-code', zone: 'fence', target: 'a.js', said: 'x',
    workspace: '/Users/someone/Library/CloudStorage/OneDrive-Personal/Claude/Projects/fenceline' });
  assert.equal(e.workspace.endsWith('/Projects/fenceline'), true);
  assert.equal(e.workspace.length <= 60, true);
  assert.equal(normalize({ agent: 'claude-code', zone: 'fence', target: 'a', said: 'x', workspace: '/Users/someone/code/app' }).workspace, '~/code/app');
});
