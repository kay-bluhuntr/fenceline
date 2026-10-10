#!/usr/bin/env node
// Writes synthetic events (fictional paths and hosts) for load-testing the front end.
// Usage: node tools/generate-events.mjs --count 5000 --rate 200 > load.jsonl
//   --rate sets the spacing of timestamps (events per second), --unreported the share with said:null.
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > -1 ? Number(process.argv[i + 1]) : def; };
const count = arg('count', 1000), rate = arg('rate', 50), unreportedShare = arg('unreported', .05);

const ZONES = ['fence', 'fence', 'fence', 'tools', 'tools', 'net', 'vault'];
const TOOLS = ['git', 'npm', 'pytest', 'make', 'node', 'python3', 'terraform', 'kubectl'];
const start = Date.parse('2026-10-09T10:00:00+01:00');
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (a) => a[Math.floor(rnd() * a.length)];

for (let i = 0; i < count; i++) {
  const zone = pick(ZONES);
  const target = {
    fence: `${pick(['src', 'tests', 'docs', 'app', 'infra'])}/module${Math.floor(rnd() * 30)}.py`,
    tools: pick(TOOLS),
    net: `${pick(['api', 'cdn', 'docs'])}.service${Math.floor(rnd() * 12)}.example.com`,
    vault: `~/${pick(['.cache', '.config', 'Downloads'])}/item${Math.floor(rnd() * 20)}`
  }[zone];
  const unreported = rnd() < unreportedShare;
  const ev = {
    ts: new Date(start + (i * 1000) / rate).toISOString(),
    agent: rnd() < .65 ? 'claude-code' : 'copilot',
    zone, target,
    said: unreported ? null : { source: 'hook', text: `synthetic action ${i}` },
    seen: [{ source: 'es', text: `synthetic observation ${i}` }]
  };
  process.stdout.write(JSON.stringify(ev) + '\n');
}
