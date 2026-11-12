// Builds the private showcase page for clients.stevendesignco.com/low-supply from
// docs/WALKTHROUGH.md, the demo video and the screenshots, so the page and the repo
// docs never tell two stories.
//   node scripts/sync-showcase.mjs
// Then, in private-sites:  python3 build.py clients   and the vercel deploy.
// The page stays shut until GATE_LOW_SUPPLY is set on the sdc-clients project.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sites = path.join(os.homedir(), 'Documents/claude/LLC/LLC/private-sites');
const out = path.join(sites, 'clients/site/low-supply');
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rich = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

// Parts and steps come straight from the walkthrough.
const md = readFileSync(path.join(root, 'docs/WALKTHROUGH.md'), 'utf8');
const parts = [];
for (const block of md.split(/^## /m).slice(1)) {
  const [heading, ...rest] = block.split('\n');
  if (!/^Part \d/.test(heading)) continue;
  const steps = rest.join('\n').split(/^### /m).slice(1).map(s => {
    const [title, ...body] = s.split('\n');
    const img = body.join('\n').match(/<img src="screenshots\/([^"]+)" alt="([^"]+)"/);
    const text = body.filter(l => l.trim() && !l.startsWith('<img')).join(' ');
    return { n: title.match(/^(\d+)\./)[1], title: title.replace(/^\d+\.\s*/, ''), text, file: img[1], alt: img[2] };
  });
  parts.push({ title: heading.replace(/^Part \d+:\s*/, ''), steps });
}

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'img'), { recursive: true });
cpSync(path.join(root, 'docs/demo/low-supply-demo.mp4'), path.join(out, 'low-supply-demo.mp4'));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '12', '-i', path.join(root, 'docs/demo/low-supply-demo.mp4'),
  '-frames:v', '1', '-q:v', '3', path.join(out, 'img/poster.jpg')]);
for (const p of parts) for (const s of p.steps) cpSync(path.join(root, 'docs/screenshots', s.file), path.join(out, 'img', s.file));

const facts = [
  ['No accounts', 'People are nicknames. A device joins the family with a one time code, by camera or typed in.'],
  ['Made for a child', 'The child sees one large button for each supply, with read aloud. Nothing to read, nothing to type.'],
  ['Both parents, one list', 'Every request reaches both parents. Either one marks it ordered, and it clears for both.'],
  ['The child hears back', 'A note tells the child who ordered it, so nobody has to ask twice.'],
  ['Accessible', 'Built to WCAG 2.2 AA and checked with automated accessibility tests on every screen.'],
  ['Small on purpose', 'Plain HTML, CSS and JavaScript on my own design system, with a small backend and web push. No app store.']
];

const page = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<!--SDC:HEAD--><!--/SDC:HEAD-->
<title>Low Supply</title>
<meta name="description" content="A family web app: a child taps a supply that is running low and both parents get told.">
<style>
  .lsp-hero { padding-top: var(--sdc-space-3xl); }
  .lsp-title { font-size: var(--sdc-text-display-1); line-height: 1; margin: 0 0 var(--sdc-space-md); }
  .lsp-lede { font-size: var(--sdc-text-deck); line-height: 1.5; max-width: 52ch; margin: 0 0 var(--sdc-space-sm); }
  .lsp-meta { font-size: var(--sdc-text-body-sm); color: var(--sdc-text-mute); margin: 0; max-width: 62ch; }
  .lsp-h2 { font-family: var(--sdc-font-display); font-size: var(--sdc-text-display-2); font-weight: 400; font-synthesis: none;
    font-variation-settings: "wdth" 100, "slnt" 0; line-height: 1.04; margin: 0 0 var(--sdc-space-lg); }
  .lsp-video { width: auto; padding: var(--sdc-space-md); max-width: 34rem; }
  .lsp-video video { display: block; width: 100%; height: auto; border-radius: var(--sdc-radius-sm); }
  .lsp-note { font-size: var(--sdc-text-body-sm); color: var(--sdc-text-mute); margin: var(--sdc-space-sm) 0 0; max-width: 62ch; }
  .lsp-facts { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sdc-space-md);
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
  .lsp-fact { width: auto; padding: var(--sdc-space-lg); height: 100%; box-sizing: border-box; }
  .lsp-fact h3 { font-size: var(--sdc-text-subheading); margin: 0 0 var(--sdc-space-xs); }
  .lsp-fact p { font-size: var(--sdc-text-body-sm); line-height: 1.55; margin: 0; }
  .lsp-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sdc-space-xl) var(--sdc-space-lg);
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); }
  .lsp-step figure { margin: 0; }
  .lsp-step img { display: block; width: 100%; height: auto; border: 1px solid var(--sdc-rule-strong);
    border-radius: var(--sdc-radius); box-shadow: var(--sdc-shadow-card); }
  .lsp-step h3 { font-size: var(--sdc-text-subheading); margin: var(--sdc-space-md) 0 var(--sdc-space-xs); }
  .lsp-step p { font-size: var(--sdc-text-body-sm); line-height: 1.55; margin: 0; }
  .lsp-step__n { color: var(--sdc-text-mute); font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<!--SDC:HEADER--><!--/SDC:HEADER-->
<main id="main" tabindex="-1">

<sdc-section class="lsp-hero">
  <sdc-layout-container width="narrow">
    <p class="sdc-eyebrow sdc-eyebrow--mute">Personal project, November 2026</p>
    <h1 class="lsp-title sdc-display">Low Supply</h1>
    <p class="lsp-lede">A child with type 1 diabetes taps a supply that is running low. Both parents get told. One of them marks it ordered, and the child hears back.</p>
    <p class="lsp-meta">I designed and built this for my own family. It is a web app that installs to a phone's Home Screen. It tracks supplies only: no glucose numbers and no dosing. It is not distributed or sold.</p>
  </sdc-layout-container>
</sdc-section>

<sdc-section>
  <sdc-layout-container width="narrow">
    <p class="sdc-eyebrow">The 25 second version</p>
    <sdc-card class="lsp-video">
      <video controls playsinline muted preload="metadata" poster="/low-supply/img/poster.jpg" width="1080" height="1350"
        aria-label="Demo of Low Supply: a child's phone and a parent's phone side by side. The steps are written out below.">
        <source src="/low-supply/low-supply-demo.mp4" type="video/mp4">
      </video>
    </sdc-card>
    <p class="lsp-note">No sound. A child's phone is on the left and a parent's phone is on the right, with sample nicknames. Recorded from the running app in a browser, so the notification banner itself is not shown.</p>
  </sdc-layout-container>
</sdc-section>

<sdc-section>
  <sdc-layout-container width="narrow">
    <h2 class="lsp-h2">What it does</h2>
    <ul class="lsp-facts">
${facts.map(([t, d]) => `      <li><sdc-card class="lsp-fact"><h3>${esc(t)}</h3><p>${esc(d)}</p></sdc-card></li>`).join('\n')}
    </ul>
  </sdc-layout-container>
</sdc-section>
${parts.map(p => `
<sdc-section>
  <sdc-layout-container width="narrow">
    <h2 class="lsp-h2">${esc(p.title)}</h2>
    <ol class="lsp-steps">
${p.steps.map(s => `      <li class="lsp-step"><figure><img src="/low-supply/img/${s.file}" alt="${esc(s.alt)}" width="804" height="1748" loading="lazy"></figure>
        <h3><span class="lsp-step__n">${s.n}.</span> ${esc(s.title)}</h3><p>${rich(s.text)}</p></li>`).join('\n')}
    </ol>
  </sdc-layout-container>
</sdc-section>`).join('\n')}

<sdc-section>
  <sdc-layout-container width="narrow">
    <h2 class="lsp-h2">How it was made</h2>
    <sdc-text-passage width="narrow">
      <p>I wrote the brief, then built the first working version in a day with Claude Code. It went live for my family the same day. The screens use my own design system, the same tokens and controls as stevendesignco.com, so nothing here was styled from scratch.</p>
      <p>The source is in a private repository. I am glad to walk through it, or give access, on request.</p>
    </sdc-text-passage>
  </sdc-layout-container>
</sdc-section>

</main>
<!--SDC:FOOTER--><!--/SDC:FOOTER-->
</body>
</html>
`;
writeFileSync(path.join(out, 'index.html'), page);

// List it on the clients home page (behind the home password), once.
const listFile = path.join(sites, 'clients/site.json');
const list = JSON.parse(readFileSync(listFile, 'utf8'));
if (!list.items.some(i => i.href === '/low-supply')) {
  list.items.push({ type: 'Project', title: 'Low Supply', href: '/low-supply', updated: 'November 2026',
    description: 'A family web app: a child taps a supply that is running low and both parents get told. Demo video and step by step screens.' });
  writeFileSync(listFile, JSON.stringify(list, null, 2) + '\n');
}
console.log(`Showcase page written to ${out} (${parts.reduce((n, p) => n + p.steps.length, 0)} steps)${existsSync(out) ? '' : ' ?'}`);
