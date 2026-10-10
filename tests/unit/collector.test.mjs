import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventKind, eventTarget, parseTool, processDetails } from '../../tools/collector.mjs';

test('collector extracts supported Endpoint Security events and targets', () => {
  assert.equal(eventKind({ event_type: 'ES_EVENT_TYPE_NOTIFY_EXEC' }), 'exec');
  assert.equal(eventKind({ event: { open: {} } }), 'open');
  assert.equal(eventTarget({ target: { executable: { path: '/usr/bin/git' } } }, 'exec'), '/usr/bin/git');
  assert.equal(eventTarget({ file: { path: '/tmp/result.txt' } }, 'open'), '/tmp/result.txt');
  assert.equal(eventTarget({ target: { path: '/tmp/result.txt' } }, 'write'), '/tmp/result.txt');
  assert.deepEqual(processDetails({
    process: { audit_token: { pid: 50 }, parent_audit_token: { pid: 20 } }
  }), { pid: 50, ppid: 20 });
});

test('Claude tool reports are mapped to Fenceline zones and workspace paths', () => {
  const read = parseTool({
    cwd: '/Users/test/project',
    tool_name: 'Read',
    tool_input: { file_path: 'src/main.js' }
  });
  assert.equal(read.zone, 'fence');
  assert.equal(read.target, 'src/main.js');
  assert.equal(read.said.source, 'hook');

  const dotted = parseTool({
    cwd: '/Users/test/project',
    tool_name: 'Read',
    tool_input: { file_path: '..secrets/config' }
  });
  assert.equal(dotted.zone, 'fence');

  const secret = parseTool({
    cwd: '/Users/test/project',
    tool_name: 'Read',
    tool_input: { file_path: '/Users/test/.ssh/id_ed25519' }
  });
  assert.equal(secret.zone, 'vault');

  const fetch = parseTool({
    cwd: '/Users/test/project',
    tool_name: 'WebFetch',
    tool_input: { url: 'https://example.org/data' }
  });
  assert.equal(fetch.zone, 'net');

  const command = parseTool({
    cwd: '/Users/test/project',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' }
  });
  assert.equal(command.zone, 'tools');
  assert.equal(command.target, 'npm test');
});

test('observations during a tool call attach to it; sampled Claude-process ones outside are dropped', async () => {
  const { handleHook, report, isIgnoredPath } = await import('../../tools/collector.mjs');
  assert.equal(isIgnoredPath(`${process.env.HOME}/.claude/settings.json`), true);
  assert.equal(isIgnoredPath(`${process.env.HOME}/.ssh/id_ed25519`), false);
  // No WebSocket server in tests, so sendEvent is a no-op; this checks nothing throws
  // and that a hook pair with observations in between completes cleanly.
  const base = { session_id: 's', tool_use_id: 't1', claude_pid: 4242, cwd: '/Users/test/project' };
  handleHook({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
  report({ source: 'poll', kind: 'exec', target: '/bin/ls', pid: 5000, rootPid: 4242, isRoot: false, text: 'exec ls' });
  handleHook({ ...base, hook_event_name: 'PostToolUse' });
  report({ source: 'poll', kind: 'connect', target: '1.2.3.4:443', pid: 4242, rootPid: 4242, isRoot: true, text: 'connect' });
});

test('MCP and subagent calls get one building per server or agent type', () => {
  const mcp = parseTool({ cwd: '/p', tool_name: 'mcp__claude_ai_Claude_Docs__guide', tool_input: { items: ['x'] } });
  assert.equal(mcp.target, 'mcp:claude_ai_Claude_Docs');
  assert.equal(mcp.title, 'MCP claude_ai_Claude_Docs: guide');
  const agent = parseTool({ cwd: '/p', tool_name: 'Agent', tool_input: { subagent_type: 'Explore', description: 'Find tests', prompt: 'long prompt' } });
  assert.equal(agent.target, 'agent:Explore');
  assert.equal(agent.title, 'Subagent Explore: Find tests');
});

test('Claude Code background-task output files are ignored', async () => {
  const { isIgnoredPath } = await import('../../tools/collector.mjs');
  assert.equal(isIgnoredPath('/private/tmp/claude-501/-Users-x-proj/1234-abcd/tasks/b2x9.output'), true);
  assert.equal(isIgnoredPath('/private/tmp/claude-501/-Users-x-proj/1234-abcd/scratchpad/notes.txt'), false);
});

test('an interrupted tool call is closed at the next session boundary, keeping its observations', async () => {
  const { handleHook, report, setTestSink } = await import('../../tools/collector.mjs');
  const sent = [];
  setTestSink((e) => sent.push(e));
  try {
    const base = { session_id: 'int', claude_pid: 7001, cwd: '/p' };
    handleHook({ ...base, hook_event_name: 'PreToolUse', tool_use_id: 'a', tool_name: 'Bash', tool_input: { command: 'sleep 99' } });
    report({ source: 'poll', kind: 'exec', target: '/bin/sleep', pid: 7002, rootPid: 7001, isRoot: false, text: 'exec sleep 99' });
    assert.equal(sent.length, 0);
    handleHook({ ...base, hook_event_name: 'UserPromptSubmit' });
    assert.equal(sent.length, 1);
    assert.match(sent[0].title, /^No result \(interrupted\): Bash: sleep 99/);
    assert.equal(sent[0].seen[0].text, 'exec sleep 99');
    // With the tool closed, a later observation is unreported rather than absorbed.
    report({ source: 'poll', kind: 'exec', target: '/usr/bin/curl', pid: 7003, rootPid: 7001, isRoot: false, text: 'exec curl' });
    assert.equal(sent.length, 2);
    assert.equal(sent[1].said, null);
  } finally { setTestSink(null); }
});

test('a tool call open longer than the limit is closed as timed out', async () => {
  const { handleHook, expirePending, setTestSink } = await import('../../tools/collector.mjs');
  const sent = [];
  setTestSink((e) => sent.push(e));
  try {
    handleHook({ session_id: 'ttl', claude_pid: 7101, cwd: '/p', hook_event_name: 'PreToolUse', tool_use_id: 'b', tool_name: 'Read', tool_input: { file_path: 'a.txt' } });
    expirePending(Date.now() + 60_000);
    assert.equal(sent.length, 0, 'still within the limit');
    expirePending(Date.now() + 12 * 60_000);
    assert.equal(sent.length, 1);
    assert.match(sent[0].title, /^No result \(timed out\): Read: a.txt/);
  } finally { setTestSink(null); }
});

test('hook sender checks: socket ownership and parent process', async () => {
  const { ownsConnection, parseParent } = await import('../../tools/collector.mjs');
  const lsof = 'p4242\nf20\nn127.0.0.1:53001->127.0.0.1:8766\n';
  assert.equal(ownsConnection(lsof, 53001), true);
  assert.equal(ownsConnection(lsof, 53002), false);
  assert.equal(ownsConnection('p1\nf3\nn127.0.0.1:8766->127.0.0.1:53001\n', 53002), false);
  assert.deepEqual(parseParent('  1167 node /x/tools/claude-hook.mjs\n'), { ppid: 1167, args: 'node /x/tools/claude-hook.mjs' });
  assert.equal(parseParent(''), null);
});

test('only a top-level Claude Code process is accepted as Claude', async () => {
  const { checkNewRoot, looksLikeClaude } = await import('../../tools/collector.mjs');
  assert.equal(looksLikeClaude('/Users/x/.vscode/extensions/anthropic.claude-code-2.1/resources/native-binary/claude --resume'), true);
  assert.equal(looksLikeClaude('node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js'), true);
  assert.equal(looksLikeClaude('/bin/zsh -c node tools/claude-hook.mjs'), false);
  const rows = [
    { pid: 196, ppid: 1, args: '/Applications/Visual Studio Code.app/Contents/MacOS/Code' },
    { pid: 1167, ppid: 196, args: '/x/native-binary/claude --resume' },
    { pid: 2000, ppid: 1167, args: '/bin/zsh -c source snapshot.sh' },
    { pid: 2001, ppid: 2000, args: '/tmp/evil/claude -e spawn()' }
  ];
  assert.equal(checkNewRoot(rows, 1167), '');
  assert.match(checkNewRoot(rows, 2000), /isn't Claude Code/);
  assert.match(checkNewRoot(rows, 2001), /runs inside Claude Code process 1167/);
  assert.match(checkNewRoot(rows, 9999), /isn't Claude Code/);
});
