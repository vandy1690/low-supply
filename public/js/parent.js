// The parent app: open requests, setup, and settings.
import { S, op, html, icon, notice, announce, when, read, write, confirmDialog, resetDevice, dayText } from './ui.js';
import { BUILT_IN, ICON_CHOICES, LEVELS, CHECK_IN_DAYS, REMINDER_HOURS, DAY_NAMES, DAY_FULL } from './catalog.js';
import { prettyCode, joinUrl, qrSvg } from './link.js';
import { enablePush, disablePush, pushBlocker, permission } from './push.js';

const SETUP = ['notify', 'parent', 'child', 'supplies', 'schedule', 'link'];
const invites = {};   // memberId -> { code, exp, svg, count }
let setupParent = null;
let delaying = null;
let infoEditing = null;  // the quick info entry being changed
let infoLabel = '';      // a name picked from the starters, waiting for its link or number   // the request whose "not ready until" date is being typed

const st = () => S.state;
const member = id => st().members.find(m => m.id === id);
const children = () => st().members.filter(m => m.role === 'child');
const allItems = () => [...BUILT_IN, ...st().customItems];
const cssId = s => CSS.escape(s);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const setupStep = () => { const s = read('ls.setup'); return SETUP.includes(s) ? s : null; };
const setupChild = () => member(read('ls.setupChild')) || children()[0];

export function pollMs(path) { return path.startsWith('/link/') || ['parent', 'link'].includes(setupStep()) ? 4000 : 20000; }

export function screen(path) {
  if (setupStep()) return setupScreen(setupStep());
  if (path === '/settings') return settingsScreen();
  if (path === '/info') return infoScreen();
  if (path.startsWith('/child/') && member(path.slice(7))?.role === 'child') return childScreen(member(path.slice(7)));
  if (path.startsWith('/link/') && member(path.slice(6))) return linkScreen(member(path.slice(6)));
  return requestsScreen();
}

// Screens that show a link code need one made as they open.
export async function entered(path, key) {
  const id = key.startsWith('link:') ? key.slice(5) : key === 'setup:link' ? setupChild()?.id : null;
  if (id && !liveInvite(id)) {
    try { await makeInvite(id); } catch (e) { S.notice = { tone: 'error', text: e.message }; }
    window.dispatchEvent(new Event('ls:render'));
  }
}

// ---------- shared parts ----------

const bar = here => html`<header class="ls-bar">
  <p class="ls-bar__name">Low Supply</p>
  <nav class="ls-nav" aria-label="Main">
    <a href="#/" ${here === 'requests' ? html`aria-current="page"` : ''}>${icon('list-check')} Requests</a>
    <a href="#/info" ${here === 'info' ? html`aria-current="page"` : ''}>${icon('info-circle')} Info</a>
    <a href="#/settings" ${here === 'settings' ? html`aria-current="page"` : ''}>${icon('settings')} Settings</a>
  </nav></header>`;

const level = l => html`<span class="ls-level ls-level--${l}">${icon(l === 'out' ? 'alert-octagon' : 'alert-triangle')} ${LEVELS[l]}</span>`;

const liveInvite = id => (invites[id] && invites[id].exp > Date.now() + 5000 ? invites[id] : null);
async function makeInvite(id) {
  const result = await op({ type: 'invite', memberId: id });
  invites[id] = { ...result, svg: await qrSvg(joinUrl(result.code)), count: member(id).devices.length };
}

function linkPanel(m) {
  const inv = invites[m.id];
  if (inv && m.devices.length > inv.count) {
    const d = m.devices[m.devices.length - 1];
    return html`<div class="ls-notice ls-notice--success" role="status">${icon('circle-check')}<p class="ls-notice__text">Linked. ${m.name}'s ${d.label} is connected.</p></div>`;
  }
  if (!liveInvite(m.id)) {
    return html`<div class="ls-panel"><p>${inv ? 'That code has run out.' : 'Making a code.'}</p>
      <button class="sdc-btn" data-act="newCode" data-id="${m.id}">${icon('refresh')} Make a new code</button></div>`;
  }
  const time = new Date(inv.exp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return html`<div class="ls-panel">
    <div class="ls-qr">${inv.svg}</div>
    <p class="ls-mute">Or type this code in the app:</p>
    <p class="ls-code">${prettyCode(inv.code)}</p>
    <p class="ls-mute">Works once, for ${m.name} only, until ${time}.</p>
    <button class="sdc-btn" data-act="newCode" data-id="${m.id}">${icon('refresh')} Make a new code</button>
  </div>`;
}

const linkSteps = m => html`<ol class="ls-howto">
  <li>On ${m.name}'s device, open the camera and point it at this code.</li>
  <li>Tap the link that appears. On iPhone or iPad, follow the steps to add Low Supply to the Home Screen, then open it from there.</li>
  <li>If it asks for a code, type the one below.</li>
</ol>`;

function supplyChecklist(c) {
  return html`<fieldset class="sdc-fieldset">
    <legend>Supplies ${c.name} can ask for</legend>
    <p class="sdc-fieldset__desc">Turn on only what ${c.name} uses. Leave off anything on auto refill.</p>
    <div class="sdc-choice-set">${allItems().map(i => html`<label class="sdc-choice">
      <input type="checkbox" id="sup-${i.id}" ${c.supplies.find(s => s.itemId === i.id)?.on ? html`checked` : ''}>${icon(i.icon)} ${i.label}</label>`)}
    </div></fieldset>`;
}

const everyLabel = d => (d === 0 ? 'No check in' : d === 1 ? 'Check in every day' : `Check in every ${d} days`);
function scheduleList(c) {
  const on = allItems().filter(i => c.supplies.find(s => s.itemId === i.id)?.on);
  return html`<fieldset class="sdc-fieldset">
    <legend>Check in schedule</legend>
    <p class="sdc-fieldset__desc">On this schedule the app asks ${c.name}, "Are you running low on anything?"</p>
    ${on.length ? '' : html`<p>No supplies are turned on yet.</p>`}
    <div class="ls-stack">${on.map(i => html`<div class="ls-supply">
      <label class="ls-supply__name" for="every-${i.id}">${icon(i.icon)} ${i.label}</label>
      <select class="sdc-select" id="every-${i.id}">${CHECK_IN_DAYS.map(d => html`<option value="${d}" ${c.supplies.find(s => s.itemId === i.id).everyDays === d ? html`selected` : ''}>${everyLabel(d)}</option>`)}</select>
    </div>`)}</div></fieldset>`;
}

function quietEditor(c) {
  return html`<fieldset class="sdc-fieldset">
    <legend>Quiet hours</legend>
    <p class="sdc-fieldset__desc">No check ins during these times. ${c.name} can still send a request at any hour.</p>
    ${c.quiet.map(q => html`<div class="ls-stack" role="group" aria-label="${q.label}">
      <div class="sdc-choice-set"><label class="sdc-choice"><input type="checkbox" id="q-${q.id}-on" ${q.on ? html`checked` : ''}>${icon(q.id === 'bed' ? 'moon' : 'school')} ${q.label}</label></div>
      <div class="ls-times">
        <div class="sdc-field"><label class="sdc-field__label" for="q-${q.id}-start">${q.label} starts</label><input class="sdc-field__input" type="time" id="q-${q.id}-start" value="${q.start}"></div>
        <div class="sdc-field"><label class="sdc-field__label" for="q-${q.id}-end">${q.label} ends</label><input class="sdc-field__input" type="time" id="q-${q.id}-end" value="${q.end}"></div>
      </div>
      <div class="sdc-choice-set" role="group" aria-label="${q.label} days">${DAY_NAMES.map((d, n) => html`<label class="sdc-choice">
        <input type="checkbox" name="q-${q.id}-day" id="q-${q.id}-day-${n}" value="${n}" ${q.days.includes(n) ? html`checked` : ''}><span aria-hidden="true">${d}</span><span class="sdc-u-sr-only">${DAY_FULL[n]}</span></label>`)}</div>
    </div>`)}</fieldset>`;
}

const readAloudChoice = c => html`<fieldset class="sdc-fieldset">
  <legend>Read aloud</legend>
  <p class="sdc-fieldset__desc">The app speaks the check in question and says each button's name when ${c.name} taps it. ${c.name} can also switch it with the speaker button.</p>
  <div class="sdc-choice-set"><label class="sdc-choice"><input type="checkbox" id="read-aloud" ${c.readAloud ? html`checked` : ''}>${icon('volume')} Read aloud is on</label></div>
</fieldset>`;

function collectChild(form, c) {
  const q = sel => form.querySelector(sel);
  const supplies = allItems().map(i => {
    const old = c.supplies.find(s => s.itemId === i.id);
    const box = q('#' + cssId('sup-' + i.id)), every = q('#' + cssId('every-' + i.id));
    return { itemId: i.id, on: box ? box.checked : !!old?.on, everyDays: every ? Number(every.value) : old?.everyDays ?? 7 };
  });
  const quiet = c.quiet.map(w => {
    const on = q(`#q-${w.id}-on`);
    if (!on) return w;
    return { id: w.id, on: on.checked, start: q(`#q-${w.id}-start`).value, end: q(`#q-${w.id}-end`).value,
      days: [...form.querySelectorAll(`[name="q-${w.id}-day"]:checked`)].map(x => Number(x.value)) };
  });
  const name = q('#child-name'), aloud = q('#read-aloud');
  return { type: 'updateMember', id: c.id, supplies, quiet, ...(name ? { name: name.value } : {}), ...(aloud ? { readAloud: aloud.checked } : {}) };
}

function pushPanel() {
  const blocker = pushBlocker();
  if (st().push && permission() === 'granted') {
    return html`<div class="ls-row"><p class="ls-grow">${icon('bell')} Notifications are on for this device.</p>
      <button class="sdc-btn" data-act="testPush">Send a test</button>
      <button class="sdc-btn" data-act="pushOff">Turn off</button></div>`;
  }
  if (blocker) return html`<div class="ls-notice ls-notice--warning">${icon('bell-off')}<p class="ls-notice__text">${blocker}</p></div>`;
  return html`<div class="ls-notice ls-notice--warning">${icon('bell-off')}<p class="ls-notice__text">Notifications are off on this device, so requests will not reach you here.</p>
    <button class="sdc-btn sdc-btn--primary" data-act="pushOn">Turn on notifications</button></div>`;
}

// ---------- requests ----------

// "Ordered, but not ready until": a date, kept as small as the job. The child sees a
// countdown to it, and both parents get a follow up reminder that day.
function delayForm(r) {
  return html`<form class="ls-stack" data-submit="delaySave" data-id="${r.id}" novalidate>
    <div class="sdc-field"><label class="sdc-field__label" for="ready-${r.id}">${r.item} for ${r.child}: not ready until</label>
      <input class="sdc-field__input" type="date" id="ready-${r.id}" name="readyOn" min="${st().today}" value="${r.wait?.readyOn || ''}" aria-describedby="ready-${r.id}-hint" required>
      <p class="sdc-field__hint" id="ready-${r.id}-hint">${r.child} sees a countdown to this day. Both parents get a reminder that day to follow up with the pharmacy or the doctor's office.</p></div>
    <div class="ls-row"><button class="sdc-btn sdc-btn--primary ls-grow">Save the date</button>
      <button class="sdc-btn ls-grow" type="button" data-act="delayClose">Never mind</button></div>
  </form>`;
}
function waitLine(w) {
  if (w.sleeps > 0) return html`<p>${icon('calendar-event')} Not ready until <strong>${dayText(w.readyOn)}</strong>. ${plural(w.sleeps, 'day', 'days')} to go.</p>`;
  if (w.sleeps === 0) return html`<p>${icon('calendar-event')} Due to be ready <strong>today</strong>. Check with the pharmacy or the doctor's office.</p>`;
  return html`<div class="ls-notice ls-notice--warning">${icon('alert-triangle')}<p class="ls-notice__text">It was due ${dayText(w.readyOn)}. Check with the pharmacy or the doctor's office, then mark it ready or set a new date.</p></div>`;
}

function requestsScreen() {
  const s = st();
  return {
    key: 'requests', title: 'Requests',
    body: html`<main class="ls-page">
      ${bar('requests')}
      ${notice()}
      ${s.push && permission() === 'granted' ? '' : pushPanel()}
      <h1 class="ls-title">Requests</h1>
      ${s.requests.length ? html`<ul class="ls-requests">${s.requests.map(r => html`<li class="ls-request ls-request--${r.level}">
          <div class="ls-request__top">${icon(r.icon, 'ls-request__icon')}
            <div class="ls-request__what"><span class="ls-request__item">${r.item}</span><span>For ${r.child}</span></div></div>
          ${level(r.level)}
          <p class="ls-mute">Asked ${when(r.createdAt)}${r.levelAt !== r.createdAt ? `, changed ${when(r.levelAt)}` : ''}.</p>
          <button class="sdc-btn sdc-btn--primary ls-btn--block" id="order-${r.id}" data-act="order" data-id="${r.id}">${icon('check')} Mark ordered<span class="sdc-u-sr-only">: ${r.item} for ${r.child}</span></button>
          ${delaying === r.id ? delayForm(r)
            : html`<button class="sdc-btn ls-btn--block" id="delay-${r.id}" data-act="delayOpen" data-id="${r.id}">${icon('calendar-event')} Ordered, but not ready until…<span class="sdc-u-sr-only">: ${r.item} for ${r.child}</span></button>`}
        </li>`)}</ul>`
      : html`<div class="ls-panel"><p class="ls-subhead">${s.waiting.length ? 'Nothing new is needed right now.' : 'Nothing is needed right now.'}</p>
          <p class="ls-mute">${children().length ? 'When a child taps a supply, it shows up here and on every parent phone.' : html`No child is set up yet. <a href="#/settings">Add one in Settings.</a>`}</p></div>`}
      ${s.waiting.length ? html`<section class="ls-stack" aria-labelledby="waiting-h">
        <h2 class="ls-heading" id="waiting-h">Ordered, not ready yet</h2>
        <ul class="ls-requests">${s.waiting.map(r => html`<li class="ls-request ls-request--wait" id="waiting-${r.id}">
          <div class="ls-request__top">${icon(r.icon, 'ls-request__icon')}
            <div class="ls-request__what"><span class="ls-request__item">${r.item}</span><span>For ${r.child}</span></div></div>
          ${level(r.level)}
          ${waitLine(r.wait)}
          <p class="ls-mute">Date set by ${r.wait.by}. ${r.child} sees a countdown.${r.wait.sleeps > 0 ? ' Both parents get a follow up reminder that day.' : ''}</p>
          <button class="sdc-btn sdc-btn--primary ls-btn--block" id="order-${r.id}" data-act="order" data-id="${r.id}">${icon('check')} It is ready<span class="sdc-u-sr-only">: ${r.item} for ${r.child}</span></button>
          ${delaying === r.id ? delayForm(r)
            : html`<button class="sdc-btn ls-btn--block" id="delay-${r.id}" data-act="delayOpen" data-id="${r.id}">${icon('calendar-event')} Change the date<span class="sdc-u-sr-only">: ${r.item} for ${r.child}</span></button>`}
        </li>`)}</ul></section>` : ''}
      ${s.recent.length ? html`<section class="ls-stack" aria-labelledby="recent-h">
        <h2 class="ls-heading" id="recent-h">Ordered lately</h2>
        <div class="ls-panel"><ul class="ls-list">${s.recent.map(r => html`<li>
          <div class="ls-list__main"><span class="ls-list__name">${r.item} for ${r.child}</span><span class="ls-mute">Ordered by ${r.by}, ${when(r.closedAt)}.</span></div>
          ${r.canReopen ? html`<button class="sdc-btn" id="reopen-${r.id}" data-act="reopen" data-id="${r.id}">Not ordered yet<span class="sdc-u-sr-only">: put ${r.item} for ${r.child} back on the list</span></button>` : ''}
        </li>`)}</ul></div></section>` : ''}
    </main>`
  };
}

// ---------- quick info ----------
// Links and office numbers both parents need in a hurry. Parents only: the server never
// sends this list to a child's device.

const INFO_STARTERS = ['Patient portal', 'Pharmacy', "Endocrinologist's office", "Endocrinologist's emergency line"];
// Only what the server could have made is ever put in a link.
const safeHref = i => (i.kind === 'phone' ? /^tel:[+\d,]+$/.test(i.href) : /^https:\/\//.test(i.href)) ? i.href : null;

function infoFields(id, entry) {
  return html`<div class="sdc-field"><label class="sdc-field__label" for="${id}-label">What it is</label>
      <input class="sdc-field__input" id="${id}-label" name="label" maxlength="40" autocomplete="off" value="${entry ? entry.label : infoLabel}" aria-describedby="${id}-label-hint">
      <p class="sdc-field__hint" id="${id}-label-hint">For example, Patient portal or Pharmacy.</p></div>
    <div class="sdc-field"><label class="sdc-field__label" for="${id}-value">Web link or phone number</label>
      <input class="sdc-field__input" id="${id}-value" name="value" maxlength="300" autocomplete="off" autocapitalize="off" spellcheck="false" value="${entry ? (entry.kind === 'link' ? entry.href : entry.value) : ''}" aria-describedby="${id}-value-hint">
      <p class="sdc-field__hint" id="${id}-value-hint">Paste a link that starts with https, or type a phone number. No passwords, member numbers or names.</p></div>`;
}

function infoScreen() {
  const list = st().info;
  const unused = INFO_STARTERS.filter(n => !list.some(i => i.label.toLowerCase() === n.toLowerCase()));
  return {
    key: 'info', title: 'Quick info',
    body: html`<main class="ls-page">
      ${bar('info')}
      ${notice()}
      <h1 class="ls-title">Quick info</h1>
      <p class="ls-lede">The links and numbers you reach for in a hurry. For an emergency, call 911.</p>
      ${list.length ? html`<div class="ls-panel"><ul class="ls-list">${list.map(i => (infoEditing === i.id
        ? html`<li><form class="ls-stack ls-grow" data-submit="infoSave" data-id="${i.id}" novalidate>
            ${infoFields('info-' + i.id, i)}
            <div class="ls-row"><button class="sdc-btn sdc-btn--primary ls-grow">Save</button>
              <button class="sdc-btn ls-grow" type="button" data-act="infoEditClose">Never mind</button>
              <button class="sdc-btn ls-btn--danger ls-grow" type="button" id="info-rm-${i.id}" data-act="infoRemove" data-id="${i.id}" data-name="${i.label}">Remove</button></div>
          </form></li>`
        : html`<li>
            <div class="ls-list__main"><span class="ls-list__name">${i.label}</span><span class="ls-mute ls-info__value">${i.value}</span></div>
            ${safeHref(i) ? (i.kind === 'phone'
              ? html`<a class="sdc-btn sdc-btn--primary" href="${safeHref(i)}">${icon('phone')} Call<span class="sdc-u-sr-only"> ${i.label}, ${i.value}</span></a>`
              : html`<a class="sdc-btn sdc-btn--primary" href="${safeHref(i)}" target="_blank" rel="noopener noreferrer">${icon('external-link')} Open<span class="sdc-u-sr-only"> ${i.label}, ${i.value}, in a new tab</span></a>`) : ''}
            <button class="sdc-btn" id="info-edit-${i.id}" data-act="infoEditOpen" data-id="${i.id}">Edit<span class="sdc-u-sr-only"> ${i.label}</span></button>
          </li>`))}</ul></div>`
      : html`<div class="ls-panel"><p class="ls-subhead">Nothing saved yet.</p>
          <p class="ls-mute">Add the patient portal, the pharmacy and the doctor's office below, so neither of you has to go looking.</p></div>`}

      <section class="ls-panel" aria-labelledby="info-add-h"><h2 class="ls-heading" id="info-add-h">Add a link or a number</h2>
        ${unused.length ? html`<div class="ls-stack" role="group" aria-labelledby="info-start-h"><p class="ls-mute" id="info-start-h">Start with one of these:</p>
          <div class="ls-row">${unused.map((n, x) => html`<button class="sdc-btn" type="button" id="info-start-${x}" data-act="infoStart" data-label="${n}" aria-pressed="${infoLabel === n ? 'true' : 'false'}">${n}</button>`)}</div></div>` : ''}
        <form class="ls-stack" data-submit="infoSave" novalidate>
          ${infoFields('info-new', null)}
          <button class="sdc-btn sdc-btn--primary">${icon('plus')} Save</button></form>
      </section>
      <p class="ls-mute">Both parents see this page and can change it. A child's device never sees it.</p>
    </main>`
  };
}

// ---------- setup ----------

function setupScreen(step) {
  const n = SETUP.indexOf(step) + 2;
  const c = setupChild();
  const head = title => html`<p class="ls-steps">Step ${n} of 7</p><h1 class="ls-title">${title}</h1>${notice()}`;
  const next = (label = 'Next') => html`<button class="sdc-btn sdc-btn--primary ls-btn--lg" data-act="setupNext">${label}</button>`;
  let title, body;
  if (step === 'notify') {
    title = 'Turn on notifications';
    const blocker = pushBlocker();
    const on = st().push && permission() === 'granted';
    body = html`${head(title)}
      <p class="ls-lede">This is how you hear that a supply is running low. Each parent turns it on once on their own phone.</p>
      ${on ? html`<div class="ls-notice ls-notice--success" role="status">${icon('bell')}<p class="ls-notice__text">Notifications are on for this device.</p></div>${next()}`
        : blocker ? html`<div class="ls-notice ls-notice--warning">${icon('bell-off')}<p class="ls-notice__text">${blocker}</p></div>${next('Continue without them')}`
        : html`<button class="sdc-btn sdc-btn--primary ls-btn--lg" data-act="pushOn">${icon('bell')} Turn on notifications</button>
          <button class="sdc-btn ls-btn--quiet" data-act="setupNext">Skip for now</button>`}`;
  } else if (step === 'parent') {
    title = 'Invite the other parent';
    const p = member(setupParent);
    body = html`${head(title)}
      ${p ? html`<p class="ls-lede">Have ${p.name} scan this with their phone camera.</p>${linkSteps(p)}${linkPanel(p)}${next()}`
        : html`<p class="ls-lede">Both parents get every alert, and either one can mark it ordered.</p>
          <form class="ls-stack ls-stack--lg" data-submit="addParent" novalidate>
            <div class="sdc-field"><label class="sdc-field__label" for="parent-name">Their nickname</label>
              <input class="sdc-field__input" id="parent-name" name="name" maxlength="24" autocomplete="off" aria-describedby="parent-name-hint">
              <p class="sdc-field__hint" id="parent-name-hint">For example, Mom or Dad.</p></div>
            <button class="sdc-btn sdc-btn--primary ls-btn--lg">Make their link code</button>
          </form>
          <button class="sdc-btn ls-btn--quiet" data-act="setupNext">Skip. You can invite them later in Settings.</button>`}`;
  } else if (step === 'child') {
    title = 'Add your child';
    body = html`${head(title)}
      <form class="ls-stack ls-stack--lg" data-submit="addChild" novalidate>
        <div class="sdc-field"><label class="sdc-field__label" for="new-child">Child's nickname</label>
          <input class="sdc-field__input" id="new-child" name="name" maxlength="24" autocomplete="off" aria-describedby="new-child-hint">
          <p class="sdc-field__hint" id="new-child-hint">A nickname only, for example Kid 1. You can add more children later.</p></div>
        <button class="sdc-btn sdc-btn--primary ls-btn--lg">Next</button>
      </form>`;
  } else if (step === 'supplies') {
    title = `What can ${c.name} ask for?`;
    body = html`${head(title)}<form class="ls-stack ls-stack--lg" data-change="saveChild" data-id="${c.id}">${supplyChecklist(c)}</form>
      <p class="ls-mute">Need something that is not listed? Add custom supplies in Settings after setup.</p>${next()}`;
  } else if (step === 'schedule') {
    title = 'Check ins';
    body = html`${head(title)}<form class="ls-stack ls-stack--lg" data-change="saveChild" data-id="${c.id}">${scheduleList(c)}${quietEditor(c)}${readAloudChoice(c)}</form>${next()}`;
  } else {
    title = `Link ${c.name}'s device`;
    body = html`${head(title)}${linkSteps(c)}${linkPanel(c)}
      <p class="ls-mute">Lost or replaced a phone? Make a new code any time in Settings, and remove the old device there.</p>${next('Finish setup')}`;
  }
  return { key: 'setup:' + step, title, body: html`<main class="ls-page">${body}</main>` };
}

// ---------- settings ----------

function devicesList(m) {
  if (!m.devices.length) return html`<p class="ls-mute">No device linked yet.</p>`;
  return html`<ul class="ls-list">${m.devices.map(d => html`<li>
    <div class="ls-list__main"><span class="ls-list__name">${d.label}${d.current ? ' (this device)' : ''}</span>
      <span class="ls-mute">Linked ${when(d.createdAt)}. Last opened ${when(d.seenAt)}. Notifications ${d.push ? 'on' : 'off'}.</span></div>
    ${d.current ? '' : html`<button class="sdc-btn ls-btn--danger" id="rm-${d.id}" data-act="removeDevice" data-id="${d.id}" data-name="${m.name}'s ${d.label}">Remove<span class="sdc-u-sr-only"> ${m.name}'s ${d.label}</span></button>`}
  </li>`)}</ul>`;
}

function settingsScreen() {
  const s = st();
  const kids = children();
  const others = s.members.filter(m => m.role === 'parent');
  return {
    key: 'settings', title: 'Settings',
    body: html`<main class="ls-page">
      ${bar('settings')}
      ${notice()}
      <h1 class="ls-title">Settings</h1>

      <section class="ls-panel" aria-labelledby="set-kids"><h2 class="ls-heading" id="set-kids">Children</h2>
        <p class="ls-mute">Supplies, check ins, quiet hours, read aloud and linked devices are set for each child.</p>
        <ul class="ls-list">${kids.map(c => html`<li><a class="ls-list__link" href="#/child/${c.id}">
          <span class="ls-list__main"><span class="ls-list__name">${c.name}</span>
          <span class="ls-mute">${plural(c.supplies.filter(x => x.on).length, 'supply', 'supplies')} on. ${plural(c.devices.length, 'device', 'devices')} linked.</span></span>${icon('chevron-right')}</a></li>`)}</ul>
        <form class="ls-row" data-submit="addChild" novalidate>
          <div class="sdc-field ls-grow"><label class="sdc-field__label" for="new-child">Add a child (nickname only)</label>
            <input class="sdc-field__input" id="new-child" name="name" maxlength="24" autocomplete="off"></div>
          <button class="sdc-btn">${icon('plus')} Add child</button></form>
      </section>

      <section class="ls-panel" aria-labelledby="set-parents"><h2 class="ls-heading" id="set-parents">Parents</h2>
        <ul class="ls-list">${others.map(p => html`<li>
          <div class="ls-list__main"><span class="ls-list__name">${p.name}${p.id === s.me.id ? ' (you)' : ''}</span><span class="ls-mute">${plural(p.devices.length, 'device', 'devices')} linked.</span></div>
          <a class="sdc-btn" href="#/link/${p.id}">${icon('qrcode')} Link a device<span class="sdc-u-sr-only"> for ${p.name}</span></a>
          ${p.id === s.me.id ? '' : html`<button class="sdc-btn ls-btn--danger" id="rmm-${p.id}" data-act="removeMember" data-id="${p.id}" data-name="${p.name}">Remove<span class="sdc-u-sr-only"> ${p.name}</span></button>`}
        </li>`)}</ul>
        <form class="ls-row" data-submit="addParent" novalidate>
          <div class="sdc-field ls-grow"><label class="sdc-field__label" for="parent-name">Invite a parent (nickname only)</label>
            <input class="sdc-field__input" id="parent-name" name="name" maxlength="24" autocomplete="off"></div>
          <button class="sdc-btn">${icon('plus')} Invite</button></form>
      </section>

      <section class="ls-panel" aria-labelledby="set-items"><h2 class="ls-heading" id="set-items">Custom supplies</h2>
        <p class="ls-mute">Anything that is not in the built in list goes here. Add it, then turn it on for a child.</p>
        ${s.customItems.length ? html`<ul class="ls-list">${s.customItems.map(i => html`<li>
          <div class="ls-list__main"><span class="ls-supply__name">${icon(i.icon)} ${i.label}</span></div>
          <button class="sdc-btn ls-btn--danger" id="rmi-${i.id}" data-act="removeItem" data-id="${i.id}" data-name="${i.label}">Remove<span class="sdc-u-sr-only"> ${i.label}</span></button></li>`)}</ul>` : ''}
        <form class="ls-stack" data-submit="addItem" novalidate>
          <div class="sdc-field"><label class="sdc-field__label" for="item-label">Name of the supply</label>
            <input class="sdc-field__input" id="item-label" name="label" maxlength="24" autocomplete="off" aria-describedby="item-label-hint">
            <p class="sdc-field__hint" id="item-label-hint">A plain name, for example Juice boxes. No brand names needed.</p></div>
          <fieldset class="sdc-fieldset ls-icon-pick"><legend class="ls-subhead">Icon</legend>
            <div class="sdc-choice-set">${ICON_CHOICES.map((c, n) => html`<label class="sdc-choice"><input type="radio" name="icon" id="icon-${c.icon}" value="${c.icon}" ${n === 0 ? html`checked` : ''}>${icon(c.icon)}<span class="sdc-u-sr-only">${c.name}</span></label>`)}</div></fieldset>
          <button class="sdc-btn">${icon('plus')} Add supply</button></form>
      </section>

      <section class="ls-panel" aria-labelledby="set-remind"><h2 class="ls-heading" id="set-remind">Reminders</h2>
        <div class="sdc-field"><label class="sdc-field__label" for="remind">If nobody marks a request ordered, remind both parents</label>
          <select class="sdc-select" id="remind" data-change="setReminder">${REMINDER_HOURS.map(h => html`<option value="${h}" ${s.reminderHours === h ? html`selected` : ''}>${h === 1 ? 'After 1 hour' : `After ${h} hours`}</option>`)}</select>
          <p class="sdc-field__hint">It repeats at the same pace, up to six times.</p></div>
      </section>

      <section class="ls-panel" aria-labelledby="set-device"><h2 class="ls-heading" id="set-device">This device</h2>
        ${pushPanel()}
        <form class="ls-row" data-submit="renameSelf" novalidate>
          <div class="sdc-field ls-grow"><label class="sdc-field__label" for="self-name">Your nickname</label>
            <input class="sdc-field__input" id="self-name" name="name" maxlength="24" autocomplete="off" value="${s.me.name}"></div>
          <button class="sdc-btn">Save</button></form>
      </section>

      <section class="ls-panel" aria-labelledby="set-devices"><h2 class="ls-heading" id="set-devices">Linked devices</h2>
        <p class="ls-mute">If a phone is lost or replaced, remove it here and link the new one with a fresh code.</p>
        ${s.members.map(m => html`<div class="ls-stack"><h3 class="ls-subhead">${m.name}</h3>${devicesList(m)}</div>`)}
      </section>

      <section class="ls-panel" aria-labelledby="set-reset"><h2 class="ls-heading" id="set-reset">Start over</h2>
        <p><strong>Reset this device</strong> unlinks only this phone and clears what Low Supply saved on it. Everyone else carries on.</p>
        <button class="sdc-btn" id="reset-device" data-act="resetDevice">${icon('refresh')} Reset this device</button>
        <p><strong>Delete the family</strong> erases everything for everyone: children, parents, supplies, requests and every linked device. Use it if setup went wrong and you want a clean start.</p>
        <button class="sdc-btn ls-btn--danger" id="delete-family" data-act="deleteFamily">${icon('trash')} Delete the family and start over</button>
      </section>
    </main>`
  };
}

function childScreen(c) {
  return {
    key: 'child:' + c.id, title: c.name,
    body: html`<main class="ls-page">
      ${bar('settings')}
      <a class="ls-back" href="#/settings">${icon('arrow-left')} Settings</a>
      ${notice()}
      <h1 class="ls-title">${c.name}</h1>
      <form class="ls-stack ls-stack--lg" data-change="saveChild" data-id="${c.id}" data-submit="saveChild" novalidate>
        <div class="sdc-field"><label class="sdc-field__label" for="child-name">Nickname</label>
          <input class="sdc-field__input" id="child-name" maxlength="24" autocomplete="off" value="${c.name}"></div>
        <div class="ls-panel">${supplyChecklist(c)}</div>
        <div class="ls-panel">${scheduleList(c)}</div>
        <div class="ls-panel">${quietEditor(c)}</div>
        <div class="ls-panel">${readAloudChoice(c)}</div>
      </form>
      <p class="ls-mute">Changes save as you make them.</p>
      <section class="ls-panel" aria-labelledby="child-dev"><h2 class="ls-heading" id="child-dev">${c.name}'s devices</h2>
        ${devicesList(c)}
        <a class="sdc-btn sdc-btn--primary" href="#/link/${c.id}">${icon('qrcode')} Link a device</a></section>
      <button class="sdc-btn ls-btn--danger" id="rmm-${c.id}" data-act="removeMember" data-id="${c.id}" data-name="${c.name}">${icon('trash')} Remove ${c.name}</button>
    </main>`
  };
}

function linkScreen(m) {
  const back = m.role === 'child' ? `#/child/${m.id}` : '#/settings';
  return {
    key: 'link:' + m.id, title: `Link a device for ${m.name}`,
    body: html`<main class="ls-page">
      ${bar('settings')}
      <a class="ls-back" href="${back}">${icon('arrow-left')} Back</a>
      ${notice()}
      <h1 class="ls-title">Link a device for ${m.name}</h1>
      ${linkSteps(m)}
      ${linkPanel(m)}
    </main>`
  };
}

// ---------- actions ----------

function nextStep() {
  const i = SETUP.indexOf(setupStep());
  if (i === SETUP.length - 1) {
    write('ls.setup', null); write('ls.setupChild', null);
    S.notice = { tone: 'success', text: 'Setup is done. Add another child or a custom supply any time in Settings.' };
    location.hash = '#/';
  } else write('ls.setup', SETUP[i + 1]);
}

// After a card moves to another list, the button that was tapped is gone, so focus
// goes back to the top of the screen where the message is.
const focusHeading = () => { const h = document.querySelector('#app h1'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } };

export const actions = {
  async order(el) {
    const r = [...st().requests, ...st().waiting].find(x => x.id === el.dataset.id);
    await op({ type: 'order', requestId: el.dataset.id });
    const word = r?.wait ? 'ready' : 'ordered';
    const text = r ? `Marked ${word}. ${r.child} was told.` : `Marked ${word}.`;
    if (delaying === el.dataset.id) delaying = null;
    S.notice = { tone: 'success', text }; announce(text);
    return focusHeading;
  },
  infoStart(el) {
    infoLabel = el.dataset.label;
    return () => document.getElementById('info-new-value')?.focus();
  },
  infoEditOpen(el) {
    infoEditing = el.dataset.id;
    return () => document.getElementById(`info-${el.dataset.id}-label`)?.focus();
  },
  infoEditClose() {
    const id = infoEditing;
    infoEditing = null;
    return () => document.getElementById('info-edit-' + id)?.focus();
  },
  async infoSave(form) {
    const id = form.dataset.id, label = form.elements.label.value.trim(), value = form.elements.value.value.trim();
    if (!label) { form.elements.label.focus(); throw new Error('Type what it is, for example Pharmacy.'); }
    if (!value) { form.elements.value.focus(); throw new Error('Type a web link or a phone number.'); }
    if (id) { await op({ type: 'updateInfo', id, label, value }); infoEditing = null; }
    else { await op({ type: 'addInfo', label, value }); infoLabel = ''; }
    const text = `${label} was saved.`;
    S.notice = { tone: 'success', text }; announce(text);
    return focusHeading;
  },
  async infoRemove(el) {
    if (!await confirmDialog(`Remove ${el.dataset.name}?`, 'It comes off this page for both parents.', 'Remove')) return;
    await op({ type: 'removeInfo', id: el.dataset.id });
    infoEditing = null;
    const text = `${el.dataset.name} was removed.`;
    S.notice = { tone: 'success', text }; announce(text);
    return focusHeading;
  },
  delayOpen(el) {
    delaying = el.dataset.id;
    return () => document.getElementById('ready-' + el.dataset.id)?.focus();
  },
  delayClose() {
    const id = delaying;
    delaying = null;
    return () => document.getElementById('delay-' + id)?.focus();
  },
  async delaySave(form) {
    const id = form.dataset.id, readyOn = form.elements.readyOn.value;
    const r = [...st().requests, ...st().waiting].find(x => x.id === id);
    if (!readyOn) { form.elements.readyOn.focus(); throw new Error('Pick the date it should be ready.'); }
    await op({ type: 'delay', requestId: id, readyOn });
    delaying = null;
    const text = `Saved. ${r ? r.child : 'Your child'} was told it is ordered but not ready until ${dayText(readyOn)}. You will both get a reminder that day.`;
    S.notice = { tone: 'success', text }; announce(text);
    return focusHeading;
  },
  async reopen(el) { await op({ type: 'reopen', requestId: el.dataset.id }); announce('Back on the list.'); },

  async pushOn() {
    await enablePush();
    S.notice = { tone: 'success', text: 'Notifications are on for this device.' };
    if (setupStep() === 'notify') nextStep();
  },
  async pushOff() { await disablePush(); announce('Notifications are off for this device.'); },
  async testPush() { await op({ type: 'testPush' }); S.notice = { tone: 'success', text: 'Test sent. It should arrive in a few seconds.' }; },

  setupNext() {
    if (setupStep() === 'supplies' && !setupChild().supplies.some(s => s.on)) throw new Error('Turn on at least one supply.');
    nextStep();
  },
  async addParent(form) {
    const name = form.elements.name.value.trim();
    if (!name) { form.elements.name.focus(); throw new Error('Type their nickname.'); }
    const { id } = await op({ type: 'addParent', name });
    if (setupStep()) { setupParent = id; await makeInvite(id); } else location.hash = '#/link/' + id;
  },
  async addChild(form) {
    const name = form.elements.name.value.trim();
    if (!name) { form.elements.name.focus(); throw new Error('Type a nickname for your child.'); }
    const { id } = await op({ type: 'addChild', name });
    if (setupStep()) { write('ls.setupChild', id); nextStep(); } else location.hash = '#/child/' + id;
  },
  async saveChild(form, event) {
    if (event.type === 'submit') return;
    const c = member(form.dataset.id);
    await op(collectChild(form, c));
    announce('Saved.');
  },
  async newCode(el) { await makeInvite(el.dataset.id); announce('New code made.'); },

  async removeDevice(el) {
    if (!await confirmDialog('Remove this device?', `${el.dataset.name} will stop working with Low Supply until it is linked again with a new code.`, 'Remove device')) return;
    await op({ type: 'removeDevice', id: el.dataset.id });
    announce('Device removed.');
  },
  async removeMember(el) {
    if (!await confirmDialog(`Remove ${el.dataset.name}?`, `This removes ${el.dataset.name}, their linked devices and their requests. It cannot be undone.`, `Remove ${el.dataset.name}`)) return;
    await op({ type: 'removeMember', id: el.dataset.id });
    S.notice = { tone: 'success', text: `${el.dataset.name} was removed.` };
    location.hash = '#/settings';
  },
  async addItem(form) {
    const label = form.elements.label.value.trim();
    if (!label) { form.elements.label.focus(); throw new Error('Type a name for the supply.'); }
    await op({ type: 'addItem', label, icon: form.elements.icon.value });
    S.notice = { tone: 'success', text: `${label} was added. Turn it on for a child under Children.` };
  },
  async removeItem(el) {
    if (!await confirmDialog(`Remove ${el.dataset.name}?`, 'It comes off every child\'s screen, along with any open request for it.', 'Remove supply')) return;
    await op({ type: 'removeItem', id: el.dataset.id });
  },
  async resetDevice() {
    if (!await confirmDialog('Reset this device?', 'This phone is unlinked and Low Supply forgets it. You will need a new code from another parent device to link it again.', 'Reset this device')) return;
    await op({ type: 'unlinkSelf' });   // refuses if this is the only parent device, and says why
    await resetDevice({ tellServer: false });
  },
  async deleteFamily() {
    if (!await confirmDialog('Delete the whole family?', 'Every child, parent, supply, request and linked device is erased, on every phone. This cannot be undone. You can set up a new family right after.', 'Delete everything')) return;
    await op({ type: 'deleteFamily' });
    await resetDevice({ tellServer: false });
  },
  async setReminder(el) { await op({ type: 'setReminder', hours: Number(el.value) }); announce('Saved.'); },
  async renameSelf(form) { await op({ type: 'renameSelf', name: form.elements.name.value }); S.notice = { tone: 'success', text: 'Saved.' }; }
};
