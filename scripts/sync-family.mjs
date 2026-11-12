// Copies Low Supply into the family site (family.stevendesignco.com/low-supply), the way
// the wish list's sync does. It writes only its own files there:
//   family/site/low-supply/            the app (public/ with its addresses moved under /low-supply)
//   family/site/low-supply-sw.js       the service worker, at the root so its reach covers /low-supply
//   family/site/lib/low-supply/        the backend rules
//   family/site/api/low-supply/[route].js   one function for every /api/low-supply/<name>
// Never edit those copies. Change the app here, then: npm run sync:family
// After that the family runbook takes over: python3 build.py family, then the deploy.
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const site = process.argv[2] || path.join(os.homedir(), 'Documents/claude/LLC/LLC/private-sites/family/site');
if (!existsSync(path.join(site, 'middleware.js'))) throw new Error('That is not the family site folder: ' + site);
const BASE = '/low-supply';
const read = f => readFileSync(f, 'utf8');

// 1. The app.
const app = path.join(site, 'low-supply');
rmSync(app, { recursive: true, force: true });
cpSync(path.join(root, 'public'), app, { recursive: true });
rmSync(path.join(app, 'sw.js'));
writeFileSync(path.join(app, 'index.html'), read(path.join(app, 'index.html')).replace(/\b(href|src)="\/(?!\/)/g, `$1="${BASE}/`));
writeFileSync(path.join(app, 'sdc.css'), read(path.join(app, 'sdc.css')).replaceAll('url(/fonts/', `url(${BASE}/fonts/`));
const manifest = JSON.parse(read(path.join(app, 'manifest.webmanifest')));
Object.assign(manifest, { start_url: BASE, scope: BASE, icons: manifest.icons.map(i => ({ ...i, src: BASE + i.src })) });
writeFileSync(path.join(app, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');

// 2. The service worker. It works out where it lives from its own name.
cpSync(path.join(root, 'public/sw.js'), path.join(site, 'low-supply-sw.js'));

// 3. The backend rules. The supply list is shared with the app, so point at that copy.
const lib = path.join(site, 'lib/low-supply');
rmSync(lib, { recursive: true, force: true });
mkdirSync(lib, { recursive: true });
for (const f of ['core.js', 'http.js', 'store.js', 'push.js']) {
  writeFileSync(path.join(lib, f), read(path.join(root, 'lib', f)).replace("'../public/js/catalog.js'", "'../../low-supply/js/catalog.js'"));
}

// 4. The one function.
const api = path.join(site, 'api/low-supply');
rmSync(api, { recursive: true, force: true });
mkdirSync(api, { recursive: true });
writeFileSync(path.join(api, '[route].js'), `// Every /api/low-supply/<route> address, served by this one function, so Low Supply
// costs the family site a single function. Written by low-supply/scripts/sync-family.mjs.
import { makeApp } from '../../lib/low-supply/http.js';
import { defaultStore } from '../../lib/low-supply/store.js';
import { makePush } from '../../lib/low-supply/push.js';

let app;
async function run(request) {
  app ??= makeApp({ store: await defaultStore(), push: makePush(), base: '${BASE}' });
  const url = new URL(request.url);
  let body = {};
  if (request.method === 'POST') {
    const text = await request.text();
    if (text.length > 20000) return new Response('Too large', { status: 413 });
    try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  }
  const out = await app.handle({
    method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams),
    headers: Object.fromEntries(request.headers), body,
    ip: (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  });
  return new Response(JSON.stringify(out.json), {
    status: out.status, headers: { 'content-type': out.type || 'application/json', 'cache-control': 'no-store' }
  });
}
export const GET = run;
export const POST = run;
`);

// 5. The one package the backend needs that the family site did not have.
const pkgFile = path.join(site, 'package.json');
const pkg = JSON.parse(read(pkgFile));
const want = JSON.parse(read(path.join(root, 'package.json'))).dependencies['web-push'];
if (pkg.dependencies['web-push'] !== want) {
  pkg.dependencies['web-push'] = want;
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  console.log('added web-push to the family site package.json');
}
console.log('Low Supply synced into', site);
