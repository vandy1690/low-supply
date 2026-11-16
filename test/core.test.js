import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { makeApp } from '../lib/http.js';
import { fileStore } from '../lib/store.js';
import { inQuietHours } from '../lib/core.js';

const HOUR = 3600e3, DAY = 864e5;
// Wednesday 2026-11-11 18:00 UTC = 12:00 noon in Chicago.
const NOON = Date.UTC(2026, 10, 11, 18, 0, 0);

async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'low-supply-'));
  const sent = [];
  const clock = { t: NOON };
  const push = { enabled: true, publicKey: 'k', async send(sub, payload) { sent.push({ to: sub.endpoint, ...payload }); return { ok: !sub.endpoint.includes('dead'), gone: sub.endpoint.includes('dead') }; } };
  const app = makeApp({ store: fileStore(dir), push, env: {}, now: () => clock.t });
  const call = async (method, name, body, token, query) => {
    const out = await app.handle({ method, path: '/api/' + name, body, query, headers: token ? { authorization: 'Bearer ' + token } : {}, ip: 'test' });
    return out;
  };
  const op = async (token, body) => { const o = await call('POST', 'op', body, token); assert.equal(o.status, 200, JSON.stringify(o.json)); return o.json; };
  const sub = name => ({ endpoint: `https://web.push.apple.com/${name}`, keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(20) } });

  // Dad starts the family, invites Mom, adds a child with two supplies, links the child.
  const dad = (await call('POST', 'create', { name: 'Dad', tz: 'America/Chicago', label: 'iPhone' })).json;
  await op(dad.token, { type: 'subscribe', subscription: sub('dad') });
  const momId = (await op(dad.token, { type: 'addParent', name: 'Mom' })).result.id;
  const momCode = (await op(dad.token, { type: 'invite', memberId: momId })).result.code;
  const mom = (await call('POST', 'join', { code: momCode, label: 'iPhone' })).json;
  await op(mom.token, { type: 'subscribe', subscription: sub('mom') });
  const kidId = (await op(dad.token, { type: 'addChild', name: 'Kid 1' })).result.id;
  await op(dad.token, { type: 'updateMember', id: kidId, supplies: [{ itemId: 'sensor', on: true, everyDays: 7 }, { itemId: 'insulin', on: true, everyDays: 0 }, { itemId: 'strips', on: false, everyDays: 7 }] });
  const kidCode = (await op(dad.token, { type: 'invite', memberId: kidId })).result.code;
  const kid = (await call('POST', 'join', { code: kidCode.toLowerCase().replace(/(.{4})/, '$1-'), label: 'iPad' })).json;
  await op(kid.token, { type: 'subscribe', subscription: sub('kid') });
  const state = async token => (await call('GET', 'state', null, token)).json.state;
  return { call, op, sent, clock, dad, mom, kid, kidId, momId, state, sub, kidCode };
}

test('a child request reaches both parents, and ordering clears it for both and tells the child', async () => {
  const s = await setup();
  assert.equal(s.kid.state.role, 'child');
  assert.deepEqual(s.kid.state.supplies.map(x => x.itemId), ['sensor', 'insulin']);

  await s.op(s.kid.token, { type: 'request', itemId: 'sensor', level: 'low' });
  assert.deepEqual(s.sent.map(x => x.to.split('/').pop()).sort(), ['dad', 'mom']);
  assert.equal(s.sent[0].title, 'Kid 1: Running low');
  assert.equal(s.sent[0].body, 'Sensor');
  assert.equal((await s.state(s.mom.token)).requests.length, 1);

  // Repeat taps combine: same level does nothing, a new level updates the one request.
  s.sent.length = 0;
  await s.op(s.kid.token, { type: 'request', itemId: 'sensor', level: 'low' });
  assert.equal(s.sent.length, 0);
  await s.op(s.kid.token, { type: 'request', itemId: 'sensor', level: 'out' });
  const dadView = await s.state(s.dad.token);
  assert.equal(dadView.requests.length, 1);
  assert.equal(dadView.requests[0].level, 'out');
  assert.equal(s.sent[0].title, 'Changed. Kid 1: I am out');

  s.sent.length = 0;
  await s.op(s.mom.token, { type: 'order', requestId: dadView.requests[0].id });
  assert.equal((await s.state(s.dad.token)).requests.length, 0);
  assert.equal((await s.state(s.mom.token)).requests.length, 0);
  const to = Object.fromEntries(s.sent.map(x => [x.to.split('/').pop(), x.title]));
  assert.equal(to.dad, 'Ordered: Sensor for Kid 1');
  assert.equal(to.kid, 'Mom ordered your Sensor');
  assert.equal(to.mom, undefined, 'the parent who tapped is not notified');
  const kidView = await s.state(s.kid.token);
  assert.equal(kidView.notes[0].by, 'Mom');
  assert.equal(kidView.supplies[0].open, null);
  await s.op(s.kid.token, { type: 'seenNote', requestId: kidView.notes[0].requestId });
  assert.equal((await s.state(s.kid.token)).notes.length, 0);
});

test('a child cancel tells both parents', async () => {
  const s = await setup();
  await s.op(s.kid.token, { type: 'request', itemId: 'insulin', level: 'out' });
  s.sent.length = 0;
  await s.op(s.kid.token, { type: 'cancel', itemId: 'insulin' });
  assert.equal(s.sent.length, 2);
  assert.equal(s.sent[0].title, 'Kid 1 canceled a request');
  assert.equal((await s.state(s.dad.token)).requests.length, 0);
});

test('an unanswered request sends a reminder after the set time', async () => {
  const s = await setup();
  await s.op(s.dad.token, { type: 'setReminder', hours: 2 });
  await s.op(s.kid.token, { type: 'request', itemId: 'sensor', level: 'low' });
  s.sent.length = 0;
  s.clock.t += 1 * HOUR; await s.state(s.dad.token);
  assert.equal(s.sent.length, 0);
  s.clock.t += 1.1 * HOUR; await s.state(s.dad.token);
  assert.equal(s.sent.length, 2);
  assert.match(s.sent[0].title, /^Still waiting\. Kid 1: Running low/);
  s.sent.length = 0;
  s.clock.t += 0.5 * HOUR; await s.state(s.mom.token);
  assert.equal(s.sent.length, 0, 'no second reminder until the time passes again');
});

test('check ins follow the schedule and wait out quiet hours', async () => {
  const s = await setup();
  assert.deepEqual((await s.state(s.kid.token)).due, []);
  s.clock.t += 7 * DAY + HOUR; // a week on, 1 pm
  s.sent.length = 0;
  assert.deepEqual((await s.state(s.kid.token)).due, ['sensor']);
  assert.equal(s.sent.filter(x => x.kind === 'checkin').length, 1);
  assert.equal(s.sent[0].body, 'Are you running low on anything?');
  await s.op(s.kid.token, { type: 'checkinDone' });
  assert.deepEqual((await s.state(s.kid.token)).due, []);

  // Next week it lands at 9 pm, inside bedtime (8 pm to 7 am): held until morning.
  s.clock.t += 7 * DAY + 8 * HOUR;
  s.sent.length = 0;
  assert.deepEqual((await s.state(s.kid.token)).due, []);
  assert.equal(s.sent.length, 0);
  s.clock.t += 11 * HOUR; // 8 am
  assert.deepEqual((await s.state(s.kid.token)).due, ['sensor']);
  assert.equal(s.sent.length, 1);
});

test('quiet hours handle a window that runs past midnight', () => {
  const m = { quiet: [{ on: true, start: '20:00', end: '07:00', days: [3] }] }; // Wednesday nights only
  const at = h => NOON + (h - 12) * HOUR;
  assert.equal(inQuietHours(m, at(12), 'America/Chicago'), false);
  assert.equal(inQuietHours(m, at(21), 'America/Chicago'), true);
  assert.equal(inQuietHours(m, at(24 + 6), 'America/Chicago'), true, 'Thursday 6 am is the tail of Wednesday night');
  assert.equal(inQuietHours(m, at(24 + 21), 'America/Chicago'), false, 'Thursday night is not on');
});

test('codes work once, a removed device is locked out, and roles are enforced', async () => {
  const s = await setup();
  assert.equal((await s.call('POST', 'join', { code: s.kidCode })).status, 404, 'a used code is dead');
  assert.equal((await s.call('POST', 'op', { type: 'order', requestId: 'x' }, s.kid.token)).status, 403);
  assert.equal((await s.call('POST', 'op', { type: 'request', itemId: 'sensor', level: 'low' }, s.dad.token)).status, 403);
  assert.equal((await s.call('POST', 'op', { type: 'request', itemId: 'strips', level: 'low' }, s.kid.token)).status, 400, 'a supply that is off cannot be requested');
  assert.equal((await s.call('GET', 'state', null, s.kid.token.slice(0, -2) + 'zz')).status, 401);

  const view = await s.state(s.dad.token);
  const kidDevice = view.members.find(m => m.id === s.kidId).devices[0];
  await s.op(s.dad.token, { type: 'removeDevice', id: kidDevice.id });
  assert.equal((await s.call('GET', 'state', null, s.kid.token)).status, 401);
  // Relink with a fresh code.
  const code = (await s.op(s.dad.token, { type: 'invite', memberId: s.kidId })).result.code;
  assert.equal((await s.call('POST', 'join', { code })).status, 200);
  // A code past its time is refused.
  const late = (await s.op(s.dad.token, { type: 'invite', memberId: s.kidId })).result.code;
  s.clock.t += 31 * 60e3;
  assert.equal((await s.call('POST', 'join', { code: late })).status, 404);
});

test('nothing private leaves the server, and push addresses must be real push services', async () => {
  const s = await setup();
  const text = JSON.stringify(await s.state(s.dad.token)) + JSON.stringify(await s.state(s.kid.token));
  assert.ok(!/hash|endpoint|p256dh|invites/.test(text));
  const bad = await s.call('POST', 'op', { type: 'subscribe', subscription: { endpoint: 'https://example.com/hook', keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(20) } } }, s.dad.token);
  assert.equal(bad.status, 400);
  assert.equal((await s.call('POST', 'op', { type: 'addChild', name: '   ' }, s.dad.token)).status, 400);
});

test('a dead push address is dropped, and turning a supply off closes its request quietly', async () => {
  const s = await setup();
  await s.op(s.mom.token, { type: 'subscribe', subscription: s.sub('dead-mom') });
  await s.op(s.kid.token, { type: 'request', itemId: 'sensor', level: 'low' });
  const mom = (await s.state(s.dad.token)).members.find(m => m.id === s.momId);
  assert.equal(mom.devices[0].push, false);
  await s.op(s.dad.token, { type: 'updateMember', id: s.kidId, supplies: [{ itemId: 'insulin', on: true, everyDays: 0 }] });
  assert.equal((await s.state(s.dad.token)).requests.length, 0);
});

test('the setup code, when set, guards creating a family', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'low-supply-'));
  const app = makeApp({ store: fileStore(dir), push: { enabled: false }, env: { SETUP_CODE: 'open-sesame' } });
  const create = body => app.handle({ method: 'POST', path: '/api/create', body, headers: {}, ip: 't' });
  assert.equal((await create({ name: 'Dad' })).status, 403);
  assert.equal((await create({ name: 'Dad', setupCode: 'open-sesame' })).status, 200);
});

test('reset: a device can unlink itself, the last parent device cannot, and deleting the family locks everyone out', async () => {
  const s = await setup();
  assert.equal((await s.call('POST', 'op', { type: 'deleteFamily' }, s.kid.token)).status, 403, 'a child cannot delete the family');
  // The child device walks away; the family carries on.
  const left = await s.op(s.kid.token, { type: 'unlinkSelf' });
  assert.equal(left.state, null);
  assert.equal((await s.call('GET', 'state', null, s.kid.token)).status, 401);
  assert.equal((await s.state(s.dad.token)).members.find(m => m.id === s.kidId).devices.length, 0);
  // Mom leaves, then Dad is the only parent device and is told to delete instead.
  await s.op(s.mom.token, { type: 'unlinkSelf' });
  const stuck = await s.call('POST', 'op', { type: 'unlinkSelf' }, s.dad.token);
  assert.equal(stuck.status, 400);
  assert.match(stuck.json.error, /only parent device/);
  // Delete: gone for everyone, and an unused code stops working too.
  const code = (await s.op(s.dad.token, { type: 'invite', memberId: s.kidId })).result.code;
  assert.equal((await s.call('POST', 'op', { type: 'deleteFamily' }, s.dad.token)).status, 200);
  assert.equal((await s.call('GET', 'state', null, s.dad.token)).status, 401);
  assert.equal((await s.call('POST', 'join', { code })).status, 404);
});

test('on a public host, a second family can be started, and a setup code gates it when one is set', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'low-supply-'));
  const open = makeApp({ store: fileStore(dir), push: { enabled: false }, env: { VERCEL: '1' } });
  const call = (app, name, body) => app.handle({ method: name === 'config' ? 'GET' : 'POST', path: '/api/low-supply/' + name, body, headers: {}, ip: 't' });
  assert.equal((await call(open, 'create', { name: 'Dad' })).status, 200);
  assert.equal((await call(open, 'config')).json.createLocked, false);
  assert.equal((await call(open, 'create', { name: 'Demo' })).status, 200);
  const gated = makeApp({ store: fileStore(dir), push: { enabled: false }, env: { VERCEL: '1', LOW_SUPPLY_SETUP_CODE: 'abc' } });
  assert.equal((await call(gated, 'create', { name: 'Stranger' })).status, 403);
  assert.equal((await call(gated, 'create', { name: 'Dad', setupCode: 'abc' })).status, 200);
});

test('ordered but not ready until a date: the child is told, reminders pause, and parents get a follow up on the day', async () => {
  const s = await setup();
  await s.op(s.kid.token, { type: 'request', itemId: 'sensor', level: 'low' });
  const id = (await s.state(s.dad.token)).requests[0].id;

  // Only a parent can do it, and only with a real date that is not in the past.
  assert.equal((await s.call('POST', 'op', { type: 'delay', requestId: id, readyOn: '2026-11-15' }, s.kid.token)).status, 403);
  for (const bad of ['2026-11-10', '2026-02-31', 'soon', '2028-01-01']) {
    assert.equal((await s.call('POST', 'op', { type: 'delay', requestId: id, readyOn: bad }, s.dad.token)).status, 400, bad);
  }

  s.sent.length = 0;
  await s.op(s.dad.token, { type: 'delay', requestId: id, readyOn: '2026-11-15' });
  // The other parent and the child hear about it. The parent who did it does not.
  assert.deepEqual(s.sent.map(m => m.to.split('/').pop()).sort(), ['kid', 'mom']);
  assert.equal(s.sent.find(m => m.to.endsWith('kid')).body, 'It is not ready yet. 4 more sleeps.');

  let dad = await s.state(s.dad.token);
  assert.equal(dad.requests.length, 0, 'it leaves the needs-action list');
  assert.equal(dad.waiting.length, 1);
  assert.deepEqual(dad.waiting[0].wait, { readyOn: '2026-11-15', sleeps: 4, by: 'Dad' });

  let kid = await s.state(s.kid.token);
  // The child gets the countdown and never the date.
  assert.deepEqual(kid.notes, [{ requestId: id, kind: 'wait', label: 'Sensor', sleeps: 4, by: 'Dad' }]);
  assert.deepEqual(kid.supplies.find(x => x.itemId === 'sensor').wait, { sleeps: 4, by: 'Dad' });
  assert.equal(kid.supplies.find(x => x.itemId === 'sensor').wait.sleeps, 4);
  await s.op(s.kid.token, { type: 'seenNote', requestId: id });
  kid = await s.state(s.kid.token);
  assert.equal(kid.notes.length, 0);
  assert.equal(kid.supplies.find(x => x.itemId === 'sensor').wait.sleeps, 4, 'the countdown stays after OK');

  // Two days on: no "still waiting" reminders, and one fewer sleep.
  s.sent.length = 0;
  s.clock.t += 2 * DAY;
  kid = await s.state(s.kid.token);
  assert.equal(kid.supplies.find(x => x.itemId === 'sensor').wait.sleeps, 2);
  assert.equal(s.sent.length, 0);

  // The child can still say it got worse, and the parents hear the date with it.
  await s.op(s.kid.token, { type: 'request', itemId: 'sensor', level: 'out' });
  assert.equal(s.sent.filter(m => /^Changed\. Kid 1: I am out/.test(m.title) && /not ready until Sun, Nov 15/.test(m.body)).length, 2);
  assert.equal((await s.state(s.dad.token)).waiting[0].level, 'out');

  // The day comes: one follow up to each parent, once that day, and again the next day.
  s.sent.length = 0;
  s.clock.t += 2 * DAY;
  await s.state(s.dad.token);
  await s.state(s.mom.token);
  assert.equal(s.sent.filter(m => /^Follow up: Sensor for Kid 1/.test(m.title) && /due to be ready today.*pharmacy/.test(m.body)).length, 2);
  assert.equal(s.sent.length, 2);
  s.clock.t += DAY;
  await s.state(s.dad.token);
  assert.equal(s.sent.filter(m => /due to be ready on Sun, Nov 15/.test(m.body)).length, 2);
  assert.equal((await s.state(s.kid.token)).supplies.find(x => x.itemId === 'sensor').wait.sleeps, -1);

  // A new date starts the wait over and tells the child again.
  await s.op(s.mom.token, { type: 'delay', requestId: id, readyOn: '2026-11-20' });
  kid = await s.state(s.kid.token);
  assert.equal(kid.notes[0].by, 'Mom');
  assert.equal(kid.notes[0].sleeps, 4);

  // Marking it closes it as ready, not as ordered.
  s.sent.length = 0;
  await s.op(s.dad.token, { type: 'order', requestId: id });
  assert.match(s.sent.find(m => m.to.endsWith('kid')).title, /Your Sensor is ready/);
  kid = await s.state(s.kid.token);
  assert.deepEqual(kid.notes, [{ requestId: id, kind: 'ready', label: 'Sensor', by: 'Dad' }]);
  assert.equal(kid.supplies.find(x => x.itemId === 'sensor').wait, null);
  dad = await s.state(s.dad.token);
  assert.equal(dad.waiting.length, 0);
  assert.equal(dad.recent.length, 1);
});
