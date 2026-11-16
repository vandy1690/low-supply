// The child app. The whole screen is buttons, and as few words as possible.
import { S, op, html, icon, announce, read, write } from './ui.js';
import { LEVELS } from './catalog.js';
import { say, setSpeech, stop as stopSpeech } from './speech.js';
import { enablePush, pushBlocker, permission } from './push.js';

const QUESTION = 'Are you running low on anything?';

const st = () => S.state;
const supply = id => st().supplies.find(s => s.itemId === id);

// Two supplies split the screen, four make two by two, and so on.
function columns(n) {
  if (window.matchMedia('(orientation: landscape)').matches) return n <= 3 ? n : n === 4 ? 2 : n <= 6 ? 3 : 4;
  return n <= 3 ? 1 : n <= 8 ? 2 : 3;
}
function gridStyle(n) { return html`style="--cols:${columns(n)}"`; }
function lastSpan(n, i) {
  const cols = columns(n), rest = n % cols;
  return i === n - 1 && rest ? html`style="grid-column: span ${cols - rest + 1}"` : '';
}

const speaker = () => html`<button class="ls-speaker" id="speaker" data-act="speaker" aria-pressed="${st().me.readAloud ? 'true' : 'false'}" aria-label="Read aloud">${icon(st().me.readAloud ? 'volume' : 'volume-off')}</button>`;
// Anything that went wrong is said on the child's screen in full size, and spoken.
const errorNote = () => {
  const n = S.notice;
  if (!n) return '';
  n.shown = true;
  return html`<div class="ls-notice ls-notice--${n.tone === 'error' ? 'error' : 'warning'}" role="alert">${icon('alert-triangle')}<p class="ls-notice__text">${n.text}</p></div>`;
};

const wantsPushAsk = () => !read('ls.pushAsked') && !st().push && !pushBlocker() && permission() === 'default';

export function screen(path) {
  setSpeech(st().me.readAloud);
  if (wantsPushAsk()) return pushScreen();
  if (path.startsWith('/s/') && supply(path.slice(3))) return supplyScreen(supply(path.slice(3)));
  const due = st().due.map(supply).filter(Boolean);
  if (due.length) return checkinScreen(due);
  return gridScreen();
}

export function entered(path, key) {
  if (key === 'kid:checkin') say(QUESTION);
  else if (key === 'kid:grid' && st().notes.length) say(noteText(st().notes[0]));
  else if (key.startsWith('kid:s:') && supply(key.slice(6))?.wait) say(waitText(supply(key.slice(6))));
}
export function onError(err) { say(err.message); }

// Waiting on a delayed order. The child never sees the date, only a countdown that
// drops by one each day: days left are easier for a young child than a calendar.
// Nothing here promises the day. A pharmacy's date is a best guess, so it "should be" ready.
function sleepsText(w) {
  if (w.sleeps > 1) return `${w.sleeps} days until ready`;
  if (w.sleeps === 1) return '1 day until ready';
  if (w.sleeps === 0) return 'It should be ready today';
  return `${w.by} is checking on it`;
}
const waitShort = w => (w.sleeps > 0 ? sleepsText(w) : w.sleeps === 0 ? 'Ready today' : 'Checking on it');
const waitHead = w => (w.sleeps > 0 ? 'Ordered, but not ready yet' : w.sleeps === 0 ? 'Ordered' : 'Ordered, but it is late');
const waitText = s => `${s.say}. ${waitHead(s.wait)}. ${sleepsText(s.wait)}.`;
// One sun for each day left, so the count can be seen without reading it.
const suns = n => (n >= 1 && n <= 10 ? html`<span class="ls-days" aria-hidden="true">${Array.from({ length: n }, () => icon('sun'))}</span>` : '');

function noteText(n) {
  if (n.kind === 'ready') return `Good news. Your ${n.label} is ready.`;
  if (n.kind !== 'wait') return `${n.by} ordered your ${n.label}.`;
  return `${n.by} ordered your ${n.label}. ${sleepsText(n)}.`;
}

function gridScreen() {
  const list = st().supplies;
  return {
    key: 'kid:grid', title: st().me.name,
    body: html`<main class="ls-kid">
      ${speaker()}
      <h1 class="sdc-u-sr-only">Low Supply. Tap what you need.</h1>
      ${errorNote()}
      ${st().notes.map(n => html`<div class="ls-notice ${n.kind === 'wait' ? 'ls-notice--wait' : 'ls-notice--success'}" role="status">${icon(n.kind === 'wait' ? 'calendar-event' : 'circle-check')}
        <p class="ls-notice__text">${noteText(n)}</p>
        <button class="sdc-btn sdc-btn--primary" id="seen-${n.requestId}" data-act="seen" data-id="${n.requestId}">OK</button></div>`)}
      ${list.length ? html`<ul class="ls-grid" ${gridStyle(list.length)}>${list.map((s, i) => html`<li ${lastSpan(list.length, i)}>
        <a class="ls-tile ${i < columns(list.length) ? 'ls-tile--top' : ''} ${s.wait ? 'ls-tile--wait' : s.open ? `ls-tile--${s.open}` : ''}" id="tile-${s.itemId}" href="#/s/${s.itemId}" data-act="sayName" data-say="${s.say}">
          ${icon(s.icon)}<span>${s.label}</span>
          ${s.wait ? html`<span class="ls-tile__status">${icon(s.wait.sleeps > 0 ? 'sun' : 'calendar-event')} Ordered. ${waitShort(s.wait)}</span>`
            : s.open ? html`<span class="ls-tile__status">${icon(s.open === 'out' ? 'alert-octagon' : 'alert-triangle')} Asked: ${LEVELS[s.open]}</span>` : ''}
        </a></li>`)}</ul>`
        : html`<p class="ls-kid__ask">No supplies are turned on yet. Ask a parent to turn them on.</p>`}
    </main>`
  };
}

function supplyScreen(s) {
  const btn = (lvl, glyph) => {
    const on = s.open === lvl;
    return html`<button class="ls-alert ls-alert--${lvl} ${on ? 'is-on' : ''}" id="btn-${lvl}" data-act="level" data-level="${lvl}" data-id="${s.itemId}">
      ${icon(on ? 'circle-check' : glyph)}
      <span>${on ? `Cancel ${LEVELS[lvl].replace('Running', 'running')}` : LEVELS[lvl]}</span>
      ${on ? html`<span class="ls-alert__sub">Your parents know. Tap to cancel.</span>` : ''}
    </button>`;
  };
  return {
    key: 'kid:s:' + s.itemId, title: s.label,
    body: html`<main class="ls-kid">
      ${speaker()}
      <div class="ls-kid__head">
        <a class="ls-kid__back" href="#/" data-act="sayName" data-say="Back">${icon('arrow-left')}<span>Back</span></a>
        <h1 class="ls-kid__title">${s.label}</h1>
      </div>
      ${errorNote()}
      ${s.wait ? html`<div class="ls-wait" id="wait-${s.itemId}">
        <p class="ls-wait__label">${icon('calendar-event')} ${waitHead(s.wait)}</p>
        ${suns(s.wait.sleeps)}
        ${s.wait.sleeps > 0
          ? html`<p class="ls-wait__count"><span class="ls-wait__number">${s.wait.sleeps}</span> ${s.wait.sleeps === 1 ? 'day until ready' : 'days until ready'}</p>`
          : html`<p class="ls-wait__count">${sleepsText(s.wait)}</p>`}
      </div>` : ''}
      <div class="ls-alerts">${btn('low', 'alert-triangle')}${btn('out', 'alert-octagon')}</div>
    </main>`
  };
}

function checkinScreen(due) {
  const n = due.length + 1;
  return {
    key: 'kid:checkin', title: 'Check in',
    body: html`<main class="ls-kid">
      ${speaker()}
      <h1 class="ls-kid__ask">${QUESTION}</h1>
      ${errorNote()}
      <ul class="ls-grid" ${gridStyle(n)}>
        ${due.map((s, i) => html`<li ${lastSpan(n, i)}><button class="ls-tile" id="due-${s.itemId}" data-act="checkinPick" data-id="${s.itemId}" data-say="${s.say}">${icon(s.icon)}<span>${s.label}</span></button></li>`)}
        <li ${lastSpan(n, n - 1)}><button class="ls-tile ls-tile--plain" id="all-good" data-act="allGood">${icon('check')}<span>No, I am all good</span></button></li>
      </ul>
    </main>`
  };
}

function pushScreen() {
  return {
    key: 'kid:push', title: 'Notes from your parents',
    body: html`<main class="ls-kid">
      <h1 class="ls-kid__ask">Get a note when a parent orders your supplies?</h1>
      ${errorNote()}
      <div class="ls-alerts">
        <button class="ls-tile ls-tile--plain" id="push-yes" data-act="pushYes">${icon('bell')}<span>Yes, turn on</span></button>
        <button class="ls-tile" id="push-no" data-act="pushNo">${icon('bell-off')}<span>Not now</span></button>
      </div>
    </main>`
  };
}

export const actions = {
  sayName(el) { say(el.dataset.say); },
  async level(el) {
    const s = supply(el.dataset.id), lvl = el.dataset.level;
    let text;
    if (s.open === lvl) {
      await op({ type: 'cancel', itemId: s.itemId });
      text = `Canceled. Your parents were told you do not need ${s.say} now.`;
    } else {
      await op({ type: 'request', itemId: s.itemId, level: lvl });
      text = `${LEVELS[lvl]}. Your parents were told.`;
    }
    announce(text); say(text);
  },
  async seen(el) { stopSpeech(); await op({ type: 'seenNote', requestId: el.dataset.id }); },
  async checkinPick(el) {
    say(el.dataset.say);
    await op({ type: 'checkinDone' });
    location.hash = '#/s/' + el.dataset.id;
  },
  async allGood() {
    await op({ type: 'checkinDone' });
    const text = 'OK. Thank you.';
    announce(text); say(text);
  },
  async speaker() {
    const on = !st().me.readAloud;
    await op({ type: 'setReadAloud', on });
    setSpeech(on);
    announce(on ? 'Read aloud is on.' : 'Read aloud is off.');
    if (on) say('Read aloud is on.');
  },
  async pushYes() {
    write('ls.pushAsked', '1');
    await enablePush();
  },
  pushNo() { write('ls.pushAsked', '1'); }
};
