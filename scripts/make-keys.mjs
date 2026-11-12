// Makes the notification keys for this Mac once and keeps them in .env.local,
// which git ignores. The private key is never printed.
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import webpush from 'web-push';

const file = '.env.local';
const have = existsSync(file) ? readFileSync(file, 'utf8') : '';
if (!/^VAPID_PRIVATE_KEY=/m.test(have)) {
  const keys = webpush.generateVAPIDKeys();
  appendFileSync(file, `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`, { mode: 0o600 });
  console.log('Notification keys made and saved to .env.local');
}
