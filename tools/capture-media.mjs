#!/usr/bin/env node
// Records the launch media from the built page, as a hosted visitor would see it:
//   docs/img/fenceline-demo.gif  the poisoned-package replay, for the README and posts
//   docs/img/og.png              1200×630 link-preview image, copied to the site as og.png
//   dist/media/*.mp4             the s1ngularity reconstruction as H.264 video for LinkedIn and X,
//                                1920×1080 and 1080×1080 (not committed: upload or attach to a release)
// Usage: npm run media   (builds first; needs Chromium from `npx playwright install chromium` and ffmpeg)
import { chromium } from 'playwright';
import { readFile, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); }
catch { console.error('npm run media needs ffmpeg. Install it (for example, brew install ffmpeg) and try again.'); process.exit(1); }

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'img');
const tmp = join(root, 'test-results', 'media');
const HOST = 'https://fenceline.test/';
const html = await readFile(join(root, 'dist', 'fenceline.html'), 'utf8');

const browser = await chromium.launch();
async function hostedContext(opts) {
  const context = await browser.newContext({ colorScheme: 'light', deviceScaleFactor: 1, ...opts });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(HOST).origin) return route.abort();
    if (url.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html' });
    if (url.pathname.startsWith('/replays/')) return route.fulfill({ body: await readFile(join(root, 'examples', url.pathname)) });
    return route.fulfill({ status: 404, body: '' });
  });
  return context;
}
const finished = (page) => page.waitForFunction(
  () => document.querySelector('#feedStatus').textContent.startsWith('Replay finished'), null, { timeout: 60000 });

await rm(tmp, { recursive: true, force: true });
await mkdir(tmp, { recursive: true });
await mkdir(out, { recursive: true });

// GIF: record the replay at 2× and convert with a shared palette to keep it small.
{
  const size = { width: 1100, height: 720 };
  const context = await hostedContext({ viewport: size, recordVideo: { dir: tmp, size } });
  const page = await context.newPage();
  await page.goto(HOST + '?replay=replays/poisoned-package.jsonl');
  await page.click('[data-speed="2"]');
  await finished(page);
  await page.waitForTimeout(2500);   // let the last walk and the breach flash finish
  await context.close();
  const video = join(tmp, (await readdir(tmp)).find(f => f.endsWith('.webm')));
  const gif = join(out, 'fenceline-demo.gif');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.6', '-i', video, '-vf',
    'fps=10,scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    gif]);
  console.log(`docs/img/fenceline-demo.gif  ${((await stat(gif)).size / 1024 / 1024).toFixed(1)} MB`);
}

// Link preview: the end of the replay, with the incidents panel showing.
{
  const context = await hostedContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(HOST + '?replay=replays/poisoned-package.jsonl');
  await page.click('[data-speed="4"]');
  await finished(page);
  await page.waitForTimeout(3000);
  await page.evaluate(() => { document.querySelector('#hosted').hidden = true; window.scrollTo(0, 0); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, 'og.png') });
  await context.close();
  console.log('docs/img/og.png  1200×630');
}

// Video for posts: the s1ngularity reconstruction, played at normal speed, as landscape and square MP4.
const videos = join(root, 'dist', 'media');
await mkdir(videos, { recursive: true });
for (const [name, size] of [['fenceline-s1ngularity-1920x1080.mp4', { width: 1920, height: 1080 }], ['fenceline-s1ngularity-1080x1080.mp4', { width: 1080, height: 1080 }]]) {
  const dir = join(tmp, name);
  await mkdir(dir, { recursive: true });
  const context = await hostedContext({ viewport: size, recordVideo: { dir, size } });
  const page = await context.newPage();
  await page.goto(HOST + '?replay=replays/s1ngularity.jsonl');
  await finished(page);
  await page.waitForTimeout(3000);   // hold on the final state with the incidents showing
  await context.close();
  const webm = join(dir, (await readdir(dir)).find(f => f.endsWith('.webm')));
  const mp4 = join(videos, name);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.6', '-i', webm,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', '-an', mp4]);
  console.log(`dist/media/${name}  ${((await stat(mp4)).size / 1024 / 1024).toFixed(1)} MB`);
}

await browser.close();
