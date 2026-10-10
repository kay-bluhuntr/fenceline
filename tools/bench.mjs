#!/usr/bin/env node
// Front-end benchmark. Opens a built page in headless Chromium and measures
// main-thread cost in five scenarios. Usage: node tools/bench.mjs dist/fenceline.html [--json out.json]
//
// Numbers are relative: headless Chromium on a CI box is not a MacBook. Compare
// builds on the same machine, not against absolute targets.
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

const page = resolve(process.argv[2] || 'dist/fenceline.html');
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const WINDOW_MS = 8000;

const INIT = `(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__frames = [];
  window.requestAnimationFrame = (cb) => raf((ts) => { const t0 = performance.now(); cb(ts); window.__frames.push(performance.now() - t0); });
})();`;

function synth(i) {
  const z = ['fence', 'net', 'tools', 'vault'][i % 4];
  const target = { fence: `src/mod${i % 40}/f${i}.py`, net: `host${i % 25}.example.com`, tools: ['git', 'npm', 'pytest', 'make', 'node', 'python3'][i % 6], vault: `~/.cache/x${i % 10}` }[z];
  return { agent: i % 3 ? 'claude-code' : 'copilot', zone: z, target, said: i % 7 === 0 ? null : { source: 'hook', text: `synthetic ${i}` }, seen: [{ source: 'es', text: `synthetic event ${i}` }] };
}

const metrics = async (cdp) => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
const renders = (pg) => pg.evaluate(() => (window.fencelineDebug && window.fencelineDebug().renders !== undefined) ? window.fencelineDebug().renders : null);
const pctl = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.max(0, Math.ceil(s.length * p) - 1)] : 0; };

async function measure(pg, cdp, during) {
  await pg.evaluate(() => { window.__frames = []; });
  const r0 = await renders(pg);
  const m0 = await metrics(cdp), t0 = Date.now();
  if (during) await during(); else await pg.waitForTimeout(WINDOW_MS);
  const wall = (Date.now() - t0) / 1000, m1 = await metrics(cdp);
  const frames = await pg.evaluate(() => window.__frames);
  const r1 = await renders(pg);
  // Builds with a render counter report real redraws; older builds redraw on every callback.
  const drawn = r0 === null ? frames.length : r1 - r0;
  return {
    redraws_per_s: +(drawn / wall).toFixed(1),
    callback_ms_mean: +(frames.reduce((a, b) => a + b, 0) / (frames.length || 1)).toFixed(2),
    callback_ms_p95: +pctl(frames, .95).toFixed(2),
    main_thread_busy_pct: +((m1.TaskDuration - m0.TaskDuration) / wall * 100).toFixed(1),
    heap_mb: +(m1.JSHeapUsedSize / 1e6).toFixed(1),
    dom_nodes: m1.Nodes
  };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(INIT);
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
const sockets = [];
await pg.routeWebSocket('ws://localhost:8765', ws => sockets.push(ws));
await pg.goto('file://' + page);
const cdp = await ctx.newCDPSession(pg);
await cdp.send('Performance.enable');
await pg.waitForTimeout(1500);

const r = {};
r.demo_running = await measure(pg, cdp);
await pg.click('#play'); await pg.waitForTimeout(500);
r.demo_paused = await measure(pg, cdp);
await pg.click('#play');

await pg.click('[data-mode="live"]'); await pg.waitForTimeout(200);
await pg.click('#wsBtn'); await pg.waitForTimeout(500);
if (!sockets.length) throw new Error('WebSocket mock did not connect');
let sent = 0;
r.live_burst_200eps = await measure(pg, cdp, async () => {
  const t0 = Date.now();
  while (Date.now() - t0 < WINDOW_MS) {
    sockets[0].send(Array.from({ length: 10 }, (_, k) => JSON.stringify(synth(sent + k))).join('\n'));
    sent += 10;
    await pg.waitForTimeout(50);
  }
});
r.live_burst_200eps.events_sent = sent;
r.after_burst = await measure(pg, cdp);
await pg.waitForTimeout(45000);   // let trails fade and agents fall asleep
r.live_quiet = await measure(pg, cdp);
r.backlog = await pg.evaluate(() => window.fencelineDebug ? window.fencelineDebug() : null);
r.errors = errors;
await browser.close();

console.table(Object.fromEntries(Object.entries(r).filter(([, v]) => v && typeof v === 'object' && 'redraws_per_s' in v)));
console.log('backlog after test:', r.backlog, errors.length ? `errors: ${errors}` : '');
if (jsonOut) await writeFile(jsonOut, JSON.stringify(r, null, 2) + '\n');
