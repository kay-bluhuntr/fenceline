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

test('starts in live mode without generating simulated events', async () => {
  const { page, errors } = await open();
  assert.equal(await page.textContent('#modePill'), 'Live feed');
  assert.equal(await page.locator('#log li:not(.emptyrow)').count(), 0);
  assert.equal(await page.innerText('#sEvents'), '0');
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
  await page.routeWebSocket('ws://127.0.0.1:8765', ws => sockets.push(ws));
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

test('live feed reconnects after the collector drops, and Stop ends retries', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const sockets = [];
  await page.routeWebSocket('ws://127.0.0.1:8765', ws => sockets.push(ws));
  await page.goto(PAGE);
  await page.click('#wsBtn');
  await page.waitForFunction(() => document.querySelector('#feedStatus').textContent.startsWith('Connected'));
  sockets[0].close();
  await page.waitForFunction(() => /Retrying in 1 s/.test(document.querySelector('#feedStatus').textContent));
  assert.equal(await page.innerText('#wsBtn'), 'Stop');
  await page.waitForFunction(() => document.querySelector('#feedStatus').textContent.startsWith('Connected'), null, { timeout: 5000 });
  assert.equal(sockets.length, 2);
  sockets[1].close();
  await page.waitForFunction(() => /Retrying/.test(document.querySelector('#feedStatus').textContent));
  await page.click('#wsBtn');
  await page.waitForTimeout(2500);
  assert.equal(sockets.length, 2, 'no reconnect after Stop');
  assert.equal(await page.innerText('#feedStatus'), 'Disconnected.');
  await page.close();
});

test('collector status and sampled observations are shown, and status is not counted as an event', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const sockets = [];
  await page.routeWebSocket('ws://127.0.0.1:8765', ws => sockets.push(ws));
  await page.goto(PAGE);
  await page.click('#wsBtn');
  await page.waitForFunction(() => document.querySelector('#feedStatus').textContent.startsWith('Connected'));
  sockets[0].send(JSON.stringify({ type: 'status', observer: 'lite', detail: 'Lite observer: sampled' }));
  sockets[0].send(JSON.stringify({ agent: 'claude-code', zone: 'net', target: '1.2.3.4:443', said: null,
    seen: [{ source: 'poll', text: 'connect 1.2.3.4:443 pid 9', sampled: true }] }));
  await page.waitForFunction(() => /Lite observer: sampled\. 1 shown/.test(document.querySelector('#feedStatus').textContent));
  assert.equal(await page.locator('#log .pill.sampled').count(), 1);
  assert.equal(await page.locator('#log .ln.sampled').count(), 1);
  await page.close();
});

test('each Claude Code session gets its own named character and log label', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const sockets = [];
  await page.routeWebSocket('ws://127.0.0.1:8765', ws => sockets.push(ws));
  await page.goto(PAGE);
  await page.click('#wsBtn');
  await page.waitForFunction(() => document.querySelector('#feedStatus').textContent.startsWith('Connected'));
  const ev = (session, workspace, target) => JSON.stringify({ agent: 'claude-code', zone: 'fence', target, said: 'Read', session, workspace });
  sockets[0].send([
    ev('s1', '/Users/me/code/fenceline', 'README.md'),
    ev('s2', '/Users/me/code/payments-api', 'app.py'),
    ev('s3', '/Users/me/other/fenceline', 'x.js'),
    ev('s1', '/Users/me/code/fenceline', 'b.js')
  ].join('\n'));
  await page.waitForFunction(() => window.fencelineDebug().walkers.includes('payments-api'));
  const { walkers } = await debug(page);
  assert.deepEqual(walkers.filter(w => w !== 'copilot').sort(), ['fenceline', 'fenceline 2', 'payments-api']);
  assert.equal(await page.textContent('#wsLabel'), '3 sessions: fenceline, payments-api, fenceline 2');
  await page.locator('#log .chip', { hasText: '· payments-api' }).first().waitFor();
  assert.equal(await page.locator('#log .chip', { hasText: '· payments-api' }).count(), 1);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/sessions.png' });
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

/* ---------- hosted copy (GitHub Pages and the like) ---------- */
const HOST = 'https://fenceline.test/fenceline/';

// Serves the built page and example replays as a hosted site would, and records every request.
async function openHosted(path = '', { viewport = { width: 1280, height: 900 }, permissions = [] } = {}) {
  const context = await browser.newContext({ viewport, permissions });
  const page = await context.newPage();
  const requests = [], sockets = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => requests.push(r.url()));
  page.on('websocket', ws => sockets.push(ws.url()));
  const html = await readFile('dist/fenceline.html', 'utf8');
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(HOST).origin) return route.abort();
    if (url.pathname === '/fenceline/') return route.fulfill({ body: html, contentType: 'text/html' });
    if (url.pathname.startsWith('/fenceline/replays/')) {
      try { return route.fulfill({ body: await readFile('examples' + url.pathname.slice('/fenceline'.length)), contentType: 'application/x-ndjson' }); }
      catch { return route.fulfill({ status: 404, body: 'not found' }); }
    }
    return route.fulfill({ status: 404, body: 'not found' });
  });
  await page.goto(HOST + path);
  await page.waitForTimeout(800);
  return { page, context, requests, sockets, errors };
}

test('a hosted copy opens the demo, explains itself and never dials the visitor’s Mac', async () => {
  const { page, context, sockets, errors } = await openHosted();
  assert.equal(await page.textContent('#modePill'), 'Simulated feed');
  assert.equal(await page.isVisible('#hosted'), true);
  assert.equal(await page.getAttribute('#hostedRepo', 'href'), 'https://github.com/kay-bluhuntr/fenceline');
  assert.equal(await page.getAttribute('#hostedPilot', 'href'), 'https://github.com/kay-bluhuntr/fenceline/issues/new?template=pilot.yml');
  assert.equal(await page.textContent('#brandSub'), 'Simulated session');
  await page.waitForFunction(() => Number(document.querySelector('#sEvents').textContent) > 0);
  assert.deepEqual(sockets, []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a local copy hides the hosted banner and share button', async () => {
  const { page } = await open();
  assert.equal(await page.isVisible('#hosted'), false);
  assert.equal(await page.isVisible('#share'), false);
  await page.close();
});

test('?feed=live on a hosted copy still lets a visitor connect their own collector', async () => {
  const { page, context } = await openHosted('?feed=live');
  assert.equal(await page.textContent('#modePill'), 'Live feed');
  await context.close();
});

test('a replay link plays the poisoned-package story with three breaches', async () => {
  const { page, context, errors } = await openHosted('?replay=replays/poisoned-package.jsonl');
  assert.equal(await page.textContent('#modePill'), 'Replaying file');
  await page.click('[data-speed="4"]');
  await page.waitForFunction(() => document.querySelector('#feedStatus').textContent.startsWith('Replay finished'), null, { timeout: 30000 });
  assert.match(await page.innerText('#feedStatus'), /10 shown/);
  await page.waitForTimeout(4000);
  assert.equal(await page.innerText('#sBreach'), '3');
  assert.equal(await page.innerText('#sGhost'), '3');
  assert.deepEqual(errors, []);
  await context.close();
});

test('replay links refuse files from another site, without fetching them', async () => {
  const { page, context, requests } = await openHosted('?replay=' + encodeURIComponent('https://evil.test/fake-breach.jsonl'));
  assert.match(await page.innerText('#feedStatus'), /only open \.jsonl files from this site/);
  assert.equal(requests.some(u => new URL(u).hostname === 'evil.test'), false);
  assert.equal(await page.innerText('#sEvents'), '0');
  await context.close();
});

test('a missing replay says so', async () => {
  const { page, context } = await openHosted('?replay=replays/nope.jsonl');
  await page.waitForFunction(() => /Couldn't load/.test(document.querySelector('#feedStatus').textContent));
  assert.match(await page.innerText('#feedStatus'), /answered 404/);
  await context.close();
});

test('Copy link shares the replay that is on screen', async () => {
  const { page, context } = await openHosted('?replay=replays/poisoned-package.jsonl', { permissions: ['clipboard-read', 'clipboard-write'] });
  await page.waitForFunction(() => document.querySelector('#feedStatus').textContent.startsWith('Replaying'));
  await page.click('#share');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), HOST + '?replay=replays%2Fpoisoned-package.jsonl');
  await page.click('[data-mode="live"]');
  assert.equal(await page.isVisible('#share'), false, 'live sessions only exist on the visitor’s Mac');
  await page.click('[data-mode="demo"]');
  await page.click('#share');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), HOST + '?feed=demo');
  await context.close();
});

test('hosted page at phone width has no horizontal scroll', async () => {
  const { page, context } = await openHosted('', { viewport: { width: 390, height: 844 } });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.screenshot({ path: 'test-results/hosted-phone.png', fullPage: false });
  await context.close();
});
