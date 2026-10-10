// Permission-free observer: samples `ps` and `lsof` for the Claude Code process tree.
//
// No root, no Full Disk Access. The trade-off is that it samples: a process or file
// handle that starts and ends between two polls is never seen. Observations are
// tagged source "poll" so the page can show them as lower confidence than "es".
import { execFile } from 'node:child_process';

const PS_ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4})\s+(.*)$/;
const HOOK_SCRIPT = 'claude-hook.mjs';
// Programs Claude Code itself runs as direct children (for its own UI), not on the agent's behalf.
const INTERNAL_CHILDREN = new Set(['git']);

/** Parse `ps -Ao pid=,ppid=,pgid=,lstart=,args=` (run with LC_ALL=C). */
export function parsePs(text) {
  const rows = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(PS_ROW);
    if (!m) continue;
    const started = Date.parse(m[4]);
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), started: isNaN(started) ? 0 : started, args: m[5].trim() });
  }
  return rows;
}

/** ps shows "(name)" for a process caught mid-launch or exiting, before its arguments are readable. */
export function isTransient(row) {
  return row.args.startsWith('(');
}

export function programOf(args) {
  return args.split(/\s+/)[0].split('/').pop();
}

/**
 * Map every process in the given roots' trees to its root PID.
 *
 * Left out, with their children: Fenceline's own hook and collector processes, so the
 * monitor doesn't report itself, and Claude Code's internal helpers such as git.
 *
 * A background process whose shell has exited is reparented to launchd, which hides it
 * from the parent chain. It keeps its process group, though, so it's still attributed:
 *   - opts.groups remembers which root each group was seen under (updated in place), and
 *   - opts.rootForOrphan(startedMs) names the root whose tool call was running when an
 *     orphan in a leaderless group started, or 0.
 */
export function processTree(rows, rootPids, { selfPid = process.pid, groups = new Map(), rootForOrphan = () => 0 } = {}) {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const excluded = new Set(rows.filter((r) => r.args.includes(HOOK_SCRIPT) || r.pid === selfPid ||
    (rootPids.has(r.ppid) && INTERNAL_CHILDREN.has(programOf(r.args)))).map((r) => r.pid));
  const tree = new Map();
  for (const row of rows) {
    let pid = row.pid, root = 0;
    for (let depth = 0; depth < 64 && pid; depth++) {
      if (excluded.has(pid)) { pid = -1; break; }
      if (rootPids.has(pid)) { root = pid; break; }
      pid = byPid.get(pid)?.ppid;
    }
    if (pid === -1) continue;
    if (!root && row.pgid !== row.pid) {
      root = groups.get(row.pgid) || 0;
      if (!root && row.ppid === 1 && !byPid.has(row.pgid)) root = rootForOrphan(row.started);
      if (root && !rootPids.has(root)) root = 0;
    }
    if (!root) continue;
    tree.set(row.pid, root);
    const rootPgid = byPid.get(root)?.pgid;
    if (row.pid !== root && row.pgid !== rootPgid) groups.set(row.pgid, root);
  }
  return tree;
}

/** Parse `lsof -F pftn` output into one entry per file descriptor. */
export function parseLsof(text) {
  const out = [];
  let pid = 0, cur = null;
  for (const line of String(text).split('\n')) {
    const tag = line[0], value = line.slice(1);
    if (tag === 'p') { pid = Number(value); cur = null; }
    else if (tag === 'f') { cur = { pid, fd: value, type: '', name: '' }; out.push(cur); }
    else if (tag === 't' && cur) cur.type = value;
    else if (tag === 'n' && cur) cur.name = value;
  }
  return out;
}

const LOOPBACK = /^(127\.|\[?::1\]?$|\[?::ffff:127\.|localhost$)/;

/** Split "a:1->b:443" or "[::1]:1->[2606::1]:443" into the remote host and port. */
export function remoteOf(name) {
  const arrow = name.indexOf('->');
  if (arrow < 0) return null;
  const remote = name.slice(arrow + 2).split(' ')[0];
  const m = remote.match(/^\[(.+)\]:(\d+)$/) || remote.match(/^(.+):(\d+)$/);
  return m ? { host: m[1], port: Number(m[2]) } : null;
}

/** Turn lsof entries into file and network observations worth reporting. */
export function lsofObservations(entries, isIgnoredPath) {
  const out = [];
  for (const e of entries) {
    if (!/^\d+$/.test(e.fd)) continue;  // cwd, txt, mem: the program and its libraries
    if (e.type === 'REG' && e.name.startsWith('/') && !isIgnoredPath(e.name)) {
      out.push({ pid: e.pid, kind: 'open', target: e.name });
    } else if (e.type === 'IPv4' || e.type === 'IPv6') {
      const remote = remoteOf(e.name);
      if (remote && !LOOPBACK.test(remote.host)) out.push({ pid: e.pid, kind: 'connect', target: `${remote.host}:${remote.port}` });
    }
  }
  return out;
}

export function run(file, args) {
  return new Promise((resolve) => {
    // lsof exits 1 when a listed PID has already gone; its output is still good.
    execFile(file, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } },
      (err, stdout) => resolve(stdout || ''));
  });
}

export function listProcesses() {
  return run('/bin/ps', ['-Aww', '-o', 'pid=,ppid=,pgid=,lstart=,args=']).then(parsePs);
}

/**
 * Start sampling. Calls onObservation({ source, kind, pid, pgid, orphan, rootPid, isRoot, target, text })
 * once per new process, open file or connection in a watched tree.
 * @param opts.roots         Map of Claude root PID -> time it was first seen (ms)
 * @param opts.isIgnoredPath (path) -> true for files not worth reporting
 * @param opts.rootForOrphan see processTree
 * @param opts.isBusy        () -> true while sampling should run at intervalMs; otherwise idleIntervalMs
 * @param opts.onSample      (rows) -> called with each process sample, before its observations
 * @returns {{ stop(): void, wake(): void }} wake() samples now and restarts the cadence
 */
export function startLiteObserver({ roots, isIgnoredPath, onObservation, rootForOrphan,
  intervalMs = 300, idleIntervalMs = 2000, isBusy = () => true, onSample = () => {} }) {
  const groups = new Map();
  const known = new Set();      // `${pid}@${started}` already reported as exec
  const seenFds = new Set();    // `${pid}@${started}|kind|target` already reported
  // Claude itself and helpers from before the session already hold files and API
  // connections. Their first sample is recorded silently; only later changes count.
  const baselined = new Set();  // `${pid}@${started}`
  let running = false;

  async function tick() {
    if (running || !roots.size) return;
    running = true;
    try {
      const rows = await listProcesses();
      onSample(rows);
      const rootPids = new Set(roots.keys());
      const livePgids = new Set(rows.map((r) => r.pgid));
      for (const [pgid, root] of groups) if (!rootPids.has(root) || !livePgids.has(pgid)) groups.delete(pgid);
      const tree = processTree(rows, rootPids, { groups, rootForOrphan });
      const alive = new Set();
      const byPid = new Map(rows.map((r) => [r.pid, r]));
      for (const [pid, rootPid] of tree) {
        const row = byPid.get(pid);
        const id = `${pid}@${row.started}`;
        alive.add(id);
        if (pid === rootPid || known.has(id) || isTransient(row)) continue;
        known.add(id);
        // Long-running helpers that predate this session (MCP servers and so on) aren't new actions.
        if (row.started && row.started < roots.get(rootPid) - 1000) continue;
        onObservation({ source: 'poll', kind: 'exec', pid, pgid: row.pgid, orphan: row.ppid === 1, rootPid, isRoot: false,
          target: row.args.split(/\s+/)[0], text: `exec ${row.args} pid ${pid}` });
      }
      for (const id of known) if (!alive.has(id)) known.delete(id);

      if (tree.size) {
        const entries = parseLsof(await run('/usr/sbin/lsof', ['-nP', '-w', '-F', 'pftn', '-p', [...tree.keys()].join(',')]));
        const live = new Set();
        for (const obs of lsofObservations(entries, isIgnoredPath)) {
          const row = byPid.get(obs.pid);
          const id = `${obs.pid}@${row?.started}`;
          const key = `${id}|${obs.kind}|${obs.target}`;
          live.add(key);
          if (seenFds.has(key)) continue;
          seenFds.add(key);
          const rootPid = tree.get(obs.pid);
          const preexisting = obs.pid === rootPid || (row?.started && row.started < roots.get(rootPid) - 1000);
          if (preexisting && !baselined.has(id)) continue;
          const verb = obs.kind === 'open' ? 'open' : 'connect';
          onObservation({ source: 'poll', ...obs, pgid: row?.pgid, orphan: row?.ppid === 1, rootPid, isRoot: obs.pid === rootPid,
            text: `${verb} ${obs.target} pid ${obs.pid}` });
        }
        for (const pid of tree.keys()) baselined.add(`${pid}@${byPid.get(pid).started}`);
        for (const id of baselined) if (!alive.has(id)) baselined.delete(id);
        // Forget closed handles, so a file opened again later is reported again.
        for (const key of seenFds) if (!live.has(key)) seenFds.delete(key);
      }
    } catch (err) {
      console.error(`Fenceline collector: lite observer poll failed (${err.message}).`);
    } finally {
      running = false;
    }
  }

  // Sample fast while tool calls are running and slowly in between, to save CPU.
  let timer = 0, stopped = false;
  async function loop() {
    clearTimeout(timer);
    await tick();
    if (!stopped) timer = setTimeout(loop, isBusy() ? intervalMs : idleIntervalMs);
  }
  loop();
  return {
    stop() { stopped = true; clearTimeout(timer); },
    wake() { if (!stopped && !running) loop(); }
  };
}
