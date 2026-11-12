// Turning notifications on for this device.
import { S, op, isIOS, isStandalone } from './ui.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const permission = () => (pushSupported() ? Notification.permission : 'unsupported');

function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

// Why notifications cannot be turned on here, in words, or null when they can.
export function pushBlocker() {
  if (isIOS && !isStandalone()) return 'On iPhone and iPad, add Low Supply to the Home Screen first. Notifications only work from there.';
  if (!pushSupported()) return 'This browser cannot show notifications.';
  if (!S.config.pushReady) return 'Notifications are not set up on the server yet.';
  if (permission() === 'denied') return 'Notifications are blocked for Low Supply. Allow them in this device\'s settings, then come back.';
  return null;
}

async function subscribe() {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // The server forgets an address the push service says is dead. If the browser is
  // still holding one the server does not have, it is that dead one: start fresh.
  if (sub && !S.state.push) { await sub.unsubscribe().catch(() => {}); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(S.config.vapidPublicKey) });
  await op({ type: 'subscribe', subscription: sub.toJSON() });
}

// Must be called from a tap: phones only ask for permission in answer to one.
export async function enablePush() {
  const blocker = pushBlocker();
  if (blocker) throw new Error(blocker);
  const answer = await Notification.requestPermission();
  if (answer !== 'granted') throw new Error('Notifications were not allowed. You can turn them on later in Settings.');
  try { await subscribe(); }
  catch (e) {
    // The browser's own wording ("User denied push permission") is not ours to show.
    // Our own messages, from the server, pass through as they are.
    if (e?.name === 'NotAllowedError') throw new Error('This device would not turn notifications on. Check that they are allowed for Low Supply in Settings, then try again.');
    if (e instanceof DOMException) throw new Error('Notifications could not be turned on. Check the connection and try again.');
    throw e;
  }
}

// On opening: if the person already said yes but the server lost the address, mend it quietly.
export async function syncPush() {
  if (!S.state || pushBlocker() || permission() !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!S.state.push || !sub) await subscribe().catch(() => {});
}

export async function disablePush() {
  if (pushSupported()) {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe().catch(() => {});
  }
  await op({ type: 'unsubscribe' });
}
