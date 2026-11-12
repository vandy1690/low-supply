// Low Supply. One web app with two faces: the parent app and the child app.
// Which one a device shows is decided when it is linked, and comes from the server.
import { S, BASE, api, op, announce, html, resetDevice } from './ui.js';
import { codeFrom } from './link.js';
import { syncPush } from './push.js';
import * as start from './start.js';
import * as parent from './parent.js';
import * as child from './child.js';

const root = document.getElementById('app');
const busyNote = document.getElementById('busy');
let lastKey = null;
let busy = false;
let offline = false;

const offlineScreen = {
  actions: { async retry() { await load(); } },
  screen: () => ({
    key: 'offline', title: 'No connection',
    body: html`<main class="ls-page"><h1 class="ls-title">No connection</h1>
      <p class="ls-lede">Low Supply could not reach the internet. Nothing was sent.</p>
      <button class="sdc-btn sdc-btn--primary ls-btn--lg" data-act="retry">Try again</button></main>`
  })
};

// Reachable on any device at #/reset, and shown by itself if a screen ever fails to draw.
let broken = false;
let lastParent = false;
const resetScreen = {
  actions: {
    async resetNow() {
      // If this is the only parent phone, resetting it would leave the family with no
      // way in. Say so first; "Reset anyway" is there for when the app is truly stuck.
      if (S.token && !lastParent) {
        try { await op({ type: 'unlinkSelf' }); }
        catch (e) { if (/only parent device/.test(e.message)) { lastParent = true; return; } }
      }
      await resetDevice({ tellServer: false });
    },
    reload() { location.reload(); },
    back() { broken = false; location.hash = '#/'; }
  },
  screen: () => ({
    key: broken ? 'broken' : 'reset', title: broken ? 'Something went wrong' : 'Reset this device',
    body: html`<main class="ls-page">
      <h1 class="ls-title">${broken ? 'Something went wrong' : 'Reset this device'}</h1>
      ${broken ? html`<p class="ls-lede">Low Supply hit a problem drawing this screen. Nothing was sent. Try again first.</p>
        <button class="sdc-btn sdc-btn--primary ls-btn--lg" data-act="reload">Try again</button>` : ''}
      <div class="ls-panel">
        <p><strong>Resetting unlinks this device</strong> and clears what Low Supply saved on it. The family, the other devices and any open requests are not touched.</p>
        <p class="ls-mute">Afterward, link it again with a new code from a parent. To wipe the whole family and start over, a parent uses Settings.</p>
        ${lastParent ? html`<div class="ls-notice ls-notice--warning" role="alert"><p class="ls-notice__text">This is the only parent phone in the family. If you reset it, nobody can manage the family or mark requests ordered. Link another parent phone first, or delete the family in Settings.</p></div>` : ''}
        <button class="sdc-btn ls-btn--danger" id="reset-now" data-act="resetNow">${lastParent ? 'Reset anyway' : 'Reset this device'}</button>
      </div>
      ${broken ? '' : html`<button class="sdc-btn" data-act="back">Never mind, go back</button>`}
    </main>`
  })
};

function current() {
  const path = location.hash.replace(/^#/, '') || '/';
  if (broken || path === '/reset') return { mod: resetScreen, path };
  const mod = offline ? offlineScreen : !S.state ? start : S.state.role === 'child' ? child : parent;
  return { mod, path };
}

function render() {
  let { mod, path } = current();
  let view;
  try { view = mod.screen(path); }
  catch (err) {
    // A bug in one screen must not leave a blank page with no way out.
    console.error(err);
    broken = true;
    mod = resetScreen;
    view = mod.screen(path);
  }
  const active = document.activeElement;
  const activeId = active && active.id;
  const onHeading = active && active.tagName === 'H1';
  root.innerHTML = view.body.__raw;
  document.title = view.title ? `${view.title}, Low Supply` : 'Low Supply';
  if (view.key !== lastKey) {
    // A new screen: start at the top and put focus on its heading, so a screen
    // reader says where you are.
    lastKey = view.key;
    window.scrollTo(0, 0);
    const h = root.querySelector('h1');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
    mod.entered?.(path, view.key);
  } else if (activeId) {
    // Same screen, new content: keep focus where it was.
    document.getElementById(activeId)?.focus({ preventScroll: true });
  } else if (onHeading) {
    const h = root.querySelector('h1');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }
}

async function run(name, el, event) {
  const { mod } = current();
  const fn = mod.actions[name];
  if (!fn || busy) return;
  busy = true;
  S.notice = null;
  // Most taps answer at once. When one does not, say so, on screen and to a screen reader.
  const slow = setTimeout(() => { busyNote.hidden = false; announce('Working on it.'); }, 700);
  let after;
  try { after = await fn(el, event); }
  catch (err) {
    S.notice = { tone: 'error', text: err.message };
    announce(err.message);
    mod.onError?.(err);
  }
  clearTimeout(slow);
  busyNote.hidden = true;
  busy = false;
  render();
  if (typeof after === 'function') after();
}

root.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && root.contains(el)) run(el.dataset.act, el, e);
});
root.addEventListener('submit', e => {
  const form = e.target.closest('form[data-submit]');
  if (!form) return;
  e.preventDefault();
  run(form.dataset.submit, form, e);
});
root.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (el) run(el.dataset.change, el, e);
});
window.addEventListener('hashchange', () => { if (S.notice?.shown) S.notice = null; render(); });
window.addEventListener('ls:render', render);

async function load() {
  try {
    if (S.token) S.state = (await api('GET', 'state')).state;
    offline = false;
  } catch {
    offline = !!S.token && !S.state;
  }
}

// Look for changes from the other devices. Skips redrawing while someone is typing.
async function refresh() {
  if (!S.token || busy || document.hidden) return;
  const before = JSON.stringify(S.state);
  await load();
  if (JSON.stringify(S.state) === before) return;
  const el = document.activeElement;
  const typing = el && root.contains(el) && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.type !== 'checkbox' && el.type !== 'radio';
  if (!typing && !busy) render();
}

// Checks often on screens that are waiting for another device (a link code), and
// every 20 seconds otherwise. The pace is read each time, since the screen changes.
let lastRefresh = Date.now();
function pollLoop() {
  setInterval(() => {
    const { mod, path } = current();
    if (Date.now() - lastRefresh < (mod.pollMs?.(path) || 20000)) return;
    lastRefresh = Date.now();
    refresh();
  }, 2000);
}

async function boot() {
  S.joinCode = codeFrom(location.search);
  try { S.config = await api('GET', 'config'); } catch { /* shown as offline below if it matters */ }
  await load();
  if (!S.state && !offline && S.joinCode && !start.needsInstall()) {
    await run('joinWithCode', null, null);
  } else {
    render();
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(BASE ? '/low-supply-sw.js' : '/sw.js', { scope: BASE || '/' }).then(() => syncPush()).catch(() => {});
    navigator.serviceWorker.addEventListener('message', e => { if (e.data?.type === 'push') refresh(); });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.matchMedia('(orientation: landscape)').addEventListener('change', render);
  pollLoop();
  // Opening the app is the moment the badge has done its job.
  if (navigator.clearAppBadge && S.state?.role === 'parent' && !S.state.requests.length) navigator.clearAppBadge().catch(() => {});
}
boot();
