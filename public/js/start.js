// Before a device is linked: add to Home Screen, then start a family or join one.
import { S, api, html, icon, notice, setLinked, write, isIOS, isStandalone, deviceLabel, announce } from './ui.js';
import { prettyCode, codeFrom, scannerMarkup, startScanner } from './link.js';

let skipInstall = false;
let scanning = false;
let stopScan = null;

// localhost is this Mac (and the iPhone simulator), where there is nothing to install.
export const needsInstall = () => isIOS && !isStandalone() && !skipInstall && location.hostname !== 'localhost';

export function screen(path) {
  if (needsInstall()) return installScreen();
  if (path === '/new') return newScreen();
  if (path === '/join') return joinScreen();
  return {
    key: 'welcome', title: 'Welcome',
    body: html`<main class="ls-page">
      <h1 class="ls-title">Low Supply</h1>
      ${notice()}
      <p class="ls-lede">A child taps what is running low. Both parents get told. One of you marks it ordered.</p>
      <div class="ls-stack">
        ${S.config.createLocked ? '' : html`<a class="sdc-btn sdc-btn--primary ls-btn--lg" href="#/new">Set up a new family</a>`}
        <a class="sdc-btn ${S.config.createLocked ? 'sdc-btn--primary' : ''} ls-btn--lg" href="#/join">Link this device to a family</a>
      </div>
      ${S.config.createLocked ? html`<p class="ls-mute">A family is already set up here. To join it, link this device with a code from a parent's phone.</p>` : ''}
      <p class="ls-mute">No accounts and no real names. People are nicknames, and devices link with a code.</p>
    </main>`
  };
}

function installScreen() {
  return {
    key: 'install', title: 'Add to Home Screen',
    body: html`<main class="ls-page">
      <h1 class="ls-title">First, add Low Supply to the Home Screen</h1>
      <p class="ls-lede">On iPhone and iPad, notifications only work when the app is opened from the Home Screen. Do this once.</p>
      <ol class="ls-howto">
        <li>Tap the Share button ${icon('share-2')}. If you do not see it, tap the three dots first.</li>
        <li>Scroll down and tap <strong>Add to Home Screen</strong> ${icon('square-plus')}.</li>
        <li>Tap <strong>Add</strong>.</li>
        <li>Close this page and open <strong>Low Supply</strong> from the Home Screen.</li>
      </ol>
      ${S.joinCode ? html`<div class="ls-panel">
        <p>Your link code should come along by itself. If the app asks for it, type this:</p>
        <p class="ls-code">${prettyCode(S.joinCode)}</p></div>` : ''}
      <button class="sdc-btn ls-btn--quiet" data-act="skipInstall">Keep going in the browser, without notifications</button>
    </main>`
  };
}

function newScreen() {
  return {
    key: 'new', title: 'Set up a new family',
    body: html`<main class="ls-page">
      <a class="ls-back" href="#/">${icon('arrow-left')} Back</a>
      <p class="ls-steps">Step 1 of 7</p>
      <h1 class="ls-title">Set up a new family</h1>
      ${notice()}
      <p>This makes a private family space. No account, no email, no real names.</p>
      <form class="ls-stack ls-stack--lg" data-submit="create" novalidate>
        <div class="sdc-field">
          <label class="sdc-field__label" for="my-name">Your nickname</label>
          <input class="sdc-field__input" id="my-name" name="name" maxlength="24" autocomplete="off" required aria-describedby="my-name-hint">
          <p class="sdc-field__hint" id="my-name-hint">What your child calls you. For example, Dad or Mom.</p>
        </div>
        ${S.config.setupCode ? html`<div class="sdc-field">
          <label class="sdc-field__label" for="setup-code">Setup code</label>
          <input class="sdc-field__input" id="setup-code" name="setupCode" type="password" autocomplete="off" required aria-describedby="setup-code-hint">
          <p class="sdc-field__hint" id="setup-code-hint">The code chosen when this app was put online. It keeps strangers from starting families here.</p>
        </div>` : ''}
        <button class="sdc-btn sdc-btn--primary ls-btn--lg">Create the family</button>
      </form>
    </main>`
  };
}

function joinScreen() {
  const canScan = !!navigator.mediaDevices?.getUserMedia;
  return {
    key: 'join', title: 'Link this device',
    body: html`<main class="ls-page">
      <a class="ls-back" href="#/">${icon('arrow-left')} Back</a>
      <h1 class="ls-title">Link this device</h1>
      ${notice()}
      <p>On a parent's phone, open Low Supply, go to Settings, and choose the person this device is for. It shows a code.</p>
      ${scanning ? scannerMarkup() : canScan ? html`<button class="sdc-btn sdc-btn--primary ls-btn--lg" data-act="scanStart">${icon('camera')} Scan the code</button>` : ''}
      <form class="ls-stack" data-submit="join" novalidate>
        <div class="sdc-field">
          <label class="sdc-field__label" for="join-code">Or type the code</label>
          <input class="sdc-field__input" id="join-code" name="code" maxlength="9" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${S.joinCode ? prettyCode(S.joinCode) : ''}" aria-describedby="join-code-hint">
          <p class="sdc-field__hint" id="join-code-hint">Eight letters and numbers, like ABCD-2345.</p>
        </div>
        <button class="sdc-btn ${canScan && !scanning ? '' : 'sdc-btn--primary'} ls-btn--lg">Link with this code</button>
      </form>
    </main>`
  };
}

async function join(code) {
  if (stopScan) { stopScan(); stopScan = null; }
  scanning = false;
  const clean = codeFrom(code) || '';
  if (clean.length !== 8) throw new Error('Type the eight letters and numbers of the code.');
  try {
    setLinked(await api('POST', 'join', { code: clean, label: deviceLabel() }));
  } catch (e) {
    S.joinCode = null;
    if (location.hash !== '#/join') location.hash = '#/join';
    throw e;
  }
  location.hash = '#/';
  announce('This device is linked.');
}

export const actions = {
  skipInstall() { skipInstall = true; },
  async create(form) {
    const name = form.elements.name.value.trim();
    if (!name) { form.elements.name.focus(); throw new Error('Type your nickname.'); }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setLinked(await api('POST', 'create', { name, tz, label: deviceLabel(), setupCode: form.elements.setupCode?.value }));
    write('ls.setup', 'notify');
    location.hash = '#/';
  },
  join: form => join(form.elements.code.value),
  joinWithCode: () => join(S.joinCode),
  scanStart() {
    scanning = true;
    return async () => {
      try {
        stopScan = await startScanner(document.getElementById('scan-video'), code => {
          S.joinCode = code;
          join(code).catch(err => { S.notice = { tone: 'error', text: err.message }; }).finally(() => window.dispatchEvent(new Event('ls:render')));
        });
      } catch {
        scanning = false;
        S.notice = { tone: 'error', text: 'The camera could not be used. Type the code instead.' };
        window.dispatchEvent(new Event('ls:render'));
      }
    };
  },
  scanStop() { if (stopScan) stopScan(); stopScan = null; scanning = false; }
};
