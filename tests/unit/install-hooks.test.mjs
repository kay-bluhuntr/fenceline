import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOOK_EVENTS, mergeHooks } from '../../tools/install-hooks.mjs';

const HOOK = '/x/fenceline/tools/claude-hook.mjs';
const other = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo', args: ['mine'] }] };

test('installing adds one exec-form hook per event and keeps other settings and hooks', () => {
  const before = { model: 'opus', hooks: { PreToolUse: [other] } };
  const after = mergeHooks(before, HOOK);
  assert.equal(after.model, 'opus');
  for (const e of HOOK_EVENTS) assert.ok(after.hooks[e].some((g) => g.hooks[0].args?.[0] === HOOK), e);
  assert.deepEqual(after.hooks.PreToolUse[0], other);
  assert.deepEqual(before.hooks.PreToolUse, [other], 'input not modified');
});

test('installing twice does not duplicate, and uninstalling restores the original', () => {
  const before = { model: 'opus', hooks: { PreToolUse: [other] } };
  const twice = mergeHooks(mergeHooks(before, HOOK), HOOK);
  assert.equal(twice.hooks.Stop.length, 1);
  assert.equal(twice.hooks.PreToolUse.length, 2);
  assert.deepEqual(mergeHooks(twice, HOOK, { uninstall: true }), before);
  assert.deepEqual(mergeHooks({ model: 'x' }, HOOK, { uninstall: true }), { model: 'x' });
});

test('an old shell-form Fenceline hook is replaced by the exec form', () => {
  const old = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node /old/claude-hook.mjs' }] }] } };
  const after = mergeHooks(old, HOOK);
  assert.equal(after.hooks.PreToolUse.length, 1);
  assert.deepEqual(after.hooks.PreToolUse[0].hooks[0], { type: 'command', command: 'node', args: [HOOK] });
});
