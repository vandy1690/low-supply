// End to end check in a real browser: two parents and one child, each on their own
// "phone". Also runs axe (WCAG 2.2 AA) on every screen it visits.
// Needs the dev server running. Borrows Playwright and axe from portfolio-astro:
//   node scripts/e2e.mjs [folder for screenshots]
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(path.join(os.homedir(), 'portfolio-astro/package.json'));
const { chromium } = require('playwright');
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const base = process.env.BASE || 'http://localhost:4350';
const shots = process.argv[2] || path.join(os.tmpdir(), 'low-supply-shots');
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const problems = [];
async function phone(name) {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push(`${name}: page error: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/push|Failed to load resource/.test(m.text())) problems.push(`${name}: console: ${m.text()}`); });
  return page;
}
let shotN = 0;
async function check(page, label) {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(shots, `${String(++shotN).padStart(2, '0')}-${label}.png`) });
  await page.evaluate(axeSource);
  const res = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }));
  for (const v of res.violations) problems.push(`${label}: axe ${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0].html.slice(0, 120)}`);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (wide) problems.push(`${label}: page scrolls sideways`);
  // WCAG 2.5.8: every target at least 24 by 24.
  const small = await page.evaluate(() => [...document.querySelectorAll('#app a, #app button, #app select, #app input:not([type=checkbox]):not([type=radio]), #app label.sdc-choice')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.width < 24 || r.height < 24) && getComputedStyle(e).display !== 'inline'; }).map(e => e.outerHTML.slice(0, 80)));
  for (const s of small) problems.push(`${label}: small target ${s}`);
}
const h1 = page => page.locator('h1').innerText();
const code = async page => (await page.locator('.ls-code').innerText()).trim();

const dad = await phone('dad'), mom = await phone('mom'), kid = await phone('kid');

// --- Dad sets up the family ---
await dad.goto(base);
await dad.getByRole('link', { name: 'Set up a new family' }).click();
await check(dad, 'welcome-new');
await dad.getByRole('button', { name: 'Create the family' }).click();
assert.match(await dad.locator('.ls-notice').innerText(), /Type your nickname/);
await dad.getByLabel('Your nickname').fill('Dad');
await dad.getByRole('button', { name: 'Create the family' }).click();
await dad.getByRole('heading', { name: 'Turn on notifications' }).waitFor();
assert.equal(await dad.evaluate(() => document.activeElement.tagName), 'H1', 'focus moves to the new heading');
await check(dad, 'setup-notify');
await dad.getByRole('button', { name: /Skip for now|Continue without/ }).click();
await dad.getByLabel('Their nickname').fill('Mom');
await dad.getByRole('button', { name: 'Make their link code' }).click();
await dad.locator('.ls-qr svg').waitFor();
await check(dad, 'setup-invite-parent');
const momCode = await code(dad);

// --- Mom joins by the link in the QR code ---
await mom.goto(`${base}/?join=${momCode.replace('-', '')}`);
await mom.getByRole('heading', { name: 'Requests' }).waitFor();
assert.equal(new URL(mom.url()).search, '', 'the code is cleared from the address');
await check(mom, 'mom-requests-empty');
await dad.getByText("Linked. Mom's").waitFor({ timeout: 9000 });
await dad.getByRole('button', { name: 'Next' }).click();

await dad.getByLabel("Child's nickname").fill('Kid 1');
await dad.getByRole('button', { name: 'Next' }).click();
await dad.getByRole('heading', { name: 'What can Kid 1 ask for?' }).waitFor();
await dad.getByRole('button', { name: 'Next' }).click();
assert.match(await dad.locator('.ls-notice').innerText(), /at least one supply/);
for (const s of ['Sensor', 'Pump / Pod', 'Insulin', 'Test strips']) {
  await dad.locator('label.sdc-choice', { hasText: new RegExp('^\\s*' + s.replace('/', '\\/') + '\\s*$') }).click();
  await dad.waitForTimeout(250);
}
await check(dad, 'setup-supplies');
await dad.getByRole('button', { name: 'Next' }).click();
await dad.getByRole('heading', { name: 'Check ins' }).waitFor();
await dad.getByLabel('Sensor').selectOption('10');
await dad.waitForTimeout(300);
await check(dad, 'setup-schedule');
await dad.getByRole('button', { name: 'Next' }).click();
await dad.locator('.ls-qr svg').waitFor();
await check(dad, 'setup-link-child');
const kidCode = await code(dad);

// --- The child device links by typing the code ---
await kid.goto(base);
await kid.getByRole('link', { name: 'Link this device to a family' }).click();
await check(kid, 'join');
await kid.getByLabel('Or type the code').fill('WRONG234');
await kid.getByRole('button', { name: 'Link with this code' }).click();
assert.match(await kid.locator('.ls-notice').innerText(), /did not work/);
await kid.getByLabel('Or type the code').fill(kidCode.toLowerCase());
await kid.getByRole('button', { name: 'Link with this code' }).click();
await kid.locator('.ls-grid').waitFor();
assert.equal(await kid.locator('.ls-tile').count(), 4);
await check(kid, 'kid-grid-4');
const box = await kid.locator('.ls-grid').boundingBox();
assert.ok(box.height > 740, 'the buttons fill the screen under the top bar');
await dad.getByText("Linked. Kid 1's").waitFor({ timeout: 9000 });
await dad.getByRole('button', { name: 'Finish setup' }).click();
await dad.getByRole('heading', { name: 'Requests' }).waitFor();

// --- Kid asks, both parents see it ---
await kid.getByRole('link', { name: 'Sensor' }).click();
await kid.getByRole('heading', { name: 'Sensor' }).waitFor();
await check(kid, 'kid-supply');
await kid.getByRole('button', { name: 'Running low' }).click();
await kid.getByRole('button', { name: /Cancel running low/ }).waitFor();
assert.equal(await kid.evaluate(() => document.activeElement.id), 'btn-low', 'focus stays on the button that was tapped');
await check(kid, 'kid-supply-sent');
for (const p of [dad, mom]) {
  await p.reload();
  await p.locator('.ls-request').waitFor();
  assert.match(await p.locator('.ls-request').innerText(), /Sensor[\s\S]*For Kid 1[\s\S]*Running low/);
}
await check(dad, 'dad-request-low');

// Repeat taps combine into one request.
await kid.getByRole('button', { name: 'I am out' }).click();
await kid.getByRole('button', { name: /Cancel I am out/ }).waitFor();
await kid.getByRole('link', { name: 'Back' }).click();
await kid.locator('.ls-tile--out').waitFor();
await check(kid, 'kid-grid-asked');
await dad.reload();
await dad.locator('.ls-request--out').waitFor();
assert.equal(await dad.locator('.ls-request').count(), 1);

// --- Mom marks it ordered: clears for both, and the child gets a note ---
await mom.reload();
await mom.getByRole('button', { name: /Mark ordered/ }).click();
await mom.getByText('Marked ordered. Kid 1 was told.').waitFor();
await check(mom, 'mom-ordered');
await dad.reload();
await dad.getByText('Nothing is needed right now.').waitFor();
await dad.getByText('Ordered by Mom').waitFor();
await kid.reload();
await kid.getByText('Mom ordered your Sensor.').waitFor();
await check(kid, 'kid-note');
await kid.getByRole('button', { name: 'OK' }).click();
await kid.getByText('Mom ordered your Sensor.').waitFor({ state: 'detached' });

// --- Cancel tells the parents (it leaves their list) ---
await kid.getByRole('link', { name: 'Insulin' }).click();
await kid.getByRole('button', { name: 'I am out' }).click();
await kid.getByRole('button', { name: /Cancel I am out/ }).click();
await kid.getByRole('button', { name: 'I am out' }).waitFor();
await dad.reload();
await dad.getByText('Nothing is needed right now.').waitFor();

// --- Ordered, but not ready until a date ---
await kid.getByRole('button', { name: 'Running low' }).click();
await kid.getByRole('button', { name: /Cancel running low/ }).waitFor();
await dad.reload();
await dad.getByRole('button', { name: /Ordered, but not ready until/ }).click();
assert.equal(await dad.evaluate(() => document.activeElement.type), 'date', 'focus moves to the date field');
await check(dad, 'dad-delay-form');
await dad.getByRole('button', { name: 'Save the date' }).click();
assert.match(await dad.locator('.ls-notice--error').innerText(), /Pick the date/);
const in4 = new Date(Date.now() + 4 * 864e5);
const ymd = `${in4.getFullYear()}-${String(in4.getMonth() + 1).padStart(2, '0')}-${String(in4.getDate()).padStart(2, '0')}`;
await dad.locator('input[type=date]').fill(ymd);
await dad.getByRole('button', { name: 'Save the date' }).click();
await dad.getByRole('heading', { name: 'Ordered, not ready yet' }).waitFor();
assert.match(await dad.locator('.ls-request--wait').innerText(), /Insulin[\s\S]*For Kid 1[\s\S]*Not ready until[\s\S]*4 days to go/);
assert.equal(await dad.evaluate(() => document.activeElement.tagName), 'H1', 'focus goes back to the top, where the message is');
await check(dad, 'dad-waiting');
await mom.reload();
await mom.locator('.ls-request--wait').waitFor();
await kid.reload();
await kid.locator('.ls-wait').waitFor();
assert.match(await kid.locator('.ls-wait').innerText(), /Ordered, but not ready yet[\s\S]*4\s+days until ready/);
assert.doesNotMatch(await kid.locator('#app').innerText(), /January|February|March|April|May|June|July|August|September|October|November|December/, 'the child sees a countdown, not a date');
assert.equal(await kid.locator('.ls-wait .ls-icon').count(), 0, 'the countdown is words and a number, with no icons');
await check(kid, 'kid-supply-waiting');
await kid.getByRole('link', { name: 'Back' }).click();
await kid.getByText(/Dad ordered your Insulin\. 4 days until ready/).waitFor();
assert.ok(await kid.locator('.ls-note--wait').count(), 'the note is said as a warning: it is not ready yet');
{ const ok = await kid.getByRole('button', { name: 'OK' }).boundingBox(), note = await kid.locator('.ls-note--wait').boundingBox();
  assert.ok(ok.width > note.width * 0.8, 'OK is the full width of the note'); }
assert.match(await kid.locator('#tile-insulin').innerText(), /Ordered\. 4 days until ready/);
await check(kid, 'kid-grid-waiting');
await kid.getByRole('button', { name: 'OK' }).click();
await kid.getByText(/Dad ordered your Insulin/).waitFor({ state: 'detached' });
await kid.setViewportSize({ width: 320, height: 568 });
await kid.locator('#tile-insulin').click();
await kid.locator('.ls-wait').waitFor();
await check(kid, 'kid-supply-waiting-small');
await kid.setViewportSize({ width: 402, height: 874 });
await kid.getByRole('link', { name: 'Back' }).click();
await dad.getByRole('button', { name: /Change the date/ }).click();
await dad.getByRole('button', { name: 'Never mind' }).click();
await dad.getByRole('button', { name: /It is ready/ }).click();
await dad.getByText('Marked ready. Kid 1 was told.').waitFor();
await kid.reload();
await kid.getByText('Good news. Your Insulin is ready.').waitFor();
await kid.getByRole('button', { name: 'OK' }).click();
await kid.getByText('Good news.').waitFor({ state: 'detached' });

// --- A check in comes due (the clock is moved by editing the saved file) ---
if (process.env.E2E_DATA) {
  const { readdirSync, writeFileSync } = await import('node:fs');
  const file = path.join(process.env.E2E_DATA, readdirSync(process.env.E2E_DATA).find(f => f.startsWith('f-')));
  const fam = JSON.parse(readFileSync(file, 'utf8'));
  const c = fam.members.find(m => m.role === 'child');
  c.quiet.forEach(q => { q.on = false; });
  c.supplies.forEach(s => { if (s.itemId === 'sensor' || s.itemId === 'strips') s.lastAskedAt -= 40 * 864e5; });
  writeFileSync(file, JSON.stringify(fam));
  await kid.goto(base + '/#/'); await kid.reload();
  await kid.getByRole('heading', { name: 'Are you running low on anything?' }).waitFor();
  assert.equal(await kid.locator('.ls-tile').count(), 3, 'two due supplies and the all good button');
  await check(kid, 'kid-checkin');
  await kid.getByRole('button', { name: 'No, I am all good' }).click();
  await kid.locator('a.ls-tile').first().waitFor();
  assert.equal(await kid.locator('a.ls-tile').count(), 4);
}

// --- Read aloud switch, from the child side and seen by the parent ---
await kid.getByRole('button', { name: 'Read aloud' }).click();
await kid.locator('.ls-speaker[aria-pressed="false"]').waitFor();

// --- Quick info: links and office numbers, for parents only ---
await dad.getByRole('link', { name: 'Info' }).click();
await dad.getByRole('heading', { name: 'Quick info' }).waitFor();
await check(dad, 'info-empty');
await dad.getByRole('button', { name: 'Pharmacy' }).click();
assert.equal(await dad.evaluate(() => document.activeElement.id), 'info-new-value', 'picking a starter moves to the link box');
assert.equal(await dad.locator('#info-new-label').inputValue(), 'Pharmacy');
await dad.locator('#info-new-value').fill('http://pharmacy.example.com');
await dad.getByRole('button', { name: 'Save' }).click();
assert.match(await dad.locator('.ls-notice--error').innerText(), /starts with https/);
await dad.locator('#info-new-label').fill('Pharmacy');
await dad.locator('#info-new-value').fill('pharmacy.example.com/refills');
await dad.getByRole('button', { name: 'Save' }).click();
await dad.getByText('Pharmacy was saved.').waitFor();
const open = dad.getByRole('link', { name: /Open Pharmacy/ });
assert.equal(await open.getAttribute('href'), 'https://pharmacy.example.com/refills');
assert.equal(await open.getAttribute('rel'), 'noopener noreferrer');
await dad.getByRole('button', { name: "Endocrinologist's priority line" }).click();
await dad.locator('#info-new-value').fill('(630) 555-0142');
await dad.locator('#info-new-press').fill('2');
await dad.getByRole('button', { name: 'Save' }).click();
await dad.getByText("Endocrinologist's priority line was saved.").waitFor();
const call = dad.getByRole('link', { name: /Call Endocrinologist's priority line/ });
assert.equal(await call.getAttribute('href'), 'tel:6305550142,2', 'the menu choice rides after a pause');
assert.match(await call.innerText(), /Endocrinologist's priority line[\s\S]*\(630\) 555-0142, then press 2/);
const wide = await call.boundingBox(), row = await dad.locator('li.ls-info').last().boundingBox();
assert.ok(wide.width > row.width - 2, 'the button is the full width of its row');
await check(dad, 'info-list');
await mom.goto(base + '/#/info'); await mom.reload();
await mom.getByRole('link', { name: /Open Pharmacy/ }).waitFor();
await kid.goto(base + '/#/info'); await kid.reload();
await kid.locator('.ls-grid').waitFor();
assert.doesNotMatch(await kid.locator('#app').innerText(), /Quick info|Pharmacy|555/, 'a child device never sees it');
await dad.getByRole('button', { name: 'Edit Pharmacy' }).click();
assert.match(await dad.evaluate(() => document.activeElement.id), /^info-i_.+-label$/, 'focus moves into the edit form');
await check(dad, 'info-edit');
await dad.locator('form[data-id] input[name=label]').fill('Our pharmacy');
await dad.locator('form[data-id]').getByRole('button', { name: 'Save' }).click();
await dad.getByText('Our pharmacy was saved.').waitFor();
await dad.getByRole('button', { name: 'Edit Our pharmacy' }).click();
await dad.getByRole('button', { name: 'Remove' }).click();
await dad.locator('dialog[open]').getByRole('button', { name: 'Remove' }).click();
await dad.getByText('Our pharmacy was removed.').waitFor();
assert.equal(await dad.getByRole('link', { name: /Open/ }).count(), 0);
await dad.setViewportSize({ width: 320, height: 568 });
await dad.waitForTimeout(200);
await check(dad, 'info-320');
await dad.setViewportSize({ width: 402, height: 874 });

// --- Settings, child page, relink and remove a device ---
await dad.getByRole('link', { name: 'Settings' }).click();
await dad.getByRole('heading', { name: 'Settings' }).waitFor();
await check(dad, 'settings');
await dad.getByLabel('Name of the supply').fill('Juice boxes');
await dad.locator('label.sdc-choice:has(#icon-glass-full)').click();
await dad.getByRole('button', { name: 'Add supply' }).click();
await dad.getByText('Juice boxes was added').waitFor();
await dad.getByRole('link', { name: /Kid 1/ }).click();
await dad.getByRole('heading', { name: 'Kid 1' }).waitFor();
assert.equal(await dad.locator('#read-aloud').isChecked(), false, 'the parent sees the child turned read aloud off');
await dad.locator('label.sdc-choice', { hasText: 'Juice boxes' }).click();
await dad.waitForTimeout(300);
await check(dad, 'child-settings');
await kid.goto(base + '/#/'); await kid.reload();
await kid.locator('.ls-grid').waitFor();
assert.equal(await kid.locator('.ls-tile').count(), 5);
await check(kid, 'kid-grid-5');
await kid.setViewportSize({ width: 874, height: 402 });
await kid.waitForTimeout(200);
await check(kid, 'kid-grid-5-landscape');
await kid.setViewportSize({ width: 320, height: 568 });
await kid.waitForTimeout(200);
await check(kid, 'kid-grid-5-small');
await kid.setViewportSize({ width: 402, height: 874 });

await dad.getByRole('button', { name: /^Remove\s+Kid 1's/ }).click();
await dad.locator('dialog[open]').waitFor();
await check(dad, 'confirm-dialog');
await dad.getByRole('button', { name: 'Remove device' }).click();
await dad.getByText('No device linked yet.').waitFor();
await kid.reload();
await kid.getByText('This device is no longer linked').waitFor();
await check(kid, 'kid-unlinked');

// Small screen and zoomed text on the parent side.
await dad.setViewportSize({ width: 320, height: 568 });
await dad.goto(base + '/#/settings'); await dad.reload();
await dad.getByRole('heading', { name: 'Settings' }).waitFor();
await check(dad, 'settings-320');

// --- Reset: the screen any device can reach, then a parent deletes the family ---
await mom.goto(base + '/#/reset'); await mom.reload();
await mom.getByRole('heading', { name: 'Reset this device' }).waitFor();
await check(mom, 'reset-screen');
await mom.getByRole('button', { name: 'Reset this device' }).click();
await mom.getByRole('heading', { name: 'Low Supply' }).waitFor();
assert.equal(await mom.evaluate(() => localStorage.getItem('ls.token')), null, 'the reset device holds nothing');
await dad.setViewportSize({ width: 402, height: 874 });
await dad.reload();
await dad.getByRole('button', { name: 'Delete the family and start over' }).click();
await dad.getByRole('button', { name: 'Delete everything' }).click();
await dad.getByRole('link', { name: 'Set up a new family' }).waitFor();
assert.equal(await dad.evaluate(() => localStorage.getItem('ls.token')), null);

await browser.close();
if (problems.length) { console.log('PROBLEMS\n' + [...new Set(problems)].join('\n')); process.exit(1); }
console.log(`All good. ${shotN} screens checked. Screenshots in ${shots}`);
