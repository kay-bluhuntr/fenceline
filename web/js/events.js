// Pure helpers for turning untrusted event JSON into map events.
// No DOM access here, so everything is unit-testable in Node.
//
// Treat every string in an event as hostile: file names, commands and domains
// can all be chosen by the agent being watched.

export const AGENT_ALIAS = Object.freeze({
  'claude': 'claude', 'claude-code': 'claude', 'claude_code': 'claude', 'claudecode': 'claude',
  'copilot': 'copilot', 'github-copilot': 'copilot', 'gh-copilot': 'copilot'
});
export const ZONE_ALIAS = Object.freeze({
  fence: 'fence', workspace: 'fence',
  net: 'net', network: 'net', internet: 'net', web: 'net',
  tools: 'tools', tool: 'tools', exec: 'tools',
  vault: 'vault', host: 'vault', mac: 'vault', outside: 'vault'
});
export const VERDICT_ALIAS = Object.freeze({
  ok: 'ok', allow: 'ok', allowed: 'ok',
  warn: 'warn', warning: 'warn', check: 'warn',
  breach: 'breach', block: 'breach', blocked: 'breach', alert: 'breach'
});

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(t) { return String(t).replace(/[&<>"']/g, c => ESC[c]); }

export function clip(t, n) {
  const s = String(t);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Group hosts by registrable domain so api.github.com and github.com share a building.
const UK_STYLE_SLD = new Set(['co', 'com', 'org', 'gov', 'ac', 'net', 'ltd', 'plc', 'nhs', 'police', 'sch', 'me']);
export function siteOf(target) {
  const h = String(target).toLowerCase().trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^[^@/]*@/, '')
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
  if (/^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[')) return h;
  const p = h.split('.').filter(Boolean);
  if (p.length < 3) return p.join('.');
  const twoPart = UK_STYLE_SLD.has(p[p.length - 2]) && p[p.length - 1].length === 2;
  return p.slice(twoPart ? -3 : -2).join('.');
}

export function toolName(target) {
  return String(target).trim().split(/\s+/)[0].split('/').pop() || 'tool';
}

export function workspaceSegment(path) {
  const parts = String(path).replace(/^\.\//, '').split('/').filter(Boolean);
  return { seg: parts[0] || '.', isDir: parts.length > 1 };
}

// Known sensitive places get their own fixed vault; anything else is labelled by its first folders.
const VAULT_KNOWN = [[/LaunchAgents|LaunchDaemons/, 'launch'], [/(^|\/)\.ssh(\/|$)/, 'ssh'], [/(^|\/)\.aws(\/|$)/, 'aws'], [/[Kk]eychain|\/security(\s|$)/, 'keychain']];
export function vaultLabel(path) {
  const p = String(path).replace(/^\/Users\/[^/]+/, '~');
  for (const [re, key] of VAULT_KNOWN) if (re.test(p)) return { known: key, label: null };
  const parts = p.split('/').filter(Boolean);
  const label = parts[0] === '~' ? '~/' + (parts[1] || '') : parts.slice(0, 2).join('/');
  return { known: null, label: clip(label, 14) };
}

// Credentials and persistence points: reading or changing these unreported is always a breach.
const SENSITIVE_PATHS = [
  /(^|\/)\.ssh(\/|$)/, /(^|\/)\.aws(\/|$)/, /(^|\/)\.gnupg(\/|$)/, /(^|\/)\.kube\/config$/,
  /(^|\/)\.docker\/config\.json$/, /(^|\/)\.config\/gh(\/|$)/, /(^|\/)\.netrc$/, /(^|\/)\.npmrc$/, /(^|\/)\.pypirc$/,
  /(^|\/)\.git-credentials$/, /[Kk]eychain/, /\/security(\s|$)/, /LaunchAgents|LaunchDaemons/,
  /\/(Login Data|Cookies)$/, /\/(cookies|logins)\.(sqlite|json)$/
];
export function isSensitivePath(path) {
  return SENSITIVE_PATHS.some((re) => re.test(String(path)));
}

/** True for loopback, private, link-local and shared (CGNAT/VPN) addresses, and local host names. */
export function isPrivateHost(target) {
  const h = String(target).toLowerCase().trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^[^@/]*@/, '').split(/[/?#]/)[0];
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}(:\d+)?$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.split(':').length > 2 || h.startsWith('[')) {
    const v6 = h.replace(/^\[/, '').split(']')[0];
    return v6 === '::1' || v6.startsWith('::1:') || /^f[cd][0-9a-f]{0,2}:/.test(v6) || v6.startsWith('fe80:');
  }
  const name = h.replace(/:\d+$/, '');
  return name === 'localhost' || /\.(local|localhost|lan|internal|home\.arpa)$/.test(name);
}

/**
 * Default verdict when the producer gives none. Only reaching the internet or touching a
 * sensitive file without reporting it is a breach; other unreported actions are a check.
 */
export function defaultVerdict(z, target, unreported) {
  if (z === 'fence') return 'ok';
  if (!unreported) return z === 'vault' ? 'warn' : 'ok';
  if (z === 'net') return isPrivateHost(target) ? 'warn' : 'breach';
  if (z === 'vault') return isSensitivePath(target) ? 'breach' : 'warn';
  return 'warn';
}

const UNREPORTED_RULE = {
  net: (t) => isPrivateHost(t) ? 'Unreported connection on the local network' : 'Unreported connection to the internet',
  vault: (t) => isSensitivePath(t) ? 'Unreported access to a sensitive file' : 'Unreported file access outside the workspace',
  tools: () => 'Unreported local process'
};

// Accepts newline-delimited JSON or a single JSON array. Bad lines become { __bad }.
export function parseLines(text) {
  const t = String(text).trim();
  if (!t) return [];
  if (t.startsWith('[')) {
    try { const arr = JSON.parse(t); if (Array.isArray(arr)) return arr; } catch { /* fall through to lines */ }
  }
  const out = [];
  for (const line of t.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    try { out.push(JSON.parse(l)); } catch { out.push({ __bad: l.slice(0, 40) }); }
  }
  return out;
}

const VERB = { fence: 'Touched', net: 'Connected to', tools: 'Ran', vault: 'Touched' };

/**
 * Validate and fill defaults for one raw event.
 * @param raw        parsed JSON
 * @param opts.resolveKey(zone, target) -> map key (may claim a map slot)
 * @param opts.allowlist  expected domains
 * @param opts.maxChars   clip length for display strings
 * @throws Error with a message fit to show the user
 */
export function normalize(raw, { resolveKey = (z, t) => t, allowlist = [], maxChars = 400 } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('expected a JSON object');
  if (raw.__bad !== undefined) throw new Error(`not valid JSON: ${raw.__bad}`);
  const a = AGENT_ALIAS[String(raw.agent ?? '').toLowerCase()];
  if (!a) throw new Error(`unknown agent "${clip(raw.agent ?? '', 30)}" (use claude-code or copilot)`);
  const z = ZONE_ALIAS[String(raw.zone ?? '').toLowerCase()];
  if (!z) throw new Error(`unknown zone "${clip(raw.zone ?? '', 30)}" (use fence, net, tools or vault)`);
  const target = clip(String(raw.target ?? '').trim(), 2048);
  if (!target) throw new Error('missing target');

  const k = resolveKey(z, target);
  const said = raw.said == null || raw.said === '' ? null
    : typeof raw.said === 'string' ? clip(raw.said, maxChars)
    : clip(raw.said.text || raw.said.source || 'reported', maxChars);
  const seenIn = Array.isArray(raw.seen) ? raw.seen : raw.seen ? [raw.seen] : [];
  // Third item: true when the observer samples periodically, so short actions can slip past it.
  const seen = seenIn.slice(0, 8).map(x => typeof x === 'string'
    ? ['SEEN', clip(x, maxChars), false]
    : [clip(String(x?.source || 'seen').toUpperCase(), 4), clip(x?.text ?? '', maxChars), x?.sampled === true]);
  if (!seen.length) seen.push(['SEEN', 'no OS event attached', false]);

  const unreported = !said;
  let v = VERDICT_ALIAS[String(raw.verdict ?? '').toLowerCase()];
  if (!v) v = defaultVerdict(z, target, unreported);

  let rule = raw.rule ? clip(raw.rule, maxChars) : undefined;
  if (!rule) {
    if (unreported && UNREPORTED_RULE[z] && v !== 'ok') rule = UNREPORTED_RULE[z](target);
    else if (v === 'breach') rule = 'Flagged by your rules';
    else if (v === 'warn') rule = z === 'vault' ? 'Reported, but outside the workspace' : 'Needs a look';
    else if (z === 'net' && !allowlist.includes(k)) rule = 'First visit to this domain';
  }
  const title = clip(raw.title ? String(raw.title) : `${VERB[z]} ${z === 'net' ? k : target}`, 90);
  const workspace = raw.workspace ? clip(String(raw.workspace), 60) : undefined;
  const session = typeof raw.session === 'string' && raw.session ? clip(raw.session, 100) : undefined;
  return { a, title, said, seen, z, k, v, rule, ts: raw.ts, workspace, session };
}
