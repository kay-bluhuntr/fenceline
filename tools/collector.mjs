#!/usr/bin/env node
// Local-only Claude Code event collector.
//
// Pairs Claude Code tool hooks (what the agent said) with OS observations (what
// was seen). Two observers:
//   es   - Apple Endpoint Security via eslogger. Complete, but needs root and Full Disk Access.
//   lite - samples ps and lsof. No special permissions, but can miss short-lived actions.
// FENCELINE_OBSERVER=auto (default) tries es and falls back to lite; --lite forces lite.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { listProcesses, processTree, run, startLiteObserver } from './observe-lite.mjs';
import { DEFAULT_LOG_DIR, openEventLog } from './event-log.mjs';

const WS_PORT = Number(process.env.FENCELINE_WS_PORT || 8765);
const HTTP_PORT = Number(process.env.FENCELINE_HOOK_PORT || 8766);
const POLL_MS = Number(process.env.FENCELINE_POLL_MS || 300);
const IDLE_POLL_MS = Number(process.env.FENCELINE_IDLE_POLL_MS || 2000);
const BUSY_TAIL_MS = 5000;        // keep sampling fast this long after a tool call ends
const MAX_BODY = 1_000_000;
// Longest a tool call can stay open before it's closed as "no result" (Bash allows 10 minutes).
const PENDING_TTL_MS = Number(process.env.FENCELINE_PENDING_TTL_MS || 11 * 60 * 1000);
// Skip the check that each hook report comes from claude-hook.mjs run directly by Claude.
const TRUST_HOOKS = process.env.FENCELINE_TRUST_HOOKS === '1';
// Hooks that mean no tool call can still be running in that session.
const SESSION_BOUNDARY = new Set(['Stop', 'UserPromptSubmit', 'SessionEnd']);
const active = new Map();
const claudeRoots = new Map();    // Claude PID -> { workspace, since }
const processRoots = new Map();   // any PID in a Claude tree -> Claude PID (es observer)
const hookPids = new Set();       // Fenceline's own hook processes, never reported
const groups = new Map();         // process group -> Claude PID, for the es observer
const toolWindows = [];           // { rootPid, start, end } of recent tool calls
const WINDOW_SLACK_MS = 1500;     // ps start times are whole seconds
// Tools with no effect outside Claude Code: not drawn, but they still identify the Claude process.
const META_TOOLS = new Set(['ToolSearch', 'TodoWrite', 'SubagentHandback', 'AskUserQuestion',
  'EnterPlanMode', 'ExitPlanMode', 'ListAgents', 'ListMcpResourcesTool', 'Skill']);
let clients;
const allowedOrigins = new Set([
  `http://127.0.0.1:${process.env.PORT || 8080}`,
  `http://localhost:${process.env.PORT || 8080}`
]);

// Claude Code's own bookkeeping and system files, opened constantly and not agent actions.
const HOME = homedir();
const IGNORED_PREFIXES = [`${HOME}/.claude/`, `${HOME}/.claude.json`, `${HOME}/Library/Caches/`,
  '/dev/', '/System/', '/usr/lib/', '/usr/share/', '/private/var/db/', '/Library/Preferences/'];
// Where Claude Code captures background-task output: /private/tmp/claude-<uid>/<project>/<session>/tasks/<id>.output
const TASK_OUTPUT = /^\/(private\/)?tmp\/claude-\d+\/.+\/tasks\/[^/]+\.output$/;
function isIgnoredPath(path) {
  return IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix)) || TASK_OUTPUT.test(path);
}

/** The Claude PID whose tool call was running when a process started at startedMs, or 0. */
function rootForOrphan(startedMs) {
  for (let i = toolWindows.length - 1; i >= 0; i--) {
    const w = toolWindows[i];
    if (!claudeRoots.has(w.rootPid)) continue;
    if (startedMs >= w.start - WINDOW_SLACK_MS && startedMs <= (w.end ?? Date.now()) + WINDOW_SLACK_MS) return w.rootPid;
  }
  return 0;
}

let lite = null;                  // the running Lite observer, if any
let eventLog = null;              // daily JSON Lines log, unless --no-log
let lastToolEnd = 0;
// Which observer is running, sent to each page as a status message.
let observerStatus = { type: 'status', observer: 'none', detail: 'starting' };
let testSink = null;
/** Tests only: receive sent events instead of broadcasting them. */
function setTestSink(fn) { testSink = fn; }

function setObserver(observer, detail) {
  observerStatus = { type: 'status', observer, detail };
  sendEvent(observerStatus);
}

function sendEvent(event) {
  if (testSink) { testSink(event); return; }
  if (eventLog && event.type !== 'status') eventLog.write(event);
  if (!clients) return;
  const message = JSON.stringify(event);
  for (const client of clients.clients) {
    if (client.readyState === 1) client.send(message);
  }
}

function now() {
  return new Date().toISOString();
}

function isLocalAddress(address = '') {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function parseTool(event) {
  const tool = String(event.tool_name || 'Tool');
  const input = event.tool_input && typeof event.tool_input === 'object' ? event.tool_input : {};
  const cwd = typeof event.cwd === 'string' ? resolve(event.cwd) : process.cwd();
  let target, zone;

  if (['Read', 'Edit', 'Write', 'NotebookEdit', 'Glob', 'Grep'].includes(tool)) {
    target = String(input.file_path || input.path || input.pattern || tool);
    const absolute = isAbsolute(target) ? resolve(target) : resolve(cwd, target);
    const rel = relative(cwd, absolute);
    zone = rel === '..' || rel.startsWith(`..${sep}`) ? 'vault' : 'fence';
    if (zone === 'fence') target = rel || '.';
  } else if (['WebFetch', 'WebSearch'].includes(tool)) {
    target = String(input.url || input.query || tool);
    zone = 'net';
  } else if (tool.startsWith('mcp__')) {
    // mcp__<server>__<tool>: one building per MCP server.
    const [, server = 'mcp', name = tool] = tool.match(/^mcp__(.+?)__(.+)$/) || [];
    target = `mcp:${server}`;
    zone = 'tools';
    return { cwd, zone, target: target.slice(0, 2048),
      said: { source: 'hook', text: `MCP ${server}: ${name} ${JSON.stringify(input)}`.slice(0, 4000) },
      title: `MCP ${server}: ${name}`.slice(0, 200) };
  } else if (tool === 'Agent' || tool === 'Task') {
    const type = String(input.subagent_type || 'general-purpose');
    target = `agent:${type}`;
    zone = 'tools';
    return { cwd, zone, target,
      said: { source: 'hook', text: `${tool} (${type}): ${input.description || ''} ${input.prompt || ''}`.slice(0, 4000) },
      title: `Subagent ${type}: ${input.description || 'task'}`.slice(0, 200) };
  } else {
    const command = String(input.command || input.query || input.prompt || '');
    target = command || tool;
    zone = 'tools';
  }

  return {
    cwd,
    zone,
    target: target.slice(0, 2048),
    said: { source: 'hook', text: `${tool}: ${target}`.slice(0, 4000) },
    title: `${tool}: ${target}`.slice(0, 200)
  };
}

/* ---------- Endpoint Security (eslogger) parsing ---------- */

function eventKind(raw) {
  const nested = raw?.event;
  if (typeof raw?.event_type === 'string') {
    const type = raw.event_type.toLowerCase();
    const match = type.match(/(?:notify|auth)_([a-z_]+)$/);
    return match ? match[1] : type;
  }
  if (nested && typeof nested === 'object') {
    return ['exec', 'open', 'write'].find((key) => nested[key]) || '';
  }
  return '';
}

function eventPayload(raw, kind) {
  return raw?.event?.[kind] || raw?.event || {};
}

function eventTarget(payload, kind) {
  const preferred = {
    exec: [payload?.target?.executable?.path, payload?.target?.path],
    open: [payload?.file?.path, payload?.target?.path],
    write: [payload?.target?.path, payload?.file?.path]
  }[kind] || [];
  return preferred.find((value) => typeof value === 'string' && value) || '';
}

function processDetails(raw) {
  const process = raw?.process || {};
  return {
    pid: Number(process.audit_token?.pid ?? process.pid),
    ppid: Number(process.parent_audit_token?.pid ?? process.ppid)
  };
}

function isHookExec(payload) {
  const args = Array.isArray(payload?.args) ? payload.args : [];
  return args.some((arg) => typeof arg === 'string' && arg.includes('claude-hook.mjs'));
}

function observation(raw) {
  const kind = eventKind(raw);
  if (!['exec', 'open', 'write'].includes(kind)) return null;
  const payload = eventPayload(raw, kind);
  const target = eventTarget(payload, kind);
  if (!target) return null;
  const { pid, ppid } = processDetails(raw);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (hookPids.has(pid) || hookPids.has(ppid)) { hookPids.add(pid); return null; }
  if (kind === 'exec' && isHookExec(payload)) { hookPids.add(pid); return null; }
  const rootPid = processRoots.get(pid) || processRoots.get(ppid);
  if (!rootPid) return null;
  if (kind === 'exec' && ppid === rootPid && basename(target) === 'git') { hookPids.add(pid); return null; }
  processRoots.set(pid, rootPid);
  if (kind !== 'exec' && isIgnoredPath(target)) return null;
  return { source: 'es', kind, target, pid, rootPid, isRoot: pid === rootPid, text: `${kind} ${target} pid ${pid}`.slice(0, 4000) };
}

function emitObserved(raw) {
  const item = observation(raw);
  if (item) report(item);
}

// Keep processRoots in step with the live process tree, for the es observer.
async function refreshProcessRoots() {
  if (!claudeRoots.size) return;
  const rows = await listProcesses();
  const alive = new Set(rows.map((row) => row.pid));
  for (const pid of claudeRoots.keys()) if (!alive.has(pid)) claudeRoots.delete(pid);
  for (const pid of hookPids) if (!alive.has(pid)) hookPids.delete(pid);
  processRoots.clear();
  const tree = processTree(rows, new Set(claudeRoots.keys()), { groups, rootForOrphan });
  for (const [pid, rootPid] of tree) processRoots.set(pid, rootPid);
}

/* ---------- correlation ---------- */

/**
 * One observed action from either observer. While a tool is running it's attached
 * to that tool's report; otherwise it's sent as an unreported event.
 */
function report({ source, kind, target, pid, rootPid, isRoot, text }) {
  // Lite samples, so it can miss short actions; the page shows its observations as lower confidence.
  const seen = source === 'poll' ? { source, text, sampled: true } : { source, text };
  const pending = [...active.values()].reverse().find((entry) => entry.claudePid === rootPid);
  if (pending) {
    if (pending.seen.length < 8) pending.seen.push(seen);
    return;
  }
  // Sampled connections and handles of Claude itself are mostly its own API traffic and
  // bookkeeping, so outside a tool call they aren't treated as unreported actions.
  if (source === 'poll' && isRoot) return;
  const workspace = claudeRoots.get(rootPid)?.workspace || '';
  const session = claudeRoots.get(rootPid)?.sessionId;
  let zone, shown;
  if (kind === 'exec') { zone = 'tools'; shown = basename(target); }
  else if (kind === 'connect') { zone = 'net'; shown = target; }
  else {
    const full = isAbsolute(target) ? resolve(target) : target;
    zone = workspace && (full === workspace || full.startsWith(`${workspace}/`)) ? 'fence' : 'vault';
    shown = target;
  }
  sendEvent({
    ts: now(),
    agent: 'claude-code',
    title: `Unmatched OS event: ${basename(target)}`.slice(0, 200),
    zone,
    target: shown.slice(0, 2048),
    said: null,
    seen: [seen],
    workspace,
    session
  });
}

/* ---------- hook sender verification ---------- */

/** True when lsof -F output shows a TCP connection from the given local port. */
function ownsConnection(lsofText, port) {
  return String(lsofText).split('\n').some((line) =>
    line.startsWith('n') && /^n(?:127\.0\.0\.1|\[::1\]|\[::ffff:127\.0\.0\.1\]):(\d+)->/.exec(line)?.[1] === String(port));
}

/** Parse `ps -o ppid=,args= -p <pid>` into { ppid, args }, or null. */
function parseParent(psText) {
  const m = String(psText).trim().match(/^(\d+)\s+(.*)$/);
  return m ? { ppid: Number(m[1]), args: m[2] } : null;
}

/** True for a Claude Code process: the native binary, or the npm CLI run by node. */
function looksLikeClaude(args) {
  const program = String(args).split(/\s+/)[0].split('/').pop();
  return program === 'claude' || /@anthropic-ai\/claude-code\/cli\.m?js/.test(args);
}

/**
 * Check a Claude PID seen for the first time. Anything the watched agent starts runs
 * inside a real Claude's process tree, so a genuine Claude has no Claude among its
 * ancestors. This rejects the hook run from the agent's shell, and a copied binary
 * renamed "claude".
 */
function checkNewRoot(rows, claudePid) {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const row = byPid.get(claudePid);
  if (!row || !looksLikeClaude(row.args)) return `process ${claudePid} isn't Claude Code`;
  let pid = row.ppid;
  for (let depth = 0; depth < 64 && pid > 1; depth++) {
    const ancestor = byPid.get(pid);
    if (!ancestor) break;
    if (claudeRoots.has(pid) || looksLikeClaude(ancestor.args)) return `process ${claudePid} runs inside Claude Code process ${pid}`;
    pid = ancestor.ppid;
  }
  return '';
}

/**
 * Prove a hook report came from claude-hook.mjs run directly by Claude Code, and return
 * that Claude's PID. The reported PIDs are only hints: the connection must belong to the
 * hook process, the hook's parent is read from the OS, and that parent must be a genuine
 * top-level Claude Code process.
 */
async function verifyHook(event, remotePort) {
  if (TRUST_HOOKS) return Number(event?.claude_pid);
  const hookPid = Number(event?.hook_pid);
  if (!Number.isInteger(hookPid) || hookPid <= 0) throw new Error('no hook_pid; update tools/claude-hook.mjs');
  const [sockets, ps] = await Promise.all([
    run('/usr/sbin/lsof', ['-nP', '-a', '-p', String(hookPid), '-iTCP', '-sTCP:ESTABLISHED', '-Fn']),
    run('/bin/ps', ['-o', 'ppid=,args=', '-p', String(hookPid)])
  ]);
  if (!ownsConnection(sockets, remotePort)) throw new Error(`the request didn't come from process ${hookPid}`);
  const parent = parseParent(ps);
  if (!parent?.args.includes('claude-hook.mjs')) throw new Error(`process ${hookPid} isn't the Fenceline hook`);
  const claudePid = parent.ppid;
  if (!claudeRoots.has(claudePid)) {
    const problem = checkNewRoot(await listProcesses(), claudePid);
    if (problem) {
      throw new Error(`${problem}. The hook must be started directly by Claude Code; use the exec form ` +
        '("command": "node", "args": [...]) from the README');
    }
  }
  return claudePid;
}

/* ---------- hook handling ---------- */

/** Send an open tool call that never got its PostToolUse, so its observations aren't lost. */
function closePending(key, why) {
  const pending = active.get(key);
  if (!pending) return;
  active.delete(key);
  pending.window.end = lastToolEnd = Date.now();
  sendEvent({
    ts: now(),
    agent: 'claude-code',
    zone: pending.zone,
    target: pending.target,
    title: `No result (${why}): ${pending.title}`.slice(0, 200),
    said: pending.said,
    seen: pending.seen,
    workspace: pending.cwd,
    session: pending.sessionId
  });
}

function expirePending(at = Date.now()) {
  for (const [key, pending] of active) {
    if (at - pending.window.start > PENDING_TTL_MS) closePending(key, 'timed out');
  }
}

function handleHook(event) {
  const name = String(event?.hook_event_name || '');
  const sessionId = String(event?.session_id || '');
  const toolUseId = String(event?.tool_use_id || '');
  const claudePid = Number(event?.claude_pid);
  if (!sessionId || !Number.isInteger(claudePid) || claudePid <= 0) {
    throw new Error('hook event is missing its session or Claude process ID');
  }
  if (SESSION_BOUNDARY.has(name)) {
    // Interrupted or crashed tools never send PostToolUse; close them here.
    for (const key of [...active.keys()]) if (key.startsWith(`${sessionId}:`)) closePending(key, 'interrupted');
    return;
  }
  if (!toolUseId) throw new Error('tool hook event is missing its tool-use ID');
  const key = `${sessionId}:${toolUseId}`;

  if (name === 'PreToolUse') {
    const tool = parseTool(event);
    const known = claudeRoots.get(claudePid);
    claudeRoots.set(claudePid, { workspace: tool.cwd, since: known?.since ?? Date.now(), sessionId });
    processRoots.set(claudePid, claudePid);
    if (META_TOOLS.has(String(event.tool_name))) return;
    const window = { rootPid: claudePid, start: Date.now(), end: null };
    toolWindows.push(window);
    if (toolWindows.length > 200) toolWindows.shift();
    active.set(key, { ...tool, claudePid, sessionId, seen: [], window });
    lite?.wake();
    return;
  }
  if (name !== 'PostToolUse' && name !== 'PostToolUseFailure') return;

  const pending = active.get(key);
  if (!pending) return;
  active.delete(key);
  pending.window.end = lastToolEnd = Date.now();
  sendEvent({
    ts: now(),
    agent: 'claude-code',
    zone: pending.zone,
    target: pending.target,
    title: name === 'PostToolUseFailure' ? `Failed: ${pending.title}`.slice(0, 200) : pending.title,
    said: pending.said,
    seen: pending.seen,
    workspace: pending.cwd,
    session: sessionId
  });
}

/** Forget Claude processes that have exited, so a reused PID is checked afresh. */
async function reapRoots() {
  if (!claudeRoots.size) return;
  const out = await run('/bin/ps', ['-o', 'pid=', '-p', [...claudeRoots.keys()].join(',')]);
  const alive = new Set(out.split('\n').map((line) => Number(line.trim())).filter(Boolean));
  for (const pid of [...claudeRoots.keys()]) if (!alive.has(pid)) claudeRoots.delete(pid);
}

/* ---------- observers ---------- */

const liteRoots = {
  get size() { return claudeRoots.size; },
  keys: () => claudeRoots.keys(),
  get: (pid) => claudeRoots.get(pid)?.since ?? 0
};

function startLite(reason) {
  console.log(`Fenceline collector: lite observer on (${reason}). It samples ps and lsof every ${POLL_MS} ms ` +
    `during tool calls and every ${IDLE_POLL_MS} ms between them, so shorter actions can be missed.`);
  lite = startLiteObserver({
    roots: liteRoots, isIgnoredPath, onObservation: report, rootForOrphan,
    intervalMs: POLL_MS, idleIntervalMs: IDLE_POLL_MS,
    isBusy: () => active.size > 0 || Date.now() - lastToolEnd < BUSY_TAIL_MS
  });
  setObserver('lite', `Lite observer: sampled every ${POLL_MS} ms during tool calls, so short actions can be missed`);
  return () => { lite.stop(); lite = null; };
}

function startEs({ fallback }) {
  console.log('Starting Apple Endpoint Security logger; sudo may ask for your password.');
  const logger = spawn('sudo', ['/usr/bin/eslogger', 'exec', 'open', 'write'], {
    stdio: ['inherit', 'pipe', 'inherit']
  });
  const rootsTimer = setInterval(() => refreshProcessRoots().catch(() => {}), 500);
  setObserver('es', 'Endpoint Security observer: every process launch and file open or write');
  createInterface({ input: logger.stdout }).on('line', (line) => {
    try {
      emitObserved(JSON.parse(line));
    } catch (err) {
      console.error(`Fenceline collector: couldn't process an eslogger event (${err.message}).`);
    }
  });
  let stopLite = null;
  const failed = (why) => {
    clearInterval(rootsTimer);
    if (fallback && !stopLite) stopLite = startLite(why);
    else if (!fallback) {
      console.error(`Fenceline collector: ${why}. Still forwarding Claude Code hook reports, but ` +
        'OS events (and unreported-action detection) are off. Run npm run collector:lite to observe without permissions.');
      setObserver('none', 'No OS observer: only what Claude Code reports is shown, so nothing can show as unreported');
    }
  };
  logger.on('error', (err) => failed(`couldn't start eslogger: ${err.message}`));
  logger.on('close', (code) => {
    if (code === 0 || shuttingDown) return;
    failed(`eslogger exited with status ${code}; for Endpoint Security, grant Full Disk Access to this ` +
      'terminal app, quit and reopen it, then restart the collector');
  });
  return () => { clearInterval(rootsTimer); stopLite?.(); logger.kill('SIGTERM'); };
}

let shuttingDown = false;

function start() {
  const mode = process.argv.includes('--lite') ? 'lite' : (process.env.FENCELINE_OBSERVER || 'auto');
  if (!['auto', 'es', 'lite'].includes(mode)) {
    console.error(`Fenceline collector: FENCELINE_OBSERVER must be auto, es or lite, not "${mode}".`);
    process.exit(2);
  }
  if (!process.argv.includes('--no-log')) {
    const days = Number(process.env.FENCELINE_LOG_DAYS || 30);
    eventLog = openEventLog({
      dir: process.env.FENCELINE_LOG_DIR || DEFAULT_LOG_DIR, days,
      onError: (err) => console.error(`Fenceline collector: couldn't write the event log (${err.message}).`)
    });
    console.log(`Fenceline collector: logging events to ${eventLog.dir} (kept ${days} days; --no-log to turn off).`);
  }
  clients = new WebSocketServer({
    host: '127.0.0.1',
    port: WS_PORT,
    verifyClient: ({ origin }) => !origin || allowedOrigins.has(origin)
  });
  const http = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (req.method !== 'POST' || req.url !== '/events' || !isLocalAddress(req.socket.remoteAddress) ||
        (origin && !allowedOrigins.has(origin))) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    try {
      for await (const chunk of req) {
        body += chunk;
        if (body.length > MAX_BODY) throw new Error('hook request exceeded 1 MB');
      }
      const event = JSON.parse(body);
      const claudePid = await verifyHook(event, req.socket.remotePort);
      handleHook({ ...event, claude_pid: claudePid });
      res.writeHead(204).end();
    } catch (err) {
      console.error(`Fenceline collector: rejected hook event (${err.message}).`);
      res.writeHead(400).end(err.message);
    }
  });
  http.listen(HTTP_PORT, '127.0.0.1', () => {
    console.log(`Claude Code hook endpoint listening on http://127.0.0.1:${HTTP_PORT}/events`);
  });
  http.on('error', (err) => console.error(`Fenceline collector: hook receiver error (${err.message}).`));

  clients.on('listening', () => {
    console.log(`Fenceline collector listening on ws://127.0.0.1:${WS_PORT}`);
    const stopObserver = mode === 'lite' ? startLite('requested with --lite') : startEs({ fallback: mode === 'auto' });
    const expiry = setInterval(() => expirePending(), 30_000);
    const reaper = setInterval(() => reapRoots().catch(() => {}), 5_000);
    if (TRUST_HOOKS) console.log('Fenceline collector: FENCELINE_TRUST_HOOKS=1, so hook reports are not checked.');
    const shutdown = () => {
      shuttingDown = true;
      clearInterval(expiry);
      clearInterval(reaper);
      eventLog?.close();
      stopObserver();
      clients.close();
      http.close(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
  clients.on('connection', (socket) => socket.send(JSON.stringify(observerStatus)));
  clients.on('error', (err) => console.error(`Fenceline collector: WebSocket server error (${err.message}).`));
}

export {
  emitObserved, eventKind, eventTarget, expirePending, handleHook, isIgnoredPath, observation, ownsConnection,
  checkNewRoot, looksLikeClaude, parseParent, parseTool, processDetails, report, setTestSink, verifyHook
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) start();
