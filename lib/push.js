// Sends web push notifications. The keys come from the environment and are never
// written anywhere else: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
import webpush from 'web-push';

export function makePush(env = process.env) {
  const publicKey = env.LOW_SUPPLY_VAPID_PUBLIC_KEY || env.VAPID_PUBLIC_KEY || null;
  const privateKey = env.LOW_SUPPLY_VAPID_PRIVATE_KEY || env.VAPID_PRIVATE_KEY || null;
  if (!publicKey || !privateKey) {
    return { enabled: false, publicKey: null, async send() { return { ok: false, status: 0 }; } };
  }
  // Push services want a way to reach whoever runs the sender. A public web address
  // does that without handing anyone an email address.
  const subject = env.VAPID_SUBJECT || 'https://stevendesignco.com';
  return {
    enabled: true,
    publicKey,
    async send(subscription, payload) {
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload), {
          TTL: 24 * 3600, urgency: 'high',
          vapidDetails: { subject, publicKey, privateKey }
        });
        return { ok: true };
      } catch (e) {
        // 404 and 410 mean the phone dropped this address for good.
        let host = 'push service';
        try { host = new URL(subscription.endpoint).hostname; } catch { /* keep the generic name */ }
        console.warn(`low-supply: ${host} refused a notification (${e.statusCode || e.code || 'no answer'}) ${String(e.body || '').slice(0, 160)}`);
        return { ok: false, status: e.statusCode || 0, gone: e.statusCode === 404 || e.statusCode === 410 };
      }
    }
  };
}
