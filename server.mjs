// Local server: the static app in public/ plus the API, on one port.
// Run with: npm run dev   then open http://localhost:4350
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeApp } from './lib/http.js';
import { defaultStore } from './lib/store.js';
import { makePush } from './lib/push.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.PORT || 4350);
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8'
};

const app = makeApp({ store: await defaultStore(), push: makePush() });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 20000) { res.writeHead(413).end(); return; } }
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    const out = await app.handle({
      method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams),
      headers: req.headers, body, ip: req.socket.remoteAddress
    });
    res.writeHead(out.status, { 'content-type': out.type || 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(out.json));
    return;
  }
  const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': types[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache', 'x-content-type-options': 'nosniff'
    });
    res.end(data);
  } catch { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); }
});

server.listen(port, () => console.log(`Low Supply is running at http://localhost:${port}`));
// The clock. Deployed, a scheduler calls /api/tick instead.
setInterval(() => app.tickAll().catch(() => {}), 60e3).unref();
