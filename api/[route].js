// The deployed backend: one function for every /api/<name> address, so the app
// costs a single function wherever it is hosted.
import { makeApp } from '../lib/http.js';
import { defaultStore } from '../lib/store.js';
import { makePush } from '../lib/push.js';

let app;
export default async function handler(req, res) {
  app ??= makeApp({ store: await defaultStore(), push: makePush() });
  const url = new URL(req.url, 'http://x');
  const out = await app.handle({
    method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams),
    headers: req.headers, body: req.body,
    ip: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown'
  });
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', out.type || 'application/json');
  res.status(out.status).send(JSON.stringify(out.json));
}
