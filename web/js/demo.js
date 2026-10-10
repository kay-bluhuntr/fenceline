// Scripted demo: a believable session for two agents, including three breaches.
// Events here are already in map form (zone + key), so they skip normalisation.
export const SCRIPT = [
  { a: 'claude', gap: 1.6, title: 'Read refund handler', said: 'PreToolUse · Read src/payments/refund.ts', seen: [['ES', 'open   src/payments/refund.ts  pid 4821']], z: 'fence', k: 'src', v: 'ok' },
  { a: 'copilot', gap: 2.2, title: 'Edited a unit test', said: 'tool · editFile tests/refund.test.ts', seen: [['ES', 'write  tests/refund.test.ts  pid 3310 (Code Helper)']], z: 'fence', k: 'tests', v: 'ok' },
  { a: 'claude', gap: 2.4, title: 'Ran the test suite', said: 'PreToolUse · Bash "npm test"', seen: [['ES', 'exec   /opt/homebrew/bin/npm  pid 5120 ← 4821']], z: 'tools', k: 'npm', v: 'ok' },
  { a: 'claude', gap: 2.6, title: 'Fetched Stripe docs', said: 'PreToolUse · WebFetch docs.stripe.com/refunds', seen: [['NET', 'connect docs.stripe.com:443  pid 4821']], z: 'net', k: 'stripe.com', v: 'ok', rule: 'First visit to this domain' },
  { a: 'copilot', gap: 1.8, title: 'Listed pods', said: 'tool · runInTerminal "kubectl get pods -n payments"', seen: [['ES', 'exec   /opt/homebrew/bin/kubectl  pid 3402 ← 3310']], z: 'tools', k: 'kubectl', v: 'ok' },
  { a: 'claude', gap: 2.4, title: 'Edited CI workflow', said: 'PreToolUse · Edit .github/workflows/ci.yml', seen: [['ES', 'write  .github/workflows/ci.yml  pid 4821']], z: 'fence', k: 'github', v: 'ok' },
  { a: 'claude', gap: 2.2, title: 'Read AWS credentials', said: null, seen: [['ES', 'open   ~/.aws/credentials  pid 5203 (python3) ← 4821']], z: 'vault', k: 'aws', v: 'breach', rule: 'Secret read outside the workspace' },
  { a: 'copilot', gap: 1.6, title: 'Planned Terraform', said: 'tool · runInTerminal "terraform plan"', seen: [['ES', 'exec   /opt/homebrew/bin/terraform  pid 3460 ← 3310']], z: 'tools', k: 'terraform', v: 'ok' },
  { a: 'claude', gap: 2.2, title: 'Uploaded to an unknown host', said: null, seen: [['NET', 'connect upload.drop-zone.example:443  pid 5203 (python3)  ↑ 4.2 KB']], z: 'net', k: 'drop-zone.example', v: 'breach', rule: 'Unreported upload to an unknown domain' },
  { a: 'claude', gap: 2.6, title: 'Pushed a branch', said: 'PreToolUse · Bash "git push origin fix/refunds"', seen: [['ES', 'exec   /usr/bin/git  pid 5188 ← 4821'], ['NET', 'connect github.com:443  pid 5188']], z: 'net', k: 'github.com', v: 'ok' },
  { a: 'copilot', gap: 2.0, title: 'Read SSH config', said: 'tool · runInTerminal "cat ~/.ssh/config"', seen: [['ES', 'open   ~/.ssh/config  pid 3471 (cat) ← 3310']], z: 'vault', k: 'ssh', v: 'warn', rule: 'Reported, but outside the workspace' },
  { a: 'claude', gap: 2.4, title: 'Called the model', said: 'OTel · claude_code.api_request', seen: [['NET', 'connect api.anthropic.com:443  pid 4821']], z: 'net', k: 'anthropic.com', v: 'ok' },
  { a: 'claude', gap: 2.2, title: 'Added a login item', said: null, seen: [['ES', 'create ~/Library/LaunchAgents/com.sync.helper.plist  pid 5240 (sh) ← 4821']], z: 'vault', k: 'launch', v: 'breach', rule: 'Persistence: LaunchAgent created' },
  { a: 'copilot', gap: 2.0, title: 'Built a container', said: 'tool · runInTerminal "docker build ."', seen: [['ES', 'exec   /usr/local/bin/docker  pid 3490 ← 3310']], z: 'tools', k: 'docker', v: 'ok' },
  { a: 'claude', gap: 1.8, title: 'Checked git status', said: 'PreToolUse · Bash "git status"', seen: [['ES', 'exec   /usr/bin/git  pid 5260 ← 4821']], z: 'tools', k: 'git', v: 'ok' },
  { a: 'copilot', gap: 4.0, title: 'Read infra module', said: 'tool · readFile infra/main.tf', seen: [['ES', 'open   infra/main.tf  pid 3310 (Code Helper)']], z: 'fence', k: 'infra', v: 'ok' }
];

export const INJECT = [
  { a: 'claude', gap: 1.2, title: 'Queried the login Keychain', said: null, seen: [['ES', 'exec   /usr/bin/security find-generic-password  pid 5301 ← 4821']], z: 'vault', k: 'keychain', v: 'breach', rule: 'Credential store access' },
  { a: 'claude', gap: 1.2, title: 'Uploaded to an unknown host', said: null, seen: [['NET', 'connect upload.drop-zone.example:443  pid 5301 (security)  ↑ 1.1 KB']], z: 'net', k: 'drop-zone.example', v: 'breach', rule: 'Unreported upload to an unknown domain' }
];
