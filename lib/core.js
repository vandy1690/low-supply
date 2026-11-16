// The rules of Low Supply, with no storage and no network in them, so they can be tested.
// A family is one plain object. Every function here reads it or edits it in place and
// hands back who should be told. Sending is somebody else's job (lib/http.js).
//
// Nothing personal is kept: people are nicknames, devices are a random id and a hash.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BUILT_IN, ICON_CHOICES, LEVELS, CHECK_IN_DAYS, REMINDER_HOURS } from '../public/js/catalog.js';

const HOUR = 3600e3;
const DAY = 864e5;

export const LIMITS = {
  name: 24, children: 8, parents: 4, customItems: 30, devices: 24,
  inviteMinutes: 30, invitesPerMember: 3, maxReminders: 6, keepClosedDays: 60, reopenHours: 24,
  maxWaitDays: 366, maxFollowUps: 5
};

export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = msg => new AppError(400, msg);

const newId = (bytes = 9) => randomBytes(bytes).toString('base64url');
export const sha = s => createHash('sha256').update(String(s)).digest('hex');

// Codes a person may have to type: no I, L, O, 0 or 1.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function makeCode() {
  let out = '';
  while (out.length < 8) {
    const b = randomBytes(1)[0];
    if (b < 248) out += CODE_ALPHABET[b % 31]; // 248 = 31 * 8, so no letter is favored
  }
  return out;
}
export const normalizeCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);

export function cleanName(value, what = 'a nickname') {
  const s = String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.name);
  if (!s) throw bad(`Type ${what}.`);
  return s;
}

function validTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'America/Chicago'; }
}

const defaultQuiet = () => [
  { id: 'school', label: 'School', on: false, start: '08:00', end: '15:00', days: [1, 2, 3, 4, 5] },
  { id: 'bed', label: 'Bedtime', on: true, start: '20:00', end: '07:00', days: [0, 1, 2, 3, 4, 5, 6] }
];

function newMember(role, name) {
  const m = { id: newId(6), role, name };
  if (role === 'child') Object.assign(m, { readAloud: true, supplies: [], quiet: defaultQuiet(), checkinNotifiedAt: 0 });
  return m;
}

function newDevice(family, memberId, label, now) {
  if (family.devices.length >= LIMITS.devices) throw bad('This family has too many linked devices. Remove one in Settings first.');
  const secret = newId(32);
  const device = {
    id: newId(6), memberId, hash: sha(secret), createdAt: now, seenAt: now, push: null,
    label: String(label || 'Device').replace(/[^\w .-]/g, '').slice(0, 24) || 'Device'
  };
  family.devices.push(device);
  return { device, token: `${family.id}.${device.id}.${secret}` };
}

export function newFamily({ name, tz, label, now }) {
  const family = {
    v: 1, id: newId(12), rev: 0, createdAt: now, tz: validTz(tz), reminderHours: 4,
    members: [], customItems: [], devices: [], invites: [], requests: []
  };
  const parent = newMember('parent', cleanName(name));
  family.members.push(parent);
  const { token, device } = newDevice(family, parent.id, label, now);
  return { family, token, device };
}

export function parseToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]{6,64}$/.test(p))) return null;
  return { fid: parts[0], did: parts[1], secret: parts[2] };
}

export function authDevice(family, did, secret) {
  const device = family?.devices.find(d => d.id === did);
  const a = Buffer.from(sha(secret));
  const b = Buffer.from(device ? device.hash : sha('nobody'));
  if (!timingSafeEqual(a, b) || !device) throw new AppError(401, 'This device is not linked.');
  return device;
}

const memberOf = (family, id) => family.members.find(m => m.id === id);
const parents = family => family.members.filter(m => m.role === 'parent');

export function allItems(family) { return [...BUILT_IN, ...family.customItems]; }
function itemOf(family, itemId) { return allItems(family).find(i => i.id === itemId); }
const itemLabel = (family, itemId) => itemOf(family, itemId)?.label || 'Supply';
const openFor = (family, childId, itemId) =>
  family.requests.find(r => r.status === 'open' && r.childId === childId && r.itemId === itemId);

// ---------- quiet hours ----------

function localClock(now, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(now));
  const get = t => parts.find(p => p.type === t)?.value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}
const toMinutes = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function inQuietHours(member, now, tz) {
  const { day, minutes } = localClock(now, tz);
  const yesterday = (day + 6) % 7;
  return (member.quiet || []).some(q => {
    if (!q.on) return false;
    const start = toMinutes(q.start), end = toMinutes(q.end);
    if (start === end) return false;
    if (start < end) return q.days.includes(day) && minutes >= start && minutes < end;
    // Runs past midnight: tonight's part, or the tail of last night's.
    return (q.days.includes(day) && minutes >= start) || (q.days.includes(yesterday) && minutes < end);
  });
}

// ---------- dates ----------
// A "not ready until" day is a calendar day in the family's own time zone, kept as
// YYYY-MM-DD so it means the same day on every phone.

export function localDate(now, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}
const dayNumber = ymd => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / DAY;
// How many days are left before that day. Zero is today, below zero is late.
export const sleepsUntil = (ymd, now, tz) => dayNumber(ymd) - dayNumber(localDate(now, tz));
const sayDay = ymd => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(dayNumber(ymd) * DAY));

function cleanReadyOn(value, now, tz) {
  const ymd = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || localDate(dayNumber(ymd) * DAY + DAY / 2, 'UTC') !== ymd) throw bad('Pick the date it should be ready.');
  const sleeps = sleepsUntil(ymd, now, tz);
  if (sleeps < 0) throw bad('Pick today or a later date.');
  if (sleeps > LIMITS.maxWaitDays) throw bad('That date is more than a year away. Pick a closer one.');
  return ymd;
}

// ---------- check ins ----------

export function dueItems(family, member, now) {
  if (member.role !== 'child' || inQuietHours(member, now, family.tz)) return [];
  return member.supplies
    .filter(s => s.on && s.everyDays > 0 && now - s.lastAskedAt >= s.everyDays * DAY && !openFor(family, member.id, s.itemId))
    .map(s => s.itemId);
}

// ---------- what a device is allowed to see ----------

export function view(family, device, now) {
  const me = memberOf(family, device.memberId);
  const waitView = r => ({ readyOn: r.wait.readyOn, sleeps: sleepsUntil(r.wait.readyOn, now, family.tz), by: memberOf(family, r.wait.by)?.name || 'A parent' });
  // A child gets the countdown and not the date: days left are easier to hold than a day on a calendar.
  const countdown = r => { const { sleeps, by } = waitView(r); return { sleeps, by }; };
  const base = { rev: family.rev, role: me.role, deviceId: device.id, push: !!device.push };
  if (me.role === 'child') {
    const supplies = allItems(family)
      .filter(i => me.supplies.some(s => s.itemId === i.id && s.on))
      .map(i => {
        const r = openFor(family, me.id, i.id);
        return { itemId: i.id, label: i.label, icon: i.icon, say: i.say || i.label, open: r?.level || null, wait: r?.wait ? countdown(r) : null };
      });
    // Two kinds of note: it is ordered (or ready), and it is ordered but not ready yet.
    const notes = family.requests
      .filter(r => r.childId === me.id && ((r.status === 'ordered' && !r.noteSeen) || (r.status === 'open' && r.wait && !r.wait.seen)))
      .map(r => (r.status === 'open'
        ? { requestId: r.id, kind: 'wait', label: itemLabel(family, r.itemId), ...countdown(r) }
        : { requestId: r.id, kind: r.wasWaiting ? 'ready' : 'ordered', label: itemLabel(family, r.itemId), by: memberOf(family, r.closedBy)?.name || 'A parent' }));
    return { ...base, me: { id: me.id, name: me.name, readAloud: me.readAloud }, supplies, notes, due: dueItems(family, me, now) };
  }
  const label = r => ({
    id: r.id, childId: r.childId, child: memberOf(family, r.childId)?.name || 'Child', itemId: r.itemId,
    item: itemLabel(family, r.itemId), icon: itemOf(family, r.itemId)?.icon || 'square', level: r.level,
    createdAt: r.createdAt, levelAt: r.levelAt, closedAt: r.closedAt || null,
    by: r.closedBy ? memberOf(family, r.closedBy)?.name || 'A parent' : null,
    wait: r.status === 'open' && r.wait ? waitView(r) : null
  });
  const byLevel = (a, b) => (a.level === b.level ? a.createdAt - b.createdAt : a.level === 'out' ? -1 : 1);
  const waiting = family.requests.filter(r => r.status === 'open' && r.wait)
    .sort((a, b) => (a.wait.readyOn === b.wait.readyOn ? byLevel(a, b) : a.wait.readyOn < b.wait.readyOn ? -1 : 1));
  const open = family.requests.filter(r => r.status === 'open' && !r.wait)
    .sort((a, b) => (a.level === b.level ? a.createdAt - b.createdAt : a.level === 'out' ? -1 : 1));
  const recent = family.requests.filter(r => r.status === 'ordered')
    .sort((a, b) => b.closedAt - a.closedAt).slice(0, 8);
  return {
    ...base,
    me: { id: me.id, name: me.name },
    tz: family.tz,
    reminderHours: family.reminderHours,
    members: family.members.map(m => ({
      id: m.id, role: m.role, name: m.name,
      ...(m.role === 'child' ? { readAloud: m.readAloud, quiet: m.quiet, supplies: m.supplies.map(s => ({ itemId: s.itemId, on: s.on, everyDays: s.everyDays })) } : {}),
      devices: family.devices.filter(d => d.memberId === m.id)
        .map(d => ({ id: d.id, label: d.label, createdAt: d.createdAt, seenAt: d.seenAt, push: !!d.push, current: d.id === device.id }))
    })),
    customItems: family.customItems,
    today: localDate(now, family.tz),
    requests: open.map(label),
    waiting: waiting.map(label),
    recent: recent.map(r => ({ ...label(r), canReopen: now - r.closedAt < LIMITS.reopenHours * HOUR && !openFor(family, r.childId, r.itemId) }))
  };
}

// ---------- messages ----------

const tagFor = r => `req-${r.id}`;
function alertPayload(family, r, prefix = '') {
  const child = memberOf(family, r.childId)?.name || 'Child';
  const body = itemLabel(family, r.itemId) + (r.wait ? `. Ordered, not ready until ${sayDay(r.wait.readyOn)}.` : '');
  return { title: `${prefix}${child}: ${LEVELS[r.level]}`, body, tag: tagFor(r), kind: 'request' };
}
const toParents = (family, payload, exceptDevice) => ({ members: parents(family).map(p => p.id), exceptDevice, payload });

// ---------- linking ----------

export function joinFamily(family, code, label, now) {
  const hash = sha(normalizeCode(code));
  const invite = family.invites.find(i => i.hash === hash && i.exp > now);
  if (!invite || !memberOf(family, invite.memberId)) throw new AppError(404, 'That code did not work. Ask for a new one.');
  family.invites = family.invites.filter(i => i !== invite);
  const { token, device } = newDevice(family, invite.memberId, label, now);
  return { token, device };
}

// ---------- everything a linked device can ask for ----------

const PARENT_OPS = new Set(['addChild', 'addParent', 'updateMember', 'removeMember', 'invite', 'removeDevice',
  'addItem', 'updateItem', 'removeItem', 'setReminder', 'order', 'delay', 'reopen', 'renameSelf']);
const CHILD_OPS = new Set(['request', 'cancel', 'checkinDone', 'seenNote']);

function cancelOpen(family, pred, now) {
  for (const r of family.requests) if (r.status === 'open' && pred(r)) { r.status = 'canceled'; r.closedAt = now; }
}

function cleanIcon(icon) {
  if (!ICON_CHOICES.some(c => c.icon === icon)) throw bad('Pick an icon from the list.');
  return icon;
}

export function applyOp(family, device, op, now) {
  const me = memberOf(family, device.memberId);
  const type = String(op?.type || '');
  if (PARENT_OPS.has(type) && me.role !== 'parent') throw new AppError(403, 'Only a parent can do that.');
  if (CHILD_OPS.has(type) && me.role !== 'child') throw new AppError(403, 'Only a child device can do that.');
  const notify = [];
  let result = null;

  switch (type) {
    // ----- child -----
    case 'request': {
      if (!LEVELS[op.level]) throw bad('Unknown choice.');
      const supply = me.supplies.find(s => s.itemId === op.itemId && s.on);
      if (!supply || !itemOf(family, op.itemId)) throw bad('That supply is not turned on.');
      supply.lastAskedAt = now;
      let r = openFor(family, me.id, op.itemId);
      if (!r) {
        r = { id: newId(6), childId: me.id, itemId: op.itemId, level: op.level, status: 'open', createdAt: now, levelAt: now, remindedAt: 0, reminders: 0 };
        family.requests.push(r);
        notify.push(toParents(family, alertPayload(family, r)));
      } else if (r.level !== op.level) {
        // Repeat taps on one supply stay one request. Only the level moves.
        Object.assign(r, { level: op.level, levelAt: now, remindedAt: 0, reminders: 0 });
        notify.push(toParents(family, alertPayload(family, r, 'Changed. ')));
      }
      break;
    }
    case 'cancel': {
      const r = openFor(family, me.id, op.itemId);
      if (r) {
        r.status = 'canceled'; r.closedAt = now;
        notify.push(toParents(family, { title: `${me.name} canceled a request`, body: `${itemLabel(family, r.itemId)}: not needed now.`, tag: tagFor(r), kind: 'canceled' }));
      }
      break;
    }
    case 'checkinDone': {
      for (const id of dueItems(family, me, now)) me.supplies.find(s => s.itemId === id).lastAskedAt = now;
      break;
    }
    case 'seenNote': {
      const r = family.requests.find(x => x.id === op.requestId && x.childId === me.id);
      if (r && r.status === 'open' && r.wait) r.wait.seen = true;
      else if (r) r.noteSeen = true;
      break;
    }

    // ----- parent: requests -----
    case 'order': {
      const r = family.requests.find(x => x.id === op.requestId && x.status === 'open');
      if (!r) break; // the other parent got there first, which is fine
      // A request that was waiting on a date closes as "ready", not as "ordered":
      // the child was already told it was ordered.
      const ready = !!r.wait;
      Object.assign(r, { status: 'ordered', closedAt: now, closedBy: me.id, noteSeen: false, wasWaiting: ready });
      delete r.wait;
      const item = itemLabel(family, r.itemId);
      const child = memberOf(family, r.childId);
      notify.push(toParents(family, { title: `${ready ? 'Ready' : 'Ordered'}: ${item} for ${child?.name}`, body: `Marked ${ready ? 'ready' : 'ordered'} by ${me.name}.`, tag: tagFor(r), kind: 'ordered' }, device.id));
      notify.push({ members: [r.childId], payload: ready
        ? { title: `Your ${item} is ready`, body: `${me.name} marked it ready.`, tag: tagFor(r), kind: 'note' }
        : { title: `${me.name} ordered your ${item}`, body: 'Your request is taken care of.', tag: tagFor(r), kind: 'note' } });
      break;
    }
    case 'delay': {
      // Ordered, but the pharmacy or the insurance plan will not fill it until a date.
      // The request stays open, so the child can still say it got worse, and the
      // hourly reminders stop: one follow up reminder comes on the date instead.
      const r = family.requests.find(x => x.id === op.requestId && x.status === 'open');
      if (!r) throw bad('That request is no longer on the list.');
      const readyOn = cleanReadyOn(op.readyOn, now, family.tz);
      const changed = !!r.wait;
      r.wait = { readyOn, by: me.id, at: now, seen: false, followedOn: null, followUps: 0 };
      const item = itemLabel(family, r.itemId);
      const child = memberOf(family, r.childId);
      notify.push(toParents(family, { title: `Ordered, not ready yet: ${item} for ${child?.name}`, body: `${me.name} ${changed ? 'changed the date. It' : 'ordered it. It'} will not be ready until ${sayDay(readyOn)}.`, tag: tagFor(r), kind: 'waiting' }, device.id));
      const sleeps = sleepsUntil(readyOn, now, family.tz);
      const count = sleeps > 1 ? `${sleeps} days until ready.` : sleeps === 1 ? '1 day until ready.' : 'It should be ready today.';
      notify.push({ members: [r.childId], payload: { title: `${me.name} ordered your ${item}`, body: count, tag: tagFor(r), kind: 'note' } });
      break;
    }
    case 'reopen': {
      const r = family.requests.find(x => x.id === op.requestId && x.status === 'ordered');
      if (!r || now - r.closedAt > LIMITS.reopenHours * HOUR || openFor(family, r.childId, r.itemId)) throw bad('That request can no longer be reopened.');
      Object.assign(r, { status: 'open', closedAt: null, closedBy: null, remindedAt: now, noteSeen: true, wasWaiting: false });
      notify.push(toParents(family, alertPayload(family, r, 'Reopened. '), device.id));
      break;
    }

    // ----- parent: people -----
    case 'addChild':
    case 'addParent': {
      const role = type === 'addChild' ? 'child' : 'parent';
      const count = family.members.filter(m => m.role === role).length;
      if (count >= (role === 'child' ? LIMITS.children : LIMITS.parents)) throw bad(`That is the most ${role === 'child' ? 'children' : 'parents'} one family can have.`);
      const m = newMember(role, cleanName(op.name));
      family.members.push(m);
      result = { id: m.id };
      break;
    }
    case 'renameSelf': { me.name = cleanName(op.name); break; }
    case 'updateMember': {
      const m = memberOf(family, op.id);
      if (!m) throw bad('That person is no longer in the family.');
      if (op.name !== undefined) m.name = cleanName(op.name);
      if (m.role !== 'child') break;
      if (op.readAloud !== undefined) m.readAloud = !!op.readAloud;
      if (Array.isArray(op.supplies)) {
        const next = [];
        for (const s of op.supplies) {
          if (!itemOf(family, s?.itemId) || next.some(n => n.itemId === s.itemId)) continue;
          const everyDays = CHECK_IN_DAYS.includes(Number(s.everyDays)) ? Number(s.everyDays) : 7;
          const old = m.supplies.find(x => x.itemId === s.itemId);
          // A check in clock starts when the supply is turned on, not at the dawn of time.
          const lastAskedAt = old && old.on ? old.lastAskedAt : now;
          next.push({ itemId: s.itemId, on: !!s.on, everyDays, lastAskedAt });
        }
        m.supplies = next;
        cancelOpen(family, r => r.childId === m.id && !next.some(s => s.itemId === r.itemId && s.on), now);
      }
      if (Array.isArray(op.quiet)) {
        for (const q of op.quiet) {
          const mine = m.quiet.find(x => x.id === q?.id);
          if (!mine) continue;
          const time = t => (/^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null);
          if (q.on !== undefined) mine.on = !!q.on;
          if (time(q.start)) mine.start = q.start;
          if (time(q.end)) mine.end = q.end;
          if (Array.isArray(q.days)) mine.days = [...new Set(q.days.map(Number).filter(d => d >= 0 && d <= 6))].sort();
        }
      }
      break;
    }
    case 'removeMember': {
      const m = memberOf(family, op.id);
      if (!m) break;
      if (m.id === me.id) throw bad('You cannot remove yourself.');
      family.members = family.members.filter(x => x !== m);
      family.devices = family.devices.filter(d => d.memberId !== m.id);
      family.invites = family.invites.filter(i => i.memberId !== m.id);
      family.requests = family.requests.filter(r => r.childId !== m.id);
      break;
    }

    // ----- parent: devices -----
    case 'invite': {
      if (!memberOf(family, op.memberId)) throw bad('That person is no longer in the family.');
      family.invites = family.invites.filter(i => i.exp > now);
      const mine = family.invites.filter(i => i.memberId === op.memberId);
      if (mine.length >= LIMITS.invitesPerMember) family.invites = family.invites.filter(i => i !== mine[0]);
      const code = makeCode();
      const exp = now + LIMITS.inviteMinutes * 60e3;
      family.invites.push({ hash: sha(code), memberId: op.memberId, exp });
      result = { code, exp, hash: sha(code) };
      break;
    }
    case 'removeDevice': {
      if (op.id === device.id) throw bad('You are using this device right now. Remove it from another parent device.');
      family.devices = family.devices.filter(d => d.id !== op.id);
      break;
    }

    // ----- parent: supplies and reminders -----
    case 'addItem': {
      if (family.customItems.length >= LIMITS.customItems) throw bad('That is the most custom supplies one family can have.');
      const item = { id: 'c_' + newId(5), label: cleanName(op.label, 'a name for the supply'), icon: cleanIcon(op.icon) };
      family.customItems.push(item);
      result = { id: item.id };
      break;
    }
    case 'updateItem': {
      const item = family.customItems.find(i => i.id === op.id);
      if (!item) throw bad('That supply is gone.');
      item.label = cleanName(op.label, 'a name for the supply');
      item.icon = cleanIcon(op.icon);
      break;
    }
    case 'removeItem': {
      family.customItems = family.customItems.filter(i => i.id !== op.id);
      for (const m of family.members) if (m.supplies) m.supplies = m.supplies.filter(s => s.itemId !== op.id);
      family.requests = family.requests.filter(r => r.itemId !== op.id);
      break;
    }
    case 'setReminder': {
      if (!REMINDER_HOURS.includes(Number(op.hours))) throw bad('Pick a time from the list.');
      family.reminderHours = Number(op.hours);
      break;
    }

    // ----- anyone -----
    case 'setReadAloud': {
      const m = me.role === 'child' ? me : memberOf(family, op.memberId);
      if (!m || m.role !== 'child') throw bad('That child is no longer in the family.');
      m.readAloud = !!op.on;
      break;
    }
    case 'subscribe': {
      device.push = cleanSubscription(op.subscription);
      break;
    }
    case 'unsubscribe': { device.push = null; break; }
    case 'unlinkSelf': {
      // The last parent device is the only way back in, so it cannot simply walk away.
      const parentIds = parents(family).map(p => p.id);
      const otherParentDevices = family.devices.filter(d => d.id !== device.id && parentIds.includes(d.memberId));
      if (me.role === 'parent' && !otherParentDevices.length) throw bad('This is the only parent device. Link another parent device first, or delete the family to start over.');
      family.devices = family.devices.filter(d => d.id !== device.id);
      result = { unlinked: true };
      break;
    }
    case 'testPush': {
      if (!device.push) throw bad('Notifications are not turned on for this device yet.');
      notify.push({ devices: [device.id], payload: { title: 'Low Supply is working', body: 'Notifications reach this device.', tag: 'test', kind: 'test' } });
      break;
    }
    default: throw bad('Unknown request.');
  }
  return { result, notify };
}

// A push address is a URL this server will post to, so only the real push services pass.
const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.notify\.windows\.com$/, /\.push\.services\.mozilla\.com$/];
export function cleanSubscription(sub) {
  let url;
  try { url = new URL(sub?.endpoint); } catch { throw bad('Notifications could not be turned on.'); }
  const keys = sub.keys || {};
  const ok = url.protocol === 'https:' && PUSH_HOSTS.some(h => h.test(url.hostname)) &&
    [keys.p256dh, keys.auth].every(k => typeof k === 'string' && /^[A-Za-z0-9_-]{16,200}$/.test(k)) &&
    sub.endpoint.length < 1000;
  if (!ok) throw bad('Notifications could not be turned on.');
  return { endpoint: sub.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

// ---------- the clock: reminders, check in nudges, housekeeping ----------

export function tick(family, now) {
  const notify = [];
  let changed = false;

  // Waiting on a date: one follow up a day from that date on, until a parent marks it
  // ready or sets a new date.
  const today = localDate(now, family.tz);
  for (const r of family.requests) {
    if (r.status !== 'open' || !r.wait || r.wait.readyOn > today) continue;
    if (r.wait.followedOn === today || r.wait.followUps >= LIMITS.maxFollowUps) continue;
    r.wait.followedOn = today; r.wait.followUps += 1; changed = true;
    const child = memberOf(family, r.childId)?.name || 'Child';
    const late = r.wait.readyOn < today;
    notify.push(toParents(family, {
      title: `Follow up: ${itemLabel(family, r.itemId)} for ${child}`,
      body: `It was due to be ready ${late ? `on ${sayDay(r.wait.readyOn)}` : 'today'}. Check with the pharmacy or the doctor's office, then mark it ready or set a new date.`,
      tag: tagFor(r), kind: 'followup'
    }));
  }

  for (const r of family.requests) {
    if (r.status !== 'open' || r.wait || r.reminders >= LIMITS.maxReminders) continue;
    const since = Math.max(r.levelAt, r.remindedAt || 0);
    if (now - since < family.reminderHours * HOUR) continue;
    r.remindedAt = now; r.reminders += 1; changed = true;
    const hours = Math.max(1, Math.round((now - r.createdAt) / HOUR));
    const p = alertPayload(family, r, 'Still waiting. ');
    p.body = `${p.body}. Asked ${hours} ${hours === 1 ? 'hour' : 'hours'} ago.`;
    p.kind = 'reminder';
    notify.push(toParents(family, p));
  }

  for (const m of family.members) {
    if (m.role !== 'child') continue;
    const due = dueItems(family, m, now);
    // One nudge a day at most while a check in sits unanswered.
    if (due.length && now - (m.checkinNotifiedAt || 0) >= DAY) {
      m.checkinNotifiedAt = now; changed = true;
      notify.push({ members: [m.id], payload: { title: 'Supply check in', body: 'Are you running low on anything?', tag: 'checkin', kind: 'checkin' } });
    }
  }

  const cutoff = now - LIMITS.keepClosedDays * DAY;
  const kept = family.requests.filter(r => r.status === 'open' || (r.closedAt || 0) > cutoff);
  if (kept.length !== family.requests.length) { family.requests = kept; changed = true; }
  const live = family.invites.filter(i => i.exp > now);
  if (live.length !== family.invites.length) { family.invites = live; changed = true; }

  return { changed, notify };
}

// Which devices a message goes to.
export function recipients(family, n) {
  return family.devices.filter(d => d.push && d.id !== n.exceptDevice &&
    ((n.members && n.members.includes(d.memberId)) || (n.devices && n.devices.includes(d.id))));
}

// The number on the app icon: what a parent has to act on. A request waiting on a
// future date is not one of those until its day comes.
export function openCount(family, now = Date.now()) {
  const today = localDate(now, family.tz);
  return family.requests.filter(r => r.status === 'open' && (!r.wait || r.wait.readyOn <= today)).length;
}
