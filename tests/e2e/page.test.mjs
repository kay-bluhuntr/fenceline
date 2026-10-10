// Browser tests against the built single file (run `npm run build` first).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const PAGE = 'file://' + resolve('dist/fenceline.html');
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function open(viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE);
  await page.waitForTimeout(800);
  return { page, errors };
}
const debug = (page) => page.evaluate(() => window.fencelineDebug());

test('demo runs without errors and fills the log', async () => {
  const { page, errors } = await open();
  await page.waitForTimeout(3000);
  assert.ok(await page.locator('#log li').count() > 0);
  assert.ok(Number(await page.innerText('#sEvents')) > 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('paused page stops drawing (no idle CPU)', async () => {
  const { page } = await open();
  await page.click('#play');
  await page.waitForTimeout(300);
  const r0 = (await debug(page)).renders;
  await page.waitForTimeout(1500);
  assert.equal((await debug(page)).renders, r0, 'renders should not advance while paused');
  await page.close();
});

test('replaying the sample file shows every event and both breaches', async () => {
  const { page, errors } = await open();
  await page.click('[data-mode="file"]');
  await page.click('[data-speed="4"]');
  await page.setInputFiles('#fileIn', resolve('examples/sample-events.jsonl'));
  await page.waitForFunction(() => document.querySelector('#feedStatus').textContent.startsWith('Replay finished'), null, { timeout: 30000 });
  assert.match(await page.innerText('#feedStatus'), /12 shown/);
  await page.waitForTimeout(4000);  // let the last walk finish
  assert.equal(await page.innerText('#sBreach'), '2');
  assert.equal(await page.innerText('#sGhost'), '2');
  assert.deepEqual(errors, []);
  await page.close();
});

test('markup inside events is shown as text, never run', async () => {
  const { page } = await open();
  const evil = '<img src=x onerror="window.__pwned=1">';
  const lines = [
    { agent: 'claude-code', zone: 'vault', target: evil, title: evil, said: null, seen: [{ source: '<svg', text: evil }], rule: evil },
    { agent: 'copilot', zone: 'net', target: 'x.example.com', said: { source: 'hook', text: evil }, seen: evil }
  ].map(l => JSON.stringify(l)).join('\n');
  await page.click('[data-mode="file"]');
  await page.click('[data-speed="4"]');
  await page.setInputFiles('#fileIn', { name: 'evil.jsonl', mimeType: 'application/x-ndjson', buffer: Buffer.from(lines) });
  await page.waitForFunction(() => document.querySelector('#feedStatus').textContent.startsWith('Replay finished'), null, { timeout: 20000 });
  await page.waitForTimeout(3000);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.locator('#log img, #incidents img, #log svg').count(), 0);
  assert.ok((await page.innerText('#log')).includes('<img'), 'the markup should appear as visible text');
  await page.close();
});

test('a burst of 1,000 live events stays in real time and bounded', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const sockets = [];
  await page.routeWebSocket('ws://localhost:8765', ws => sockets.push(ws));
  await page.goto(PAGE);
  await page.click('[data-mode="live"]');
  await page.click('#wsBtn');
  await page.waitForFunction(() => document.querySelector('#feedStatus').textContent.startsWith('Connected'));
  for (let b = 0; b < 20; b++) {
    sockets[0].send(Array.from({ length: 50 }, (_, k) => JSON.stringify({
      agent: k % 2 ? 'claude-code' : 'copilot', zone: ['fence', 'net', 'tools', 'vault'][k % 4],
      target: ['src/a.py', `h${k}.example${b}.com`, 'git', '~/.cache/x'][k % 4], said: k % 9 ? 'ok' : null, seen: 'observed'
    })).join('\n'));
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(1500);
  const d = await debug(page);
  assert.ok(d.walkerQueue <= 6, `queue should be capped, got ${d.walkerQueue}`);
  assert.ok(d.ghosts <= 4);
  assert.ok(d.fastForwarded > 900, 'most of the burst should be fast-forwarded');
  assert.ok(await page.locator('#log li').count() <= 60);
  assert.match(await page.innerText('#feedStatus'), /without animation/);
  await page.close();
});

test('phone width has no horizontal scroll', async () => {
  const { page } = await open({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.close();
});

test('built file makes no network requests', async () => {
  const page = await browser.newPage();
  const external = [];
  page.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.goto(PAGE);
  await page.waitForTimeout(1500);
  assert.deepEqual(external, []);
  assert.ok((await readFile('dist/fenceline.html', 'utf8')).length < 400_000, 'single file should stay under 400 KB');
  await page.close();
});
