import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTransient, lsofObservations, parseLsof, parsePs, processTree, remoteOf } from '../../tools/observe-lite.mjs';

// pid ppid pgid lstart args
const PS = [
  '    1     0     1 Thu Oct  8 09:00:00 2026 /sbin/launchd',
  '  100     1    90 Fri Oct  9 21:00:00 2026 /Applications/claude',
  '  200   100   200 Fri Oct  9 21:05:00 2026 /bin/zsh -c npm test',
  '  201   200   200 Fri Oct  9 21:05:01 2026 node --test tests/a.test.mjs',
  '  300   100    90 Fri Oct  9 21:06:00 2026 node /x/fenceline/tools/claude-hook.mjs',
  '  301   300    90 Fri Oct  9 21:06:00 2026 ps -Ao pid=,ppid=,comm=',
  '  302   100    90 Fri Oct  9 21:06:00 2026 git status --porcelain',
  '  303   100    90 Fri Oct  9 21:06:00 2026 (node)',
  '  400     1   400 Fri Oct  9 21:06:00 2026 /usr/bin/unrelated',
  '  500     1   499 Fri Oct  9 21:07:00 2026 python3 -c exfiltrate()'
].join('\n');
const opts = (extra = {}) => ({ selfPid: -1, ...extra });

test('ps rows keep group, full arguments and start times', () => {
  const rows = parsePs(PS);
  assert.equal(rows.length, 10);
  assert.equal(rows[2].args, '/bin/zsh -c npm test');
  assert.equal(rows[2].pgid, 200);
  assert.ok(rows[2].started > rows[1].started);
  assert.equal(isTransient(rows[7]), true);
  assert.equal(isTransient(rows[2]), false);
});

test('process tree follows Claude descendants, skipping Fenceline\'s hook and Claude\'s git', () => {
  const tree = processTree(parsePs(PS), new Set([100]), opts());
  assert.deepEqual([...tree.keys()].sort((a, b) => a - b), [100, 200, 201, 303]);
  assert.equal(tree.get(201), 100);
});

test('a background process reparented to launchd stays attributed through its process group', () => {
  const rows = parsePs(PS);
  // Started during one of Claude's tool calls, in a group whose shell has exited.
  const during = processTree(rows, new Set([100]), opts({ rootForOrphan: () => 100 }));
  assert.equal(during.get(500), 100);
  // Not during a tool call: left alone.
  const outside = processTree(rows, new Set([100]), opts({ rootForOrphan: () => 0 }));
  assert.equal(outside.has(500), false);
  // A group seen earlier under Claude stays Claude's after the shell exits.
  const groups = new Map();
  processTree(rows, new Set([100]), opts({ groups }));
  assert.equal(groups.get(200), 100);
  const orphaned = parsePs(PS.replace('  201   200   200', '  201     1   200').replace(/^ {2}200 .*$/m, ''));
  assert.equal(processTree(orphaned, new Set([100]), opts({ groups })).get(201), 100);
});

test('lsof output becomes file opens and remote connections', () => {
  const entries = parseLsof([
    'p201', 'fcwd', 'tDIR', 'n/Users/test/project',
    'ftxt', 'tREG', 'n/usr/local/bin/node',
    'f12', 'tREG', 'n/Users/test/.ssh/id_ed25519',
    'f13', 'tREG', 'n/Users/test/.claude/projects/x.jsonl',
    'f14', 'tIPv4', 'n10.0.0.2:50123->140.82.112.3:443',
    'f15', 'tIPv4', 'n127.0.0.1:50124->127.0.0.1:8766',
    'f16', 'tIPv6', 'n*:8080',
    'f17', 'tIPv6', 'n[fe80::1]:5000->[2606:4700::6810:84e5]:443'
  ].join('\n'));
  const ignored = (p) => p.startsWith('/Users/test/.claude/');
  assert.deepEqual(lsofObservations(entries, ignored), [
    { pid: 201, kind: 'open', target: '/Users/test/.ssh/id_ed25519' },
    { pid: 201, kind: 'connect', target: '140.82.112.3:443' },
    { pid: 201, kind: 'connect', target: '2606:4700::6810:84e5:443' }
  ]);
});

test('remote addresses parse for IPv4 and IPv6, and listeners have none', () => {
  assert.deepEqual(remoteOf('a:1->1.2.3.4:443'), { host: '1.2.3.4', port: 443 });
  assert.deepEqual(remoteOf('[::1]:1->[::1]:80'), { host: '::1', port: 80 });
  assert.equal(remoteOf('*:8080'), null);
});
