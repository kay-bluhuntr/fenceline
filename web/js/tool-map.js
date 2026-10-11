// How a Claude Code tool call is drawn: which zone, which target, and its title.
// Shared by the collector (live hook reports) and the page (replayed session transcripts),
// so it uses plain string paths rather than node:path.

// Tools with no effect outside Claude Code: not drawn.
export const META_TOOLS = new Set(['ToolSearch', 'TodoWrite', 'SubagentHandback', 'AskUserQuestion',
  'EnterPlanMode', 'ExitPlanMode', 'ListAgents', 'ListMcpResourcesTool', 'Skill']);

const FILE_TOOLS = ['Read', 'Edit', 'Write', 'NotebookEdit', 'Glob', 'Grep'];

/** Normalise an absolute POSIX path: collapse `.`, `..` and repeated slashes. */
export function normalizePath(path) {
  const out = [];
  for (const part of String(path).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return '/' + out.join('/');
}

/** `path` relative to `cwd` if it's inside it ('' for cwd itself), or null if it's outside. */
export function insidePath(cwd, path) {
  const p = String(path);
  if (p === '~' || p.startsWith('~/')) return null;   // the home folder: never the workspace
  const base = normalizePath(cwd);
  const abs = normalizePath(p.startsWith('/') ? p : `${base}/${p}`);
  if (abs === base) return '';
  return abs.startsWith(base === '/' ? '/' : `${base}/`) ? abs.slice(base === '/' ? 1 : base.length + 1) : null;
}

/**
 * Map one tool call to what the page draws.
 * @param tool   tool name, e.g. Read, Bash, WebFetch, mcp__server__tool
 * @param input  the tool's input object
 * @param cwd    the session's working folder (absolute)
 * @param source label for the `said` observation: 'hook' live, 'transcript' when replayed
 * @returns { zone, target, title, said: { source, text } }
 */
export function mapTool(tool, input = {}, cwd = '/', source = 'hook') {
  const name = String(tool || 'Tool');
  const args = input && typeof input === 'object' ? input : {};
  const said = (text) => ({ source, text: String(text).slice(0, 4000) });

  if (FILE_TOOLS.includes(name)) {
    let target = String(args.file_path || args.path || args.pattern || name);
    const rel = insidePath(cwd, target);
    if (rel !== null) target = rel || '.';
    return { zone: rel === null ? 'vault' : 'fence', target: target.slice(0, 2048),
      title: `${name}: ${target}`.slice(0, 200), said: said(`${name}: ${target}`) };
  }
  if (name === 'WebFetch' || name === 'WebSearch') {
    const target = String(args.url || args.query || name);
    return { zone: 'net', target: target.slice(0, 2048), title: `${name}: ${target}`.slice(0, 200), said: said(`${name}: ${target}`) };
  }
  if (name.startsWith('mcp__')) {
    // mcp__<server>__<tool>: one building per MCP server.
    const [, server = 'mcp', call = name] = name.match(/^mcp__(.+?)__(.+)$/) || [];
    return { zone: 'tools', target: `mcp:${server}`.slice(0, 2048), title: `MCP ${server}: ${call}`.slice(0, 200),
      said: said(`MCP ${server}: ${call} ${JSON.stringify(args)}`) };
  }
  if (name === 'Agent' || name === 'Task') {
    const type = String(args.subagent_type || 'general-purpose');
    return { zone: 'tools', target: `agent:${type}`, title: `Subagent ${type}: ${args.description || 'task'}`.slice(0, 200),
      said: said(`${name} (${type}): ${args.description || ''} ${args.prompt || ''}`) };
  }
  const target = String(args.command || args.query || args.prompt || '') || name;
  return { zone: 'tools', target: target.slice(0, 2048), title: `${name}: ${target}`.slice(0, 200), said: said(`${name}: ${target}`) };
}
