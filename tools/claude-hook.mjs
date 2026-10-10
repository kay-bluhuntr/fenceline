#!/usr/bin/env node
// Forward Claude Code hook events to the local Fenceline collector.
//
// Configure it in exec form ("command": "node", "args": [this file]) so Claude Code
// starts it directly: the collector checks that each report comes from this script
// running as a direct child of Claude, which the agent being watched can't fake.
const MAX_INPUT = 1_000_000;
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > MAX_INPUT) {
    console.error('Fenceline hook: Claude Code hook input exceeded 1 MB.');
    process.exit(0);
  }
}

try {
  const event = JSON.parse(input);
  const body = {
    hook_event_name: event.hook_event_name,
    session_id: event.session_id,
    tool_use_id: event.tool_use_id,
    tool_name: event.tool_name,
    tool_input: event.tool_input,
    cwd: event.cwd,
    hook_pid: process.pid,
    claude_pid: process.ppid
  };
  const response = await fetch('http://127.0.0.1:8766/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(1500)
  });
  if (!response.ok) console.error(`Fenceline hook: collector refused the event (HTTP ${response.status}: ${await response.text()}).`);
} catch (err) {
  console.error(`Fenceline hook: couldn't forward the event (${err.message}). Is the collector running?`);
}
