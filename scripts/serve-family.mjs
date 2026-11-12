// Serves the synced copy exactly as the family site will: the app under /low-supply and
// the real function file behind /api/low-supply. For testing the hosted layout on this Mac.
//   node --env-file-if-exists=.env.local scripts/serve-family.mjs   then http://localhost:4351/low-supply
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const site = process.argv[2] || path.join(os.homedir(), 'Documents/claude/LLC/LLC/private-sites/family/site');
const fn = await import(pathToFileURL(path.join(site, 'api/low-supply/[route].js')));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:4351');
  if (url.pathname.startsWith('/api/low-supply/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const out = await fn[req.method](new Request(url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }));
    res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(await out.text()); return;
  }
  let rel = url.pathname.replace(/\/$/, '');
  if (rel === '/low-supply') rel = '/low-supply/index.html';
  if (rel !== '/low-supply-sw.js' && !rel.startsWith('/low-supply/')) { res.writeHead(404).end('Not found'); return; }
  try { const data = await readFile(path.join(site, rel)); res.writeHead(200, { 'content-type': types[path.extname(rel)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(data); }
  catch { res.writeHead(404).end('Not found'); }
}).listen(4351, () => console.log('Family layout at http://localhost:4351/low-supply'));
