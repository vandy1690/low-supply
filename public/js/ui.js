// Small shared pieces: safe HTML, the backend, shared state, announcements.
import { icon as iconSvg } from './icons.js';

// Where the app lives: its own address ('' locally) or a path on the family site.
export const BASE = location.pathname.startsWith('/low-supply') ? '/low-supply' : '';
const API = BASE ? '/api/low-supply/' : '/api/';
export const HOME = BASE || '/';

export const S = {
  token: read('ls.token'),
  state: null,          // what the server says this device may see
  config: { vapidPublicKey: null, pushReady: false, setupCode: false, createLocked: false },
  joinCode: null,       // a link code that arrived in the address
  notice: null          // one message to show at the top of the next screen
};

export function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
export function write(key, value) { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* private mode */ } }

// html`...` escapes every value unless it is itself html`...` (or raw()).
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
export const raw = s => ({ __raw: String(s) });
export function html(strings, ...values) {
  let out = '';
  strings.forEach((str, i) => {
    out += str;
    if (i < values.length) out += part(values[i]);
  });
  return { __raw: out };
}
function part(v) {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(part).join('');
  if (v.__raw !== undefined) return v.__raw;
  return esc(v);
}
export const icon = (name, cls) => raw(iconSvg(name, cls));

export async function api(method, name, body) {
  let res;
  try {
    res = await fetch(API + name, {
      method,
      headers: { 'content-type': 'application/json', ...(S.token ? { authorization: 'Bearer ' + S.token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error('No connection. Check the internet and try again.');
  }
  let json = {};
  try { json = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && S.token) {
    // A parent removed this device, or the family is gone.
    S.token = null; S.state = null; write('ls.token', null); write('ls.setup', null);
    S.notice = { tone: 'warning', text: 'This device is no longer linked. Ask a parent for a new code.' };
    location.hash = '#/';
    window.dispatchEvent(new Event('ls:render'));
    throw new Error(json.error || 'This device is not linked.');
  }
  if (!res.ok) throw new Error(json.error || 'Something went wrong. Try again.');
  return json;
}

export async function op(body) {
  const json = await api('POST', 'op', body);
  if (json.state) S.state = json.state;
  return json.result;
}

export function setLinked(json) {
  S.token = json.token; S.state = json.state; S.joinCode = null;
  write('ls.token', json.token);
  // The code has done its job; keep it out of the address bar and the history.
  if (location.search) history.replaceState(null, '', HOME + location.hash);
}

// Puts this device back to a clean start: unlinked, nothing saved, nothing cached.
// Works even when the server cannot be reached, because a reset must not depend on
// the thing that might be broken.
export async function resetDevice({ tellServer = true } = {}) {
  if (tellServer && S.token) { try { await op({ type: 'unlinkSelf' }); } catch { /* reset anyway */ } }
  try {
    const reg = await navigator.serviceWorker?.getRegistration(BASE ? '/low-supply' : '/');
    const sub = await reg?.pushManager?.getSubscription();
    await sub?.unsubscribe();
    await reg?.unregister();
  } catch { /* nothing to undo */ }
  try { for (const k of await caches.keys()) if (k.startsWith('low-supply')) await caches.delete(k); } catch { /* no caches */ }
  try { Object.keys(localStorage).filter(k => k.startsWith('ls.')).forEach(k => localStorage.removeItem(k)); } catch { /* private mode */ }
  history.replaceState(null, '', HOME);
  location.reload();
}

let liveTimer;
export function announce(text) {
  const live = document.getElementById('live');
  live.textContent = '';
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { live.textContent = text; }, 60);
}

export function when(ms) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'Device';
}

export function notice() {
  // Stays up until the next tap or the next screen (app.js clears it), so a redraw
  // from a background refresh does not wipe a message nobody has read yet.
  const n = S.notice;
  if (!n) return '';
  n.shown = true;
  return html`<div class="ls-notice ls-notice--${n.tone || 'success'}" role="${n.tone === 'error' ? 'alert' : 'status'}"><p class="ls-notice__text">${n.text}</p></div>`;
}

// A short yes or no, in a real dialog so focus is held and Escape works.
export function confirmDialog(title, body, yes, danger = true) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'ls-dialog';
    d.setAttribute('aria-labelledby', 'ls-dialog-title');
    d.innerHTML = html`<form method="dialog">
      <h2 class="ls-subhead" id="ls-dialog-title">${title}</h2>
      <p>${body}</p>
      <div class="ls-row">
        <button class="sdc-btn ls-grow" value="no" autofocus>Keep it</button>
        <button class="sdc-btn ls-grow ${danger ? 'ls-btn--danger' : 'sdc-btn--primary'}" value="yes">${yes}</button>
      </div></form>`.__raw;
    document.body.append(d);
    d.addEventListener('close', () => { resolve(d.returnValue === 'yes'); d.remove(); });
    d.showModal();
  });
}
