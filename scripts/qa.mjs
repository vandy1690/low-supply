// Q&A: every screen in every state, checked against WCAG 2.2 AA and for plain breakage.
//   node scripts/qa.mjs [folder for screenshots]
// The browser test (e2e.mjs) proves the flows work. This one builds the states that are
// hard to reach by tapping (a late order, a full child screen, an error on a form) and
// runs the same set of checks on each:
//   axe (WCAG 2.2 AA and best practice), sideways scroll, text spilling out of its box,
//   target size, text spacing (1.4.12), keyboard reach, a visible focus ring that is
//   not covered (2.4.7, 2.4.11), boundary contrast (1.4.11) and Windows High Contrast.
// It starts its own server on port 4363 with a throwaway data folder. Borrows
// Playwright and axe from portfolio-astro.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(os.homedir(), 'portfolio-astro/package.json'));
const engine = process.env.QA_BROWSER || 'chromium';   // QA_BROWSER=webkit runs it in Safari's engine
const browserType = require('playwright')[engine];
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 4363, base = `http://localhost:${PORT}`;
const shots = process.argv[2] || path.join(os.tmpdir(), 'low-supply-qa');
rmSync(shots, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DAY = 864e5;

// ---------- a server and a family with something in every state ----------
const data = mkdtempSync(path.join(os.tmpdir(), 'low-supply-qa-'));
const server = spawn(process.execPath, ['--env-file-if-exists=.env.local', 'server.mjs'], {
  cwd: root, env: { ...process.env, PORT: String(PORT), LOW_SUPPLY_DATA: data }, stdio: 'ignore'
});
const stop = () => { server.kill(); rmSync(data, { recursive: true, force: true }); };
for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* not up yet */ } await sleep(100); }

async function call(name, body, token) {
  const res = await fetch(`${base}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${name} ${JSON.stringify(body)}: ${json.error}`);
  return json;
}
const op = (token, body) => call('op', body, token);
const state = async token => (await (await fetch(base + '/api/state', { headers: { authorization: 'Bearer ' + token } })).json()).state;
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inDays = n => ymd(new Date(Date.now() + n * DAY));
const editFamily = change => {
  const file = path.join(data, readdirSync(data).find(f => f.startsWith('f-')));
  const fam = JSON.parse(readFileSync(file, 'utf8'));
  change(fam);
  writeFileSync(file, JSON.stringify(fam));
};

const dad = (await call('create', { name: 'Dad', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, label: 'iPhone' })).token;
const momId = (await op(dad, { type: 'addParent', name: 'Mom' })).result.id;
await call('join', { code: (await op(dad, { type: 'invite', memberId: momId })).result.code, label: 'iPhone' });
await op(dad, { type: 'addItem', label: 'Juice boxes', icon: 'glass-full' });
const juice = (await state(dad)).customItems[0].id;
const BUILT = ['sensor', 'pump', 'insulin', 'pen', 'needles', 'meter', 'strips', 'ketone', 'glucagon', 'nasal'];

// A child with every supply on, and one in each state. The stress case.
const busyId = (await op(dad, { type: 'addChild', name: 'Bartholomew the Third' })).result.id;
await op(dad, { type: 'updateMember', id: busyId, supplies: [...BUILT, juice].map(itemId => ({ itemId, on: true, everyDays: 0 })) });
const busy = (await call('join', { code: (await op(dad, { type: 'invite', memberId: busyId })).result.code, label: 'iPad' })).token;
// A child with four supplies, the usual case.
const kidId = (await op(dad, { type: 'addChild', name: 'Kiddo' })).result.id;
await op(dad, { type: 'updateMember', id: kidId, supplies: ['sensor', 'pump', 'insulin', 'strips'].map(itemId => ({ itemId, on: true, everyDays: 7 })) });
const kid = (await call('join', { code: (await op(dad, { type: 'invite', memberId: kidId })).result.code, label: 'iPhone' })).token;

const ask = async (token, itemId, level) => {
  await op(token, { type: 'request', itemId, level });
  return [...(await state(dad)).requests, ...(await state(dad)).waiting].find(r => r.itemId === itemId && r.childId === (token === busy ? busyId : kidId)).id;
};
await op(dad, { type: 'delay', requestId: await ask(busy, 'sensor', 'low'), readyOn: inDays(12) });    // counting down
await op(dad, { type: 'delay', requestId: await ask(busy, 'pump', 'out'), readyOn: inDays(0) });       // due today
const late = await ask(busy, 'insulin', 'low');
await op(dad, { type: 'delay', requestId: late, readyOn: inDays(1) });                                  // made late below
await op(dad, { type: 'order', requestId: await ask(busy, 'strips', 'low') });                          // ordered
const readyId = await ask(busy, 'ketone', 'low');
await op(dad, { type: 'delay', requestId: readyId, readyOn: inDays(3) });
await op(dad, { type: 'order', requestId: readyId });                                                   // ready
await ask(busy, 'glucagon', 'out');                                                                     // asked: out
await ask(busy, 'nasal', 'low');                                                                        // asked: low
await op(dad, { type: 'delay', requestId: await ask(kid, 'sensor', 'low'), readyOn: inDays(1) });      // 1 day
await ask(kid, 'insulin', 'low');
editFamily(fam => { fam.requests.find(r => r.id === late).wait.readyOn = inDays(-2); });

await op(dad, { type: 'addInfo', label: 'Patient portal', value: 'https://portal.a-very-long-hospital-system-name.example.org/signin?next=home' });
await op(dad, { type: 'addInfo', label: 'Pharmacy', value: 'pharmacy.example.com/refills' });
await op(dad, { type: 'addInfo', label: "Endocrinologist's office", value: '(630) 555-0142' });
await op(dad, { type: 'addInfo', label: "Endocrinologist's priority line", value: '(312) 555-0199 ext 4', press: '2' });

// ---------- checks ----------
const problems = [], notes = [];
const bad = (where, what) => problems.push(`${where}: ${what}`);

const SPACING = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }';
const BOXES = '.sdc-btn, .ls-tile, .ls-alert, .ls-level, .ls-nav a, .ls-info__go, .ls-wait, .ls-kid__back, .ls-request, .ls-panel, .ls-notice, .ls-code';

async function layout(page, where, { words = true } = {}) {
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) {
    // Name what sticks out, innermost first, so the cause is in the report.
    const who = await page.evaluate(() => [...document.querySelectorAll('#app *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && ![...e.children].some(c => c.getBoundingClientRect().right > innerWidth + 1))
      .slice(0, 3).map(e => `${e.tagName.toLowerCase()}.${String(e.className.baseVal ?? e.className).split(' ')[0]}${e.id ? '#' + e.id : ''} reaches ${Math.round(e.getBoundingClientRect().right)} of ${innerWidth}`));
    // Nothing visibly sticks out: something inside a control does. Hide one kind of
    // thing at a time and see which one the overflow goes away with.
    if (!who.length) who.push(...await page.evaluate(() => {
      const found = [];
      for (const sel of ['input[type=time]', 'input[type=date]', 'select', '.sdc-u-sr-only', 'input[type=checkbox]', 'input[type=radio]', 'svg']) {
        const els = [...document.querySelectorAll('#app ' + sel)]; if (!els.length) continue;
        const was = els.map(e => e.style.display); els.forEach(e => { e.style.display = 'none'; });
        if (document.documentElement.scrollWidth <= innerWidth + 1) found.push(`goes away without ${sel} (scroll width ${els.forEach((e, i) => { e.style.display = was[i]; }) || document.documentElement.scrollWidth} of ${innerWidth})`);
        els.forEach((e, i) => { e.style.display = was[i]; });
      }
      return found;
    }));
    bad(where, `the page scrolls sideways (${who.join('; ') || 'no single element found'})`);
  }
  // Text that is wider than the box it sits in, or a box that pokes out of its parent card.
  const spills = await page.evaluate(sel => [...document.querySelectorAll(sel)].filter(e => e.getClientRects().length).flatMap(e => {
    const out = [];
    if (!e.matches('input, select') && e.scrollWidth > e.clientWidth + 1) out.push(`text is wider than its box: ${e.className.split(' ')[0]} "${e.innerText.trim().slice(0, 40)}"`);
    const card = e.parentElement.closest('.ls-request, .ls-panel, .ls-notice, .ls-kid, .ls-page');
    if (card) { const a = e.getBoundingClientRect(), b = card.getBoundingClientRect(); if (a.right > b.right + 1 || a.left < b.left - 1) out.push(`pokes out of its container: ${e.className.split(' ')[0]} "${e.innerText.trim().slice(0, 30)}"`); }
    return out;
  }), BOXES + ', .sdc-field__input, .sdc-select');
  for (const s of new Set(spills)) bad(where, s);
  // Words broken in the middle because a box was too narrow. (With the wider test
  // spacing a long word may break; nothing is lost, so that is not counted.)
  if (!words) return;
  const broken = await page.evaluate(() => [...document.querySelectorAll('.sdc-btn, .ls-tile > span:not(.ls-tile__status), .ls-nav a, .ls-info__name, .ls-alert > span, .ls-title, .ls-heading, .ls-kid__title')].filter(e => e.getClientRects().length).flatMap(e => {
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT), out = [];
    for (let n; (n = walker.nextNode());) {
      for (const m of n.textContent.matchAll(/[A-Za-z']{4,}/g)) {
        const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
        if (r.getClientRects().length > 1) out.push(`a word is broken across lines: "${m[0]}" in ${e.className.split(' ')[0]}`);
      }
    }
    return out;
  }));
  for (const s of new Set(broken)) bad(where, s);
}

async function targets(page, where, child) {
  // WCAG 2.5.8: 24 by 24 at least. On a child's screen, the bar is this app's own: 44.
  const small = await page.evaluate(min => [...document.querySelectorAll('#app a, #app button, #app select, #app input:not([type=checkbox]):not([type=radio]), #app label.sdc-choice, dialog[open] button')]
    .filter(e => e.getClientRects().length).flatMap(e => {
      const r = e.getBoundingClientRect();
      let w = r.width, h = r.height;
      const after = getComputedStyle(e, '::after');          // a tap area that reaches past the word
      if (after.position === 'absolute' && after.content !== 'none') { h -= parseFloat(after.top) + parseFloat(after.bottom); w -= parseFloat(after.left) + parseFloat(after.right); }
      const inSentence = getComputedStyle(e).display === 'inline' && !e.matches('.ls-note__ok');
      return !inSentence && (w < min || h < min) ? [`${Math.round(w)}x${Math.round(h)} ${e.outerHTML.replace(/\s+/g, ' ').slice(0, 70)}`] : [];
    }), child ? 44 : 24);
  for (const s of small) bad(where, `target smaller than ${child ? 44 : 24}px: ${s}`);
}

async function axe(page, where) {
  await page.evaluate(axeSource);
  const res = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }));
  for (const v of res.violations) bad(where, `axe ${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0].html.replace(/\s+/g, ' ').slice(0, 110)}`);
}

// Luminance contrast between two rgb() strings.
const CONTRAST = `(a, b) => { const lum = c => { const [r, g, bl] = c.match(/[\\d.]+/g).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; }; const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }`;

async function boundaries(page, where) {
  // WCAG 1.4.11: what marks a control's edge needs 3:1 against what is around it.
  const weak = await page.evaluate(contrastSrc => {
    const contrast = eval(contrastSrc);
    const solid = c => c && !/rgba\(.*,\s*0\)|transparent/.test(c);
    const behind = e => { for (let p = e.parentElement; p; p = p.parentElement) { const c = getComputedStyle(p).backgroundColor; if (solid(c)) return c; } return 'rgb(255, 255, 255)'; };
    return [...document.querySelectorAll('.sdc-btn:not(.ls-btn--quiet), .ls-tile, .ls-alert, .sdc-field__input, .sdc-select, .ls-speaker, .ls-kid__back, .ls-wait, label.sdc-choice, .ls-nav a[aria-current]')]
      .filter(e => e.getClientRects().length).flatMap(e => {
        const cs = getComputedStyle(e), around = behind(e);
        const edge = parseFloat(cs.borderTopWidth) > 0 && solid(cs.borderTopColor) ? cs.borderTopColor : null;
        const fill = solid(cs.backgroundColor) ? cs.backgroundColor : null;
        const best = Math.max(edge ? contrast(edge, around) : 0, fill ? contrast(fill, around) : 0);
        return best < 3 ? [`${best.toFixed(2)}:1 ${e.className.split(' ').slice(0, 2).join('.')} "${e.innerText.trim().slice(0, 24)}"`] : [];
      });
  }, CONTRAST);
  for (const s of new Set(weak)) bad(where, `edge contrast under 3:1: ${s}`);
}

async function keyboard(page, where) {
  // Number every stop first, so two buttons with the same words are still two stops.
  const expected = await page.evaluate(() => {
    const all = [...document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && (!document.querySelector('dialog[open]') || e.closest('dialog[open]')));
    all.forEach((e, i) => { e.dataset.qaStop = i; });
    const radios = new Set(all.filter(e => e.type === 'radio').map(e => e.name));
    return all.filter(e => e.type !== 'radio').length + radios.size;
  });
  // Start from the top of the page (or of an open dialog), not from wherever focus was left.
  await page.evaluate(() => {
    window.scrollTo(0, 0); getSelection().removeAllRanges();
    const mark = document.createElement('span'); mark.tabIndex = -1;
    (document.querySelector('dialog[open]') || document.body).prepend(mark); mark.focus(); mark.remove();
  });
  const seen = new Set();
  let last = null, stuck = 0, left = 0;
  for (let i = 0; i < expected * 4 + 6; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(contrastSrc => {
      const contrast = eval(contrastSrc);
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      // A checkbox chip draws its ring on the chip, not on the box inside it.
      const drawn = e.closest('label.sdc-choice') || e;
      const cs = getComputedStyle(drawn), r = drawn.getBoundingClientRect();
      const solid = c => c && !/rgba\(.*,\s*0\)|transparent/.test(c);
      let around = 'rgb(255, 255, 255)';
      for (let p = drawn.parentElement; p; p = p.parentElement) { const c = getComputedStyle(p).backgroundColor; if (solid(c)) { around = c; break; } }
      const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
      const top = document.elementFromPoint(x, y);
      return {
        key: e.dataset.qaStop ?? 'new:' + e.outerHTML.slice(0, 90), radio: e.type === 'radio' ? e.name : null,
        name: (e.getAttribute('aria-label') || drawn.innerText || e.name || e.id || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 40),
        ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2, ringContrast: cs.outlineStyle !== 'none' ? contrast(cs.outlineColor, around) : 0,
        inView: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
        covered: !(top && (drawn.contains(top) || top.contains(drawn)))
      };
    }, CONTRAST);
    if (!f) { if (++left > 1) break; last = null; continue; }   // focus left the page once: come back in at the top
    const key = f.radio ? 'radio:' + f.radio : f.key;
    if (key === last) { if (++stuck > 4) break; continue; }   // a date field has parts inside it
    last = key; stuck = 0;
    if (seen.has(key)) break;            // back at the start
    seen.add(key);
    if (!f.ring) bad(where, `no visible focus ring on "${f.name}"`);
    else if (f.ringContrast < 3) bad(where, `focus ring contrast ${f.ringContrast.toFixed(2)}:1 on "${f.name}"`);
    if (!f.inView) bad(where, `focus goes off screen on "${f.name}"`);
    else if (f.covered) bad(where, `the focused control is covered: "${f.name}"`);
  }
  if (seen.size < expected) bad(where, `the keyboard reached ${seen.size} of ${expected} controls`);
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
}

async function semantics(page, where) {
  const found = await page.evaluate(() => {
    const out = [];
    const scope = document.querySelector('dialog[open]') || document;
    if (scope === document && document.querySelectorAll('h1').length !== 1) out.push(`${document.querySelectorAll('h1').length} h1 headings`);
    if (scope === document && document.querySelectorAll('main').length !== 1) out.push(`${document.querySelectorAll('main').length} main landmarks`);
    if (!document.title || /undefined|null/.test(document.title)) out.push(`page title is "${document.title}"`);
    if (document.documentElement.lang !== 'en') out.push('no page language');
    // What a sighted person reads on a control has to be in what a screen reader says (2.5.3).
    for (const e of scope.querySelectorAll('a[href], button')) {
      if (!e.getClientRects().length) continue;
      const label = e.getAttribute('aria-label');
      const seenText = [...e.childNodes].map(function text(n) { return n.nodeType === 3 ? n.textContent : n.nodeType === 1 && !n.matches('.sdc-u-sr-only, svg') ? [...n.childNodes].map(text).join('') : ''; }).join('').replace(/\s+/g, ' ').trim();
      if (label && seenText && !label.toLowerCase().includes(seenText.toLowerCase())) out.push(`the label "${label}" does not contain the visible words "${seenText}"`);
    }
    // A field that failed has to say so where the field is, not only at the top of the page.
    for (const n of document.querySelectorAll('.ls-notice--error, [role=alert]')) {
      const r = n.getBoundingClientRect();
      if (r.width && (r.bottom < 0 || r.top > innerHeight)) out.push(`an error message is off screen: "${n.innerText.trim().slice(0, 50)}"`);
    }
    for (const i of document.querySelectorAll('input[aria-invalid="true"]')) {
      const ids = (i.getAttribute('aria-describedby') || '').split(' ');
      if (!ids.some(id => document.getElementById(id)?.matches('.sdc-field__error'))) out.push(`an invalid field does not point at its error: ${i.id}`);
    }
    return out;
  });
  for (const s of found) bad(where, s);
}

async function checkAll(page, name, { child = false, keys = true } = {}) {
  await page.waitForTimeout(250);
  const size = page.viewportSize(), where = `${name} @${size.width}`;
  await page.screenshot({ path: path.join(shots, `${name}-${size.width}.png`), fullPage: true });
  await axe(page, where);
  await layout(page, where);
  await targets(page, where, child);
  await boundaries(page, where);
  await semantics(page, where);
  if (keys && engine === 'chromium') await keyboard(page, where);
  // 1.4.12: with wider spacing nothing may be cut off or spill.
  const tag = await page.addStyleTag({ content: SPACING });
  await page.waitForTimeout(100);
  await layout(page, where + ' with text spacing', { words: false });
  await tag.evaluate(e => e.remove());
}

// ---------- screens ----------
const browser = await browserType.launch();
const SIZES = { phone: { width: 402, height: 874 }, small: { width: 320, height: 568 }, wide: { width: 1280, height: 800 }, landscape: { width: 874, height: 402 } };
async function device(token, extra = {}, init) {
  // No service worker here: it would carry requests past the test that fakes a lost connection.
  const ctx = await browser.newContext({ viewport: SIZES.phone, deviceScaleFactor: 1, hasTouch: true, serviceWorkers: 'block', ...extra });
  if (token) await ctx.addInitScript(t => { if (!sessionStorage.getItem('qa')) { localStorage.setItem('ls.token', t); localStorage.setItem('ls.pushAsked', '1'); sessionStorage.setItem('qa', '1'); } }, token);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', e => bad('page error', e.message));
  page.on('console', m => { if (m.type() === 'error' && !/push|Failed to load resource/.test(m.text())) bad('console', m.text()); });
  return page;
}
const go = async (page, hash, wait) => { await page.goto(base + '/#' + hash); await page.reload(); await page.locator(wait).first().waitFor(); };
const each = async (page, sizes, fn) => { for (const s of sizes) { await page.setViewportSize(SIZES[s]); await page.waitForTimeout(120); await fn(s); } await page.setViewportSize(SIZES.phone); };

try {
  // --- before a device is linked ---
  const fresh = await device(null);
  for (const [hash, wait, name] of [['/', 'h1', 'start-welcome'], ['/new', '#name, input', 'start-new'], ['/join', 'input', 'start-join']]) {
    await go(fresh, hash, wait);
    await each(fresh, ['phone', 'small'], () => checkAll(fresh, name));
  }
  // An error is checked at the size it happens at, since it scrolls itself into view then.
  await each(fresh, ['phone', 'small'], async () => {
    await fresh.goto(base + '/#/new'); await fresh.reload();
    await fresh.getByRole('button', { name: 'Create the family' }).click();
    await fresh.locator('.sdc-field__error').waitFor();
    await checkAll(fresh, 'start-new-error', { keys: false });
  });

  // --- parent ---
  const p = await device(dad);
  await go(p, '/', '.ls-request');
  await each(p, ['phone', 'small', 'wide'], () => checkAll(p, 'parent-requests'));
  await p.getByRole('button', { name: /Ordered, but not ready until/ }).first().click();
  await each(p, ['phone', 'small'], () => checkAll(p, 'parent-delay-form'));
  await each(p, ['phone', 'small'], async () => {
    await p.evaluate(() => document.getElementById('ls-form-error')?.remove());   // wait for a new one, not the last one
    await p.getByRole('button', { name: 'Save the date' }).click();
    await p.locator('.sdc-field__error').waitFor();
    if (await p.evaluate(() => document.activeElement.type) !== 'date') bad('parent-delay-error', 'focus is not on the date field after the error');
    await checkAll(p, 'parent-delay-error', { keys: false });
  });
  await p.getByRole('button', { name: 'Never mind' }).click();
  await p.getByRole('button', { name: /Change the date/ }).first().click();
  await checkAll(p, 'parent-change-date');
  await p.getByRole('button', { name: 'Never mind' }).click();

  await go(p, '/info', '.ls-info');
  await each(p, ['phone', 'small', 'wide'], () => checkAll(p, 'parent-info'));
  await p.getByRole('button', { name: /^Edit/ }).last().click();
  await each(p, ['phone', 'small'], () => checkAll(p, 'parent-info-edit'));
  await p.getByRole('button', { name: 'Never mind' }).click();
  await each(p, ['phone', 'small'], async () => {
    await p.locator('#info-new-label').fill('A place');
    await p.locator('#info-new-value').fill('http://not-secure.example');
    await p.locator('#info-new-press').fill('2');
    await p.evaluate(() => document.getElementById('ls-form-error')?.remove());
    await p.locator('form:not([data-id])[data-submit=infoSave] button').click();
    await p.locator('.sdc-field__error').waitFor();
    const kept = await p.evaluate(() => [...document.querySelectorAll('#info-new-label, #info-new-value, #info-new-press')].map(i => i.value));
    if (kept.join('|') !== 'A place|http://not-secure.example|2') bad('parent-info-error', `what was typed is lost after an error: ${JSON.stringify(kept)}`);
    if (await p.evaluate(() => document.activeElement.getAttribute('aria-invalid')) !== 'true') bad('parent-info-error', 'focus is not on the field that failed');
    await checkAll(p, 'parent-info-error', { keys: false });
  });

  await go(p, '/settings', 'h1');
  await each(p, ['phone', 'small', 'wide'], () => checkAll(p, 'parent-settings'));
  await go(p, '/child/' + busyId, 'h1');
  await each(p, ['phone', 'small'], () => checkAll(p, 'parent-child'));
  await go(p, '/link/' + kidId, '.ls-qr svg');
  await each(p, ['phone', 'small'], () => checkAll(p, 'parent-link'));
  await go(p, '/settings', 'h1');
  await p.getByRole('button', { name: /^Remove\s+Kiddo's/ }).click();
  await p.locator('dialog[open]').waitFor();
  await each(p, ['phone', 'small'], () => checkAll(p, 'parent-dialog'));
  await p.keyboard.press('Escape');
  await go(p, '/reset', 'h1');
  await checkAll(p, 'parent-reset');

  // The seven setup steps, on a parent who has not finished them.
  for (const step of ['notify', 'parent', 'child', 'supplies', 'schedule', 'link']) {
    await p.evaluate(([s, c]) => { localStorage.setItem('ls.setup', s); localStorage.setItem('ls.setupChild', c); }, [step, kidId]);
    await go(p, '/', 'h1');
    if (step === 'link') await p.locator('.ls-qr svg').waitFor();
    await each(p, ['phone', 'small'], () => checkAll(p, 'setup-' + step));
  }
  await p.evaluate(() => { localStorage.removeItem('ls.setup'); localStorage.removeItem('ls.setupChild'); });

  // --- child: every supply on and one in each state ---
  const b = await device(busy);
  await go(b, '/', '.ls-grid');
  await each(b, ['phone', 'small', 'landscape', 'wide'], () => checkAll(b, 'child-busy-grid', { child: true }));
  for (const [item, name] of [['sensor', 'counting'], ['pump', 'today'], ['insulin', 'late'], ['strips', 'ordered'], ['glucagon', 'asked-out'], ['meter', 'plain']]) {
    await go(b, '/s/' + item, '.ls-alerts');
    await each(b, ['phone', 'small', 'landscape'], () => checkAll(b, 'child-supply-' + name, { child: true }));
  }
  // --- child: the usual four ---
  const k = await device(kid);
  await go(k, '/', '.ls-grid');
  await each(k, ['phone', 'small', 'landscape'], () => checkAll(k, 'child-grid', { child: true }));
  await go(k, '/s/sensor', '.ls-wait');
  await each(k, ['phone', 'small'], () => checkAll(k, 'child-supply-1-day', { child: true }));
  // A failed send has to be said on the child's screen.
  await k.route('**/api/op', r => r.abort());
  await k.getByRole('button', { name: 'I am out' }).click();
  await k.locator('.ls-notice--error').waitFor();
  await each(k, ['phone', 'small'], () => checkAll(k, 'child-send-failed', { child: true, keys: false }));
  await k.unroute('**/api/op');
  // A check in comes due.
  editFamily(fam => { const c = fam.members.find(m => m.id === kidId); c.quiet.forEach(q => { q.on = false; }); c.supplies.forEach(s => { if (s.itemId === 'pump' || s.itemId === 'strips') s.lastAskedAt -= 40 * DAY; }); });
  await go(k, '/', '.ls-kid__ask');
  await each(k, ['phone', 'small', 'landscape'], () => checkAll(k, 'child-check-in', { child: true }));
  // The one time question about notes, as an iPhone Home Screen app sees it.
  const asks = await device(busy, {}, () => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
    if (window.Notification) Object.defineProperty(Notification, 'permission', { get: () => 'default' });
    if (!sessionStorage.getItem('qa2')) { localStorage.removeItem('ls.pushAsked'); sessionStorage.setItem('qa2', '1'); }
  });
  await asks.goto(base + '/#/');
  await asks.evaluate(() => localStorage.removeItem('ls.pushAsked'));
  await asks.reload();
  if (await asks.getByRole('button', { name: 'Not now' }).count()) await each(asks, ['phone', 'small'], () => checkAll(asks, 'child-notes-question', { child: true }));
  else notes.push('The "notes from your parents" question could not be shown in this browser, so it was not checked.');

  // --- Windows High Contrast: every control still has an edge, every state still has words ---
  for (const [token, hash, wait, name] of engine !== 'chromium' ? [] : [[dad, '/', '.ls-request', 'parent-requests'], [dad, '/info', '.ls-info', 'parent-info'], [busy, '/', '.ls-grid', 'child-busy-grid'], [busy, '/s/sensor', '.ls-wait', 'child-supply-counting']]) {
    const hc = await device(token, { forcedColors: 'active' });
    await go(hc, hash, wait);
    await hc.screenshot({ path: path.join(shots, `high-contrast-${name}.png`), fullPage: true });
    const lost = await hc.evaluate(() => [...document.querySelectorAll('.sdc-btn:not(.ls-btn--quiet), .ls-tile, .ls-alert, .ls-wait, .ls-speaker, .ls-kid__back, .sdc-field__input, .ls-info__go')]
      .filter(e => e.getClientRects().length && !(parseFloat(getComputedStyle(e).borderTopWidth) >= 1 && getComputedStyle(e).borderTopStyle !== 'none'))
      .map(e => `${e.className.split(' ').slice(0, 2).join('.')} "${e.innerText.trim().slice(0, 20)}"`));
    for (const s of new Set(lost)) bad(`${name} in high contrast`, `no edge is drawn: ${s}`);
    const same = await hc.evaluate(() => {
      const here = document.querySelector('.ls-nav a[aria-current="page"]'), other = document.querySelector('.ls-nav a:not([aria-current])');
      return here && other ? getComputedStyle(here).backgroundColor === getComputedStyle(other).backgroundColor : false;
    });
    if (same) bad(`${name} in high contrast`, 'the tab for the page you are on looks like the others');
    await hc.context().close();
  }
} finally {
  await browser.close();
  stop();
}

const unique = [...new Set(problems)];
for (const n of notes) console.log('NOTE ' + n);
if (unique.length) { console.log(`\nQ&A found ${unique.length} problem${unique.length > 1 ? 's' : ''}:\n` + unique.join('\n')); process.exit(1); }
console.log(`Q&A passed. Screenshots in ${shots}`);
