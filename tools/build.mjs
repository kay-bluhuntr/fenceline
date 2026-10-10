#!/usr/bin/env node
// Builds dist/fenceline.html: one self-contained file (JS, CSS and fonts inlined)
// that runs from file:// with no network access. Used for releases and GitHub Pages.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
const out = join(root, 'dist', 'fenceline.html');

const js = await build({
  entryPoints: [join(web, 'js', 'main.js')],
  bundle: true, minify: true, format: 'iife', target: ['safari16', 'chrome110', 'firefox115'],
  write: false, legalComments: 'none'
});
const script = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

let css = await readFile(join(web, 'css', 'fenceline.css'), 'utf8');
const fontRefs = [...css.matchAll(/url\('\.\.\/fonts\/([^']+\.woff2)'\)/g)];
for (const [ref, file] of fontRefs) {
  const b64 = (await readFile(join(web, 'fonts', file))).toString('base64');
  css = css.replace(ref, `url(data:font/woff2;base64,${b64})`);
}

let html = await readFile(join(web, 'index.html'), 'utf8');
const linkTag = '<link rel="stylesheet" href="css/fenceline.css">';
const scriptTag = '<script type="module" src="js/main.js"></script>';
if (!html.includes(linkTag) || !html.includes(scriptTag)) throw new Error('index.html no longer has the expected stylesheet/script tags');
html = html.replace(linkTag, () => `<style>\n${css}\n</style>`).replace(scriptTag, () => `<script>${script}</script>`);

await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
console.log(`dist/fenceline.html  ${(html.length / 1024).toFixed(0)} KB  (${fontRefs.length} fonts inlined)`);
