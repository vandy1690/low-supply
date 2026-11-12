// Service worker: keeps the app opening without a connection, and shows notifications.
// On the family site this file is served as /low-supply-sw.js and the app lives under /low-supply.
const BASE = self.location.pathname === '/low-supply-sw.js' ? '/low-supply' : '';
const HOME = BASE || '/';
const API = BASE ? '/api/low-supply/' : '/api/';
const VERSION = 'low-supply-v2';
const SHELL = ['/', '/sdc.css', '/app.css', '/js/app.js', '/js/ui.js', '/js/start.js', '/js/parent.js', '/js/child.js',
  '/js/link.js', '/js/push.js', '/js/speech.js', '/js/icons.js', '/js/catalog.js', '/vendor/qrcode.js',
  '/fonts/inter-latin-400-normal.woff2', '/fonts/inter-latin-600-normal.woff2', '/fonts/inter-latin-700-normal.woff2',
  '/icon-192.png', '/favicon.svg'].map(p => (p === '/' ? HOME : BASE + p));

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Fresh from the network when there is one, the saved copy when there is not.
// Requests to the backend are never saved: a stale "sent" would be a lie.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith(API)) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }).then(hit => hit || caches.match(HOME)))
  );
});

self.addEventListener('push', e => {
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'Low Supply', body: '' }; }
  const jobs = [self.registration.showNotification(data.title || 'Low Supply', {
    body: data.body || '', tag: data.tag || 'low-supply', renotify: true,
    icon: BASE + '/icon-192.png', badge: BASE + '/icon-192.png', data: { kind: data.kind }
  })];
  if (self.navigator.setAppBadge && typeof data.badge === 'number' && data.kind !== 'note' && data.kind !== 'checkin') {
    jobs.push(data.badge ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge());
  }
  jobs.push(self.clients.matchAll({ type: 'window' }).then(list => list.forEach(c => c.postMessage({ type: 'push' }))));
  e.waitUntil(Promise.all(jobs));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => 'focus' in c);
    return open ? open.focus() : self.clients.openWindow(HOME);
  }));
});
