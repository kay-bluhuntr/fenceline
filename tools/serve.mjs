#!/usr/bin/env node
// Minimal static server for development. Binds to 127.0.0.1 only, so the
// monitor is never exposed to your network. Usage: npm start [-- --port 8080]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const argPort = process.argv.indexOf('--port');
const port = argPort > -1 ? Number(process.argv[argPort + 1]) : Number(process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.json': 'application/json', '.jsonl': 'application/x-ndjson', '.txt': 'text/plain; charset=utf-8'
};
const CSP = "default-src 'self'; connect-src 'self' ws://localhost:* ws://127.0.0.1:* wss:; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'";

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(root, urlPath));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Fenceline on http://127.0.0.1:${port}  (local only, Ctrl+C to stop)`));
