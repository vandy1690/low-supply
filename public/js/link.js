// Link codes: drawing one as a QR code, and reading one with the camera.
import { html, raw, BASE, HOME } from './ui.js';

export const prettyCode = code => code.slice(0, 4) + '-' + code.slice(4);
export const joinUrl = code => `${location.origin}${HOME}?join=${code}`;

let qrLoaded;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.append(s);
  });
}

// Returns an <svg> of the code. The quiet zone and the white ground are part of it.
export async function qrSvg(text) {
  qrLoaded ??= loadScript(BASE + '/vendor/qrcode.js');
  await qrLoaded;
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let rects = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) rects += `<rect x="${x + 2}" y="${y + 2}" width="1" height="1"/>`;
  return raw(`<svg viewBox="0 0 ${n + 4} ${n + 4}" role="img" aria-label="Link code as a QR code" shape-rendering="crispEdges">${rects}</svg>`);
}

// Pulls the 8 character code out of whatever the camera read.
export function codeFrom(text) {
  const m = String(text).match(/[?&]join=([A-Za-z0-9-]{8,9})/) || String(text).match(/^([A-Za-z0-9]{4}-?[A-Za-z0-9]{4})$/);
  return m ? m[1].replace('-', '').toUpperCase() : null;
}

export const scannerMarkup = () => html`<div class="ls-scan">
  <video id="scan-video" playsinline muted aria-label="Camera view. Point it at the code on the parent's phone."></video>
  <button class="sdc-btn" type="button" data-act="scanStop">Stop the camera</button>
</div>`;

// Starts the camera and calls found(code) once. Returns a function that stops it.
export async function startScanner(video, found) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  video.srcObject = stream;
  await video.play();
  let stopped = false;
  const stop = () => { stopped = true; stream.getTracks().forEach(t => t.stop()); };

  let detect;
  if ('BarcodeDetector' in window) {
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    detect = async () => (await detector.detect(video))[0]?.rawValue;
  } else {
    await loadScript(BASE + '/vendor/jsQR.js');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    detect = async () => {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w) return null;
      const scale = Math.min(1, 640 / w);
      canvas.width = w * scale; canvas.height = h * scale;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return window.jsQR(img.data, img.width, img.height)?.data;
    };
  }
  (async function loop() {
    while (!stopped) {
      try {
        const code = codeFrom(await detect() || '');
        if (code) { stop(); found(code); return; }
      } catch { /* a bad frame; try the next */ }
      await new Promise(r => setTimeout(r, 250));
    }
  })();
  return stop;
}
