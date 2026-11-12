// Read aloud, using the voice built into the phone. Nothing is sent anywhere.
let on = false;
export function setSpeech(value) { on = !!value; if (!on) stop(); }
export const speechOn = () => on;
export const canSpeak = 'speechSynthesis' in window;
export function stop() { if (canSpeak) speechSynthesis.cancel(); }
export function say(text, force = false) {
  if (!canSpeak || (!on && !force)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.95;
  speechSynthesis.speak(u);
}
