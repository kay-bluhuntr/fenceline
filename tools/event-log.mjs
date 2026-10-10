// Daily JSON Lines log of collector events, readable by the page's Replay file mode.
//
// Files are private to the user (folder 0700, files 0600), since commands and paths can
// contain secrets. Each line carries `chain`, a SHA-256 of the previous line's chain and
// this event, so an edited, inserted or deleted line shows up in verify-log. It does not
// stop a full rewrite by something running as the same user; see the README.
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, createWriteStream, mkdirSync, openSync, readdirSync, readSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_LOG_DIR = join(homedir(), 'Library', 'Logs', 'Fenceline');
const FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

/** Local calendar date, YYYY-MM-DD. */
export function dayOf(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function chainStart(day) {
  return `fenceline:${day}`;
}

export function chainHash(prev, eventJson) {
  return createHash('sha256').update(`${prev}\n${eventJson}`).digest('hex');
}

/** Check a log file's text. Returns { lines, ok, brokenAt } with brokenAt the first bad line (1-based). */
export function verifyChain(text, day) {
  let prev = chainStart(day), n = 0;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    n++;
    let event;
    try { event = JSON.parse(line); } catch { return { lines: n, ok: false, brokenAt: n }; }
    const { chain, ...rest } = event;
    if (chain !== chainHash(prev, JSON.stringify(rest))) return { lines: n, ok: false, brokenAt: n };
    prev = chain;
  }
  return { lines: n, ok: true, brokenAt: 0 };
}

/** The chain value of the last line of a file, or '' if there is none. */
function lastChain(path) {
  let fd;
  try { fd = openSync(path, 'r'); } catch { return ''; }
  try {
    const size = statSync(path).size;
    const len = Math.min(size, 64 * 1024);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').filter((l) => l.trim());
    return JSON.parse(lines.at(-1) || '{}').chain || '';
  } catch {
    return '';
  } finally {
    closeSync(fd);
  }
}

/** Delete daily files older than `days` days. Returns the names removed. */
export function pruneLogs(dir, days, today = new Date()) {
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - days);
  const oldest = dayOf(cutoff);
  const removed = [];
  let names = [];
  try { names = readdirSync(dir); } catch { return removed; }
  for (const name of names) {
    const m = name.match(FILE);
    if (m && m[1] < oldest) { unlinkSync(join(dir, name)); removed.push(name); }
  }
  return removed;
}

/**
 * Open the log. write(event) appends one event to today's file, rolling over at midnight.
 * @param opts.dir   folder for the daily files
 * @param opts.days  how many days of files to keep
 */
export function openEventLog({ dir = DEFAULT_LOG_DIR, days = 30, onError = () => {} } = {}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  pruneLogs(dir, days);
  let day = '', stream = null, prev = '';

  function roll() {
    const today = dayOf();
    if (today === day && stream) return;
    stream?.end();
    if (day) pruneLogs(dir, days);
    day = today;
    const path = join(dir, `${day}.jsonl`);
    prev = lastChain(path) || chainStart(day);
    // Open synchronously so the file exists, private, before anything is written.
    const fd = openSync(path, 'a', 0o600);
    chmodSync(path, 0o600);
    stream = createWriteStream(null, { fd });
    stream.on('error', onError);
  }

  return {
    dir,
    write(event) {
      roll();
      const json = JSON.stringify(event);
      prev = chainHash(prev, json);
      stream.write(`${json.slice(0, -1)}${json.length > 2 ? ',' : ''}"chain":"${prev}"}\n`);
    },
    close() { stream?.end(); stream = null; }
  };
}
