// The small backend. One function, handle(req), used by the local server (server.mjs)
// and by the deployed function (api/[route].js), so both behave the same.
//
//   GET  /api/config    public key for notifications, and whether setup needs a code
//   POST /api/create    start a family on this device
//   POST /api/join      link this device with a code
//   GET  /api/state     what this device may see
//   POST /api/op        one change (see applyOp in core.js)
//   GET  /api/manifest  the home screen manifest, carrying a link code through install
//   GET  /api/tick      the clock: reminders and check in nudges (needs CRON_SECRET)
//   GET  /api/health

import { timingSafeEqual } from 'node:crypto';
import { Conflict } from './store.js';
import {
  AppError, newFamily, parseToken, authDevice, view, applyOp, joinFamily, tick,
  recipients, openCount, normalizeCode, sha
} from './core.js';

const famKey = fid => `f/${fid}`;
const inviteKey = hash => `i/${hash.slice(0, 40)}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const same = (a, b) => { const x = Buffer.from(sha(a)), y = Buffer.from(sha(b)); return timingSafeEqual(x, y); };

// `base` is the path the app is served under: '' on its own address, '/low-supply' on
// the family site. Settings may carry a LOW_SUPPLY_ prefix so they cannot collide with
// another app's on a shared host.
export function makeApp({ store, push, env = process.env, now = () => Date.now(), base = '' }) {
  const setupCode = env.LOW_SUPPLY_SETUP_CODE || env.SETUP_CODE || '';
  // Starting a family is open unless a setup code is set, and then it needs the code.
  // There is no "one family per site" rule: it kept locking the owner out whenever an
  // old family was left behind by a reset or a test. Families cannot see each other.
  // Wrong guesses per address. Memory only, which is enough to slow a guesser down:
  // a code is 8 characters from 31 and dies in 30 minutes.
  const strikes = new Map();
  function limited(ip, max, windowMs) {
    const t = now();
    const list = (strikes.get(ip) || []).filter(x => t - x < windowMs);
    strikes.set(ip, list);
    if (strikes.size > 5000) strikes.clear();
    return { blocked: list.length >= max, strike: () => list.push(t) };
  }

  async function update(fid, change) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const found = await store.get(famKey(fid));
      if (!found) throw new AppError(401, 'This device is not linked.');
      const family = found.value;
      const out = change(family);
      family.rev += 1;
      try { await store.put(famKey(fid), family, found.etag); return { family, out }; }
      catch (e) { if (!(e instanceof Conflict)) throw e; await sleep(40 + Math.random() * 120 * (attempt + 1)); }
    }
    throw new AppError(503, 'Could not save. Try again.');
  }

  async function deliver(family, notify) {
    if (!notify?.length || !push.enabled) return { sent: 0, failed: 0 };
    const badge = openCount(family, now());
    const jobs = [];
    for (const n of notify) {
      for (const d of recipients(family, n)) {
        jobs.push(push.send(d.push, { ...n.payload, badge }).then(r => ({ r, id: d.id })));
      }
    }
    const done = await Promise.all(jobs);
    const gone = done.filter(x => x.r.gone).map(x => x.id);
    if (gone.length) {
      await update(family.id, f => { for (const d of f.devices) if (gone.includes(d.id)) d.push = null; }).catch(() => {});
    }
    return { sent: done.filter(x => x.r.ok).length, failed: done.filter(x => !x.r.ok).length };
  }

  async function withDevice(req) {
    const t = parseToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    if (!t) throw new AppError(401, 'This device is not linked.');
    return t;
  }

  async function runTick(fid) {
    const { family, out } = await update(fid, f => tick(f, now()));
    await deliver(family, out.notify);
  }

  const routes = {
    'GET config': async () => ({ vapidPublicKey: push.publicKey, pushReady: push.enabled, setupCode: !!setupCode, createLocked: false }),

    'GET health': async () => ({ app: 'ok', push: push.enabled }),

    'GET manifest': async req => {
      const code = normalizeCode(req.query.join);
      return {
        __type: 'application/manifest+json',
        name: 'Low Supply', short_name: 'Low Supply',
        description: 'Tell your parents when diabetes supplies are running low.',
        start_url: `${base || '/'}${code ? `?join=${code}` : ''}`, scope: base || '/', display: 'standalone',
        background_color: '#F0EEE9', theme_color: '#F0EEE9',
        icons: [
          { src: base + '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: base + '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      };
    },

    'POST create': async req => {
      const gate = limited('create:' + req.ip, 6, 3600e3);
      if (gate.blocked) throw new AppError(429, 'Too many tries. Wait an hour and try again.');
      if (setupCode && !same(String(req.body.setupCode || '').trim(), setupCode)) {
        gate.strike();
        throw new AppError(403, 'That setup code is not right.');
      }
      gate.strike();
      const t = now();
      const { family, token, device } = newFamily({ name: req.body.name, tz: req.body.tz, label: req.body.label, now: t });
      await store.put(famKey(family.id), family, null);
      return { token, state: view(family, device, t) };
    },

    'POST join': async req => {
      const gate = limited('join:' + req.ip, 10, 600e3);
      if (gate.blocked) throw new AppError(429, 'Too many tries. Wait ten minutes and try again.');
      const code = normalizeCode(req.body.code);
      const pointer = code.length === 8 ? await store.get(inviteKey(sha(code))) : null;
      if (!pointer) { gate.strike(); throw new AppError(404, 'That code did not work. Ask for a new one.'); }
      const t = now();
      try {
        const { family, out } = await update(pointer.value.fid, f => joinFamily(f, code, req.body.label, t));
        await store.del(inviteKey(sha(code)));
        const device = family.devices.find(d => d.id === out.device.id);
        return { token: out.token, state: view(family, device, t) };
      } catch (e) {
        if (e.status === 404 || e.status === 401) gate.strike();
        throw e;
      }
    },

    'GET state': async req => {
      const { fid, did, secret } = await withDevice(req);
      const found = await store.get(famKey(fid));
      const t = now();
      const device = authDevice(found?.value, did, secret);
      let family = found.value;
      // Reading is also when the clock gets looked at, so a reminder does not depend
      // on a scheduler being awake. Only write when something is actually due.
      const peek = tick(structuredClone(family), t);
      if (peek.changed || t - device.seenAt > 3600e3) {
        const saved = await update(fid, f => {
          authDevice(f, did, secret).seenAt = t;
          return tick(f, t);
        });
        family = saved.family;
        await deliver(family, saved.out.notify);
      }
      return { state: view(family, family.devices.find(d => d.id === did), t) };
    },

    'POST op': async req => {
      const { fid, did, secret } = await withDevice(req);
      const t = now();
      if (req.body.type === 'deleteFamily') {
        // Everything the family saved goes: people, devices, requests, unused codes.
        // Every other device finds out the next time it asks and lands on the welcome screen.
        const found = await store.get(famKey(fid));
        const device = authDevice(found?.value, did, secret);
        if (found.value.members.find(m => m.id === device.memberId)?.role !== 'parent') throw new AppError(403, 'Only a parent can do that.');
        for (const i of found.value.invites) await store.del(inviteKey(i.hash));
        await store.del(famKey(fid));
        return { result: { deleted: true }, state: null };
      }
      const { family, out } = await update(fid, f => applyOp(f, authDevice(f, did, secret), req.body, t));
      let result = out.result;
      if (req.body.type === 'invite') {
        await store.put(inviteKey(result.hash), { fid, exp: result.exp }, null).catch(() => {});
        result = { code: result.code, exp: result.exp };
      }
      const tally = await deliver(family, out.notify);
      if (req.body.type === 'testPush' && !tally.sent) throw new AppError(502, 'The test could not be sent. Turn notifications off and on again on this device, then retry.');
      const mine = family.devices.find(d => d.id === did);
      return { result, state: mine ? view(family, mine, t) : null };
    },

    'GET tick': async req => {
      const secret = env.CRON_SECRET;
      if (!secret || !same((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), secret)) throw new AppError(401, 'Not allowed.');
      return tickAll();
    }
  };

  async function tickAll() {
    const keys = await store.list('f/');
    let families = 0;
    for (const key of keys) {
      try { await runTick(key.slice(2)); families++; } catch { /* one bad file should not stop the rest */ }
    }
    // Sweep link codes nobody used.
    const t = now();
    for (const key of await store.list('i/')) {
      const p = await store.get(key).catch(() => null);
      if (p && p.value.exp < t) await store.del(key);
    }
    return { families };
  }

  async function handle(req) {
    const name = req.path.replace(/\/+$/, '').split('/').pop();
    const route = routes[`${req.method} ${name}`];
    if (!route) return { status: 404, json: { error: 'Not found.' } };
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const json = await route({ ...req, body, query: req.query || {}, headers: req.headers || {}, ip: req.ip || 'local' });
      if (json.__type) { const { __type, ...rest } = json; return { status: 200, json: rest, type: __type }; }
      return { status: 200, json };
    } catch (e) {
      if (e instanceof AppError) return { status: e.status, json: { error: e.message } };
      console.error('low-supply error:', e?.message || e);
      return { status: 500, json: { error: 'Something went wrong. Try again.' } };
    }
  }

  return { handle, tickAll };
}
