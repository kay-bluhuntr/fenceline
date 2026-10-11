// Replaying a Claude Code session transcript (~/.claude/projects/<folder>/<session>.jsonl).
//
// A transcript records what the agent did through its tools: what it *said*. It has no OS
// observations, so every event is marked as not observed. Everything happens in the browser;
// the transcript is never sent anywhere, because it can contain code, commands and secrets.
import { META_TOOLS, mapTool } from './tool-map.js';
import { isSensitivePath } from './events.js';

const NOT_OBSERVED = 'Transcript only: not observed by the OS. Run Fenceline locally to see what your Mac saw.';
const MAX_EXTRAS = 5;   // URLs and sensitive paths pulled from one Bash command

/** True when parsed lines look like a Claude Code transcript rather than Fenceline events. */
export function isTranscript(items) {
  return items.some((o) => o && (o.type === 'assistant' || o.type === 'user') &&
    typeof o.sessionId === 'string' && o.message && typeof o.message === 'object');
}

function toolUses(line) {
  const content = line?.message?.content;
  return Array.isArray(content) ? content.filter((c) => c && c.type === 'tool_use' && typeof c.name === 'string') : [];
}

/** URLs and sensitive paths mentioned in a shell command. */
export function commandMentions(command) {
  const text = String(command || '');
  const urls = [...new Set(text.match(/\bhttps?:\/\/[^\s'"`<>()|;]+/g) || [])];
  const paths = [...new Set((text.match(/(?:~|\/)[^\s'"`;|&<>()$]*/g) || []).filter((p) => p.length > 2 && isSensitivePath(p)))];
  return { urls: urls.slice(0, MAX_EXTRAS), paths: paths.slice(0, MAX_EXTRAS) };
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

/**
 * Convert transcript lines into Fenceline events, oldest first.
 * @returns { events, summary }
 */
export function transcriptToEvents(items) {
  const events = [];
  const summary = {
    toolCalls: 0, commands: 0, subagentCalls: 0, sessions: new Set(), filesInside: new Set(), filesOutside: new Set(),
    domains: new Set(), sensitive: new Set(), mcpServers: new Set(), first: null, last: null
  };
  for (const line of items) {
    if (!line || line.type !== 'assistant') continue;
    const uses = toolUses(line);
    if (!uses.length) continue;
    const cwd = typeof line.cwd === 'string' && line.cwd.startsWith('/') ? line.cwd : '/';
    const base = {
      ts: typeof line.timestamp === 'string' ? line.timestamp : undefined,
      agent: 'claude-code',
      session: typeof line.sessionId === 'string' ? line.sessionId : undefined,
      workspace: cwd
    };
    const sub = line.isSidechain === true ? 'Subagent · ' : '';
    for (const use of uses) {
      if (META_TOOLS.has(use.name)) continue;
      const input = use.input && typeof use.input === 'object' ? use.input : {};
      const m = mapTool(use.name, input, cwd, 'transcript');
      events.push({ ...base, zone: m.zone, target: m.target, title: sub + m.title, said: m.said, seen: NOT_OBSERVED });

      summary.toolCalls++;
      if (base.session) summary.sessions.add(base.session);
      if (base.ts) { summary.first ??= base.ts; summary.last = base.ts; }
      if (sub || use.name === 'Agent' || use.name === 'Task') summary.subagentCalls++;
      if (m.zone === 'fence') summary.filesInside.add(m.target);
      if (m.zone === 'vault') { summary.filesOutside.add(m.target); if (isSensitivePath(m.target)) summary.sensitive.add(m.target); }
      if (m.zone === 'net') { const h = hostOf(m.target); if (h) summary.domains.add(h); }
      if (m.target.startsWith('mcp:')) summary.mcpServers.add(m.target.slice(4));

      if (use.name !== 'Bash') continue;
      summary.commands++;
      // What a command reached or touched, as the agent described it.
      const { urls, paths } = commandMentions(input.command);
      for (const url of urls) {
        const host = hostOf(url);
        if (!host) continue;
        summary.domains.add(host);
        events.push({ ...base, zone: 'net', target: url, title: `${sub}Command reached ${host}`.slice(0, 200), said: m.said, seen: NOT_OBSERVED });
      }
      for (const path of paths) {
        summary.sensitive.add(path);
        events.push({ ...base, zone: 'vault', target: path, title: `${sub}Command touched ${path}`.slice(0, 200), said: m.said, seen: NOT_OBSERVED,
          rule: 'Reported, but a sensitive file' });
      }
    }
  }
  return { events, summary };
}

/** Plain numbers for the "Your agent's day" card. */
export function summaryNumbers(s) {
  return {
    toolCalls: s.toolCalls, commands: s.commands, subagentCalls: s.subagentCalls, sessions: s.sessions.size,
    filesInside: s.filesInside.size, filesOutside: s.filesOutside.size, domains: s.domains.size,
    sensitive: s.sensitive.size, mcpServers: s.mcpServers.size, first: s.first, last: s.last,
    domainList: [...s.domains].sort()
  };
}
