// Makes the demo material: step by step screenshots for the docs, and a short video of
// a child's phone and a parent's phone side by side.
//   node scripts/demo.mjs            both
//   node scripts/demo.mjs shots      screenshots only  -> docs/screenshots/
//   node scripts/demo.mjs video      video only        -> docs/demo/low-supply-demo.mp4 and .gif
// It starts its own server on port 4360 with a throwaway data folder, so nothing real is
// touched. Borrows Playwright from portfolio-astro. The video needs ffmpeg.
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(os.homedir(), 'portfolio-astro/package.json'));
const { chromium } = require('playwright');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const what = process.argv[2] || 'both';
const PORT = 4360;
const A = `http://localhost:${PORT}`;      // two addresses for one server, so each
const B = `http://127.0.0.1:${PORT}`;      // "phone" keeps its own saved link
const PHONE = { width: 402, height: 874 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer() {
  const data = mkdtempSync(path.join(os.tmpdir(), 'low-supply-demo-'));
  const child = spawn(process.execPath, ['--env-file-if-exists=.env.local', 'server.mjs'], {
    cwd: root, env: { ...process.env, PORT: String(PORT), LOW_SUPPLY_DATA: data }, stdio: 'ignore'
  });
  return { stop() { child.kill(); rmSync(data, { recursive: true, force: true }); } };
}
async function waitForServer() {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(A + '/api/health')).ok) return; } catch { /* not up yet */ } await sleep(100); }
  throw new Error('The demo server did not start.');
}
const code = async scope => (await scope.locator('.ls-code').innerText()).trim();
// The same thing a notification does when it lands: the app looks again.
const nudge = scope => scope.locator('body').evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

// Parent setup up to the screen that shows the child's link code. `shot` is optional.
async function parentSetup(p, { shot = async () => {}, secondParent = null } = {}) {
  // An iPhone browser is first asked to add the app to the Home Screen.
  const go = p.getByRole('link', { name: 'Set up a new family' }), wall = p.getByRole('button', { name: /Keep going in the browser/ });
  await go.or(wall).first().waitFor();
  if (await wall.isVisible()) await wall.click();
  await p.getByRole('link', { name: 'Set up a new family' }).waitFor();
  await shot(p, 'welcome');
  await p.getByRole('link', { name: 'Set up a new family' }).click();
  await p.getByLabel('Your nickname').fill('Dad');
  await shot(p, 'new-family');
  await p.getByRole('button', { name: 'Create the family' }).click();
  await p.getByRole('heading', { name: 'Turn on notifications' }).waitFor();
  await shot(p, 'notifications');
  await p.getByRole('button', { name: /Skip for now|Continue without/ }).click();
  await p.getByRole('heading', { name: 'Invite the other parent' }).waitFor();
  if (secondParent) {
    await p.getByLabel('Their nickname').fill('Mom');
    await p.getByRole('button', { name: 'Make their link code' }).click();
    await p.locator('.ls-qr svg').waitFor();
    await shot(p, 'invite-other-parent');
    await secondParent.goto(`${A}/?join=${(await code(p)).replace('-', '')}`);
    await secondParent.getByRole('heading', { name: 'Requests' }).waitFor();
    await p.getByText("Linked. Mom's").waitFor({ timeout: 9000 });
    await p.getByRole('button', { name: 'Next' }).click();
  } else {
    await p.getByRole('button', { name: /^Skip/ }).click();
  }
  await p.getByLabel("Child's nickname").fill('Kiddo');
  await shot(p, 'add-child');
  await p.getByRole('button', { name: 'Next' }).click();
  await p.getByRole('heading', { name: 'What can Kiddo ask for?' }).waitFor();
  for (const s of ['Sensor', 'Pump / Pod', 'Insulin', 'Test strips']) {
    await p.locator('label.sdc-choice', { hasText: new RegExp('^\\s*' + s.replace('/', '\\/') + '\\s*$') }).click();
    await sleep(250);
  }
  await shot(p, 'choose-supplies');
  await p.getByRole('button', { name: 'Next' }).click();
  await p.getByRole('heading', { name: 'Check ins' }).waitFor();
  await p.getByLabel('Sensor').selectOption('10');
  await sleep(300);
  await shot(p, 'check-ins');
  await p.getByRole('button', { name: 'Next' }).click();
  await p.locator('.ls-qr svg').waitFor();
  await shot(p, 'link-child-device');
}

// The recording browser is not a phone and cannot receive notifications, so the app
// would describe that browser, not the product. This makes it look like what it stands
// in for: Low Supply opened from an iPhone Home Screen that has not been asked about
// notifications yet. The note a parent sees after skipping them is left out.
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const staged = () => {
  Object.defineProperty(navigator, 'standalone', { get: () => true });
  if (window.Notification) Object.defineProperty(Notification, 'permission', { get: () => 'default' });
  const tidy = () => document.querySelectorAll('.ls-notice--warning').forEach(n => { if (/otifications/.test(n.textContent)) n.style.display = 'none'; });
  new MutationObserver(tidy).observe(document, { childList: true, subtree: true });
};

// ---------- screenshots ----------
async function shots(browser) {
  const out = path.join(root, 'docs/screenshots');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  let n = 0;
  const shot = async (page, label) => {
    await sleep(250);
    await page.screenshot({ path: path.join(out, `${String(++n).padStart(2, '0')}-${label}.png`) });
  };
  const phone = async () => {
    const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: IPHONE });
    await ctx.addInitScript(staged);
    return ctx.newPage();
  };
  const dad = await phone(), mom = await phone(), kid = await phone();

  await dad.goto(A);
  await parentSetup(dad, { shot, secondParent: mom });
  const kidCode = await code(dad);

  await kid.goto(A);
  await kid.getByRole('link', { name: 'Link this device to a family' }).click();
  await kid.getByLabel('Or type the code').fill(kidCode);
  await shot(kid, 'child-types-code');
  await kid.getByRole('button', { name: 'Link with this code' }).click();
  await kid.getByRole('button', { name: 'Not now' }).waitFor();
  await shot(kid, 'child-notes-from-parents');
  await kid.getByRole('button', { name: 'Not now' }).click();
  await kid.locator('.ls-grid').waitFor();
  await shot(kid, 'child-home');
  await dad.getByText("Linked. Kiddo's").waitFor({ timeout: 9000 });
  await dad.getByRole('button', { name: 'Finish setup' }).click();
  await dad.getByRole('heading', { name: 'Requests' }).waitFor();

  await kid.getByRole('link', { name: 'Sensor' }).click();
  await kid.getByRole('heading', { name: 'Sensor' }).waitFor();
  await shot(kid, 'child-supply');
  await kid.getByRole('button', { name: 'Running low' }).click();
  await kid.getByRole('button', { name: /Cancel running low/ }).waitFor();
  await shot(kid, 'child-asked');
  await dad.reload();
  await dad.locator('.ls-request').waitFor();
  await shot(dad, 'parent-request');
  await mom.reload();
  await mom.getByRole('button', { name: /Mark ordered/ }).click();
  await mom.getByText('Marked ordered. Kiddo was told.').waitFor();
  await shot(mom, 'parent-marked-ordered');
  await kid.goto(A + '/#/'); await kid.reload();
  await kid.getByText('Mom ordered your Sensor.').waitFor();
  await shot(kid, 'child-told-it-is-ordered');

  // --- an order that is delayed ---
  await kid.getByRole('link', { name: /Insulin/ }).click();
  await kid.getByRole('button', { name: 'Running low' }).click();
  await kid.getByRole('button', { name: /Cancel running low/ }).waitFor();
  await dad.reload();
  await dad.getByRole('button', { name: /Ordered, but not ready until/ }).click();
  const in5 = new Date(Date.now() + 5 * 864e5);
  await dad.locator('input[type=date]').fill(`${in5.getFullYear()}-${String(in5.getMonth() + 1).padStart(2, '0')}-${String(in5.getDate()).padStart(2, '0')}`);
  await shot(dad, 'parent-not-ready-until');
  await dad.getByRole('button', { name: 'Save the date' }).click();
  await dad.getByRole('heading', { name: 'Ordered, not ready yet' }).waitFor();
  await dad.getByRole('heading', { name: 'Ordered, not ready yet' }).evaluate(h => window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 24));
  await shot(dad, 'parent-waiting');
  await kid.goto(A + '/#/'); await kid.reload();
  await kid.getByText(/Dad ordered your Insulin\. 5 days until ready/).waitFor();
  await shot(kid, 'child-countdown-home');
  await kid.getByRole('link', { name: /Insulin/ }).click();
  await kid.locator('.ls-wait').waitFor();
  await shot(kid, 'child-countdown');
  await dad.getByRole('button', { name: /It is ready/ }).click();
  await dad.getByText('Marked ready. Kiddo was told.').waitFor();
  await kid.goto(A + '/#/'); await kid.reload();
  await kid.getByText('Good news. Your Insulin is ready.').waitFor();
  await shot(kid, 'child-ready');

  // --- quick info ---
  await dad.getByRole('link', { name: 'Info' }).click();
  await dad.getByRole('heading', { name: 'Quick info' }).waitFor();
  for (const [name, value, press] of [['Patient portal', 'portal.example.org/signin', ''], ['Pharmacy', 'pharmacy.example.com/refills', ''],
    ["Endocrinologist's office", '(630) 555-0142', ''], ["Endocrinologist's priority line", '(312) 555-0199', '2']]) {
    await dad.getByRole('button', { name, exact: true }).click();
    await dad.locator('#info-new-value').fill(value);
    if (press) await dad.locator('#info-new-press').fill(press);
    if (name === 'Patient portal') { await dad.locator('#info-add-h').evaluate(h => window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 24)); await shot(dad, 'quick-info-add'); }
    await dad.locator('form:not([data-id])[data-submit=infoSave] button').click();
    await dad.getByText(`${name} was saved.`).waitFor();
  }
  await dad.goto(A + '/#/info'); await dad.reload();
  await dad.getByRole('heading', { name: 'Quick info' }).waitFor();
  await dad.evaluate(() => window.scrollTo(0, 0));   // a reload puts the page back where it was scrolled to
  await shot(dad, 'quick-info');

  await dad.getByRole('link', { name: 'Settings' }).click();
  await dad.getByRole('heading', { name: 'Settings' }).waitFor();
  await shot(dad, 'settings');
  await dad.goto(A + '/#/reset'); await dad.reload();
  await dad.getByRole('heading', { name: 'Reset this device' }).waitFor();
  await shot(dad, 'reset');
  console.log(`${n} screenshots in ${out}`);
}

// ---------- video ----------
// The stage is a blank page, which may not fetch fonts from the app's address, so the
// body face rides along inside it.
const inter = [400, 600].map(w => `@font-face { font-family: 'Inter'; font-weight: ${w}; src: url(data:font/woff2;base64,${
  readFileSync(path.join(root, `public/fonts/inter-latin-${w}-normal.woff2`)).toString('base64')}) format('woff2'); }`).join('\n');
// A 4:5 frame, the shape that fills the most of a phone feed. The phones are drawn a
// little larger than life so the words can be read.
const SCALE = 1.16, W = Math.round(PHONE.width * SCALE), H = Math.round(PHONE.height * SCALE);
const stageHtml = `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><title>Low Supply demo</title>
<link rel="stylesheet" href="https://use.typekit.net/uic8bwd.css"><link rel="stylesheet" href="${A}/sdc.css">
<style>
  ${inter}
  html, body { height: 100%; margin: 0; }
  body { background: var(--sdc-bg); color: var(--sdc-text); font-family: var(--sdc-font-body); box-sizing: border-box;
    display: flex; flex-direction: column; align-items: center; padding: var(--sdc-space-3xl) var(--sdc-space-3xl) 0; }
  header { width: ${W * 2 + 48}px; height: 168px; }
  h1 { font-family: var(--sdc-font-display); font-size: var(--sdc-text-display-2); font-weight: 400; font-synthesis: none;
    font-variation-settings: "wdth" 100, "slnt" 0; line-height: 1.04; margin: 0 0 var(--sdc-space-md); }
  #caption { font-size: var(--sdc-text-heading); font-weight: 600; line-height: 1.25; margin: 0; }
  .phones { display: flex; gap: 48px; }
  figure { margin: 0; }
  figcaption { font-size: var(--sdc-text-label); font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--sdc-text-mute); margin-bottom: var(--sdc-space-sm); }
  .frame { width: ${W}px; height: ${H}px; border: 1px solid var(--sdc-rule-strong); border-radius: var(--sdc-space-xl);
    box-shadow: var(--sdc-shadow-float); overflow: hidden; background: var(--sdc-bg); }
  iframe { display: block; width: ${PHONE.width}px; height: ${PHONE.height}px; border: 0; transform: scale(${SCALE}); transform-origin: 0 0; }
</style></head><body>
  <header><h1>Low Supply</h1><p id="caption"></p></header>
  <div class="phones">
    <figure><figcaption>Child's phone</figcaption><div class="frame"><iframe name="kid" title="Child's phone" src="${A}/"></iframe></div></figure>
    <figure><figcaption>Parent's phone</figcaption><div class="frame"><iframe name="dad" title="Parent's phone" src="${B}/"></iframe></div></figure>
  </div>
</body></html>`;

// Shows where a tap lands, so the video can be followed without a cursor.
const tapDot = () => {
  addEventListener('pointerdown', e => {
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;left:${e.clientX - 22}px;top:${e.clientY - 22}px;width:44px;height:44px;border-radius:50%;
      background:var(--sdc-accent);opacity:.45;pointer-events:none;z-index:99999;transition:opacity .5s, transform .5s;`;
    document.documentElement.append(d);
    requestAnimationFrame(() => { d.style.opacity = '0'; d.style.transform = 'scale(1.6)'; });
    setTimeout(() => d.remove(), 600);
  }, true);
};

async function video(browser) {
  const out = path.join(root, 'docs/demo');
  const raw = mkdtempSync(path.join(os.tmpdir(), 'low-supply-video-'));
  mkdirSync(out, { recursive: true });
  const size = { width: 1080, height: 1350 };
  const ctx = await browser.newContext({ viewport: size, userAgent: IPHONE, recordVideo: { dir: raw, size } });
  await ctx.addInitScript(tapDot);
  await ctx.addInitScript(staged);
  const page = await ctx.newPage();
  if (process.env.DEMO_DEBUG) { page.on('console', m => console.log('console:', m.text())); page.on('pageerror', e => console.log('page error:', e.message)); }
  const began = Date.now();
  // The stage is its own blank page, so both phones are framed the same way.
  await page.setContent(stageHtml);
  const kid = page.frameLocator('iframe[name=kid]'), dad = page.frameLocator('iframe[name=dad]');
  const say = text => page.locator('#caption').evaluate((el, t) => { el.textContent = t; }, text);
  const beat = (ms = 1400) => sleep(ms);
  // A typed code looks typed.
  const type = async (loc, text) => { await loc.click(); await loc.pressSequentially(text, { delay: 110 }); };

  // Setup happens off camera; the video is cut to start where the child's code shows.
  try { await parentSetup(dad); } catch (e) { if (process.env.DEMO_DEBUG) await page.screenshot({ path: process.env.DEMO_DEBUG }); throw e; }
  await kid.getByRole('link', { name: 'Link this device to a family' }).waitFor();
  // The child's "notes from your parents" question is in the screenshots; the video skips it.
  await kid.locator('body').evaluate(() => localStorage.setItem('ls.pushAsked', '1'));
  await page.evaluate(() => document.fonts.ready);
  const cut = (Date.now() - began) / 1000;

  await say('A parent sets it up once and gets a link code.');
  await beat(2600);
  const kidCode = await code(dad);
  await say("The child's phone links with that code. No accounts.");
  await kid.getByRole('link', { name: 'Link this device to a family' }).click();
  await beat(900);
  await type(kid.getByLabel('Or type the code'), kidCode);
  await beat(600);
  await kid.getByRole('button', { name: 'Link with this code' }).click();
  await kid.locator('.ls-grid').waitFor();
  await nudge(dad);
  await dad.getByText("Linked. Kiddo's").waitFor({ timeout: 9000 });
  await beat(1600);
  await dad.getByRole('button', { name: 'Finish setup' }).click();
  await dad.getByRole('heading', { name: 'Requests' }).waitFor();
  await say('The child sees big buttons, one for each supply.');
  await beat(2400);

  await say('Sensors are getting low. One tap.');
  await kid.getByRole('link', { name: 'Sensor' }).click();
  await kid.getByRole('heading', { name: 'Sensor' }).waitFor();
  await beat(1500);
  await kid.getByRole('button', { name: 'Running low' }).click();
  await kid.getByRole('button', { name: /Cancel running low/ }).waitFor();
  await beat(700);
  await nudge(dad);
  await dad.locator('.ls-request').waitFor();
  await say('Both parents get told.');
  await beat(2800);

  await say('Now it is the last one. A second tap updates the same request.');
  await kid.getByRole('button', { name: 'I am out' }).click();
  await kid.getByRole('button', { name: /Cancel I am out/ }).waitFor();
  await beat(700);
  await nudge(dad);
  await dad.locator('.ls-request--out').waitFor();
  await beat(2800);

  await say('A parent orders more and marks it ordered.');
  await beat(900);
  await dad.getByRole('button', { name: /Mark ordered/ }).click();
  await dad.getByText('Marked ordered. Kiddo was told.').waitFor();
  await beat(1200);
  await kid.getByRole('link', { name: 'Back' }).click();
  await nudge(kid);
  await kid.getByText('Dad ordered your Sensor.').waitFor();
  await say('The child hears back, so nobody has to ask twice.');
  await beat(3000);
  await kid.getByRole('button', { name: 'OK' }).click();
  await beat(1800);

  await ctx.close();
  const webm = path.join(raw, readdirSync(raw).find(f => f.endsWith('.webm')));
  const mp4 = path.join(out, 'low-supply-demo.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', cut.toFixed(2), '-i', webm,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', '-an', mp4]);
  // A smaller copy that plays by itself in a README.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf',
    'fps=10,scale=540:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
    path.join(out, 'low-supply-demo.gif')]);
  rmSync(raw, { recursive: true, force: true });
  console.log(`Video at ${mp4}`);
}

const server = startServer();
let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  if (what !== 'video') await shots(browser);
  if (what !== 'shots') await video(browser);
} finally {
  await browser?.close();
  server.stop();
}
