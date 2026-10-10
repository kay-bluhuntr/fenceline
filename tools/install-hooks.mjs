#!/usr/bin/env node
// Add (or remove) the Fenceline hooks in Claude Code settings, keeping every other setting.
//   node tools/install-hooks.mjs                 every Claude Code session (~/.claude/settings.json)
//   node tools/install-hooks.mjs --project DIR   one project (DIR/.claude/settings.local.json)
//   add --uninstall to remove them
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'Stop', 'SessionEnd'];
const HOOK_SCRIPT = 'claude-hook.mjs';

function isFenceline(hook) {
  return [hook?.command, ...(Array.isArray(hook?.args) ? hook.args : [])]
    .some((part) => typeof part === 'string' && part.includes(HOOK_SCRIPT));
}

/** Return settings with the Fenceline hooks added (once) or removed; other hooks are untouched. */
export function mergeHooks(settings, hookPath, { uninstall = false } = {}) {
  const out = structuredClone(settings || {});
  const hooks = out.hooks && typeof out.hooks === 'object' ? out.hooks : {};
  for (const event of HOOK_EVENTS) {
    const groups = (Array.isArray(hooks[event]) ? hooks[event] : [])
      .map((group) => ({ ...group, hooks: (group.hooks || []).filter((h) => !isFenceline(h)) }))
      .filter((group) => group.hooks.length);
    if (!uninstall) groups.push({ hooks: [{ type: 'command', command: 'node', args: [hookPath] }] });
    if (groups.length) hooks[event] = groups; else delete hooks[event];
  }
  if (Object.keys(hooks).length) out.hooks = hooks; else delete out.hooks;
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const uninstall = argv.includes('--uninstall');
  const projectAt = argv.indexOf('--project');
  const file = projectAt >= 0
    ? join(resolve(argv[projectAt + 1] || '.'), '.claude', 'settings.local.json')
    : join(homedir(), '.claude', 'settings.json');
  const hookPath = resolve(dirname(fileURLToPath(import.meta.url)), HOOK_SCRIPT);

  let settings = {};
  if (existsSync(file)) {
    try { settings = JSON.parse(readFileSync(file, 'utf8')); } catch (err) {
      console.error(`${file} isn't valid JSON (${err.message}); fix it first. Nothing was changed.`);
      process.exit(1);
    }
    copyFileSync(file, `${file}.fenceline-backup`);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(mergeHooks(settings, hookPath, { uninstall }), null, 2) + '\n');
  console.log(uninstall
    ? `Removed the Fenceline hooks from ${file}.`
    : `Added the Fenceline hooks to ${file} (${HOOK_EVENTS.join(', ')}), running ${hookPath}.`);
  if (existsSync(`${file}.fenceline-backup`)) console.log(`The previous version is saved as ${file}.fenceline-backup.`);
  if (!uninstall && projectAt < 0) console.log('Every Claude Code session on this Mac now reports to the collector. Start it with npm run collector:lite.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
