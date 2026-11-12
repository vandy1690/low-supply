// The never-say check for this app. The shared checker reads HTML pages, but nearly
// all of this app's words live in its JavaScript, so this reads those files instead.
// Run: npm run check:copy
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const phrases = readFileSync('never-say.txt', 'utf8').split('\n')
  .filter(l => l.trim() && !l.startsWith('#')).map(l => l.split('|')[0].trim().toLowerCase());
const files = ['public/index.html', 'public/manifest.webmanifest', 'public/sw.js', 'lib/core.js', 'lib/http.js',
  ...readdirSync('public/js').filter(f => f !== 'icons.js').map(f => path.join('public/js', f))];
let hits = 0;
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const low = line.toLowerCase();
    for (const p of phrases) if (low.includes(p)) { hits++; console.log(`${file}:${i + 1} says "${p}"`); }
    if (/[—–]/.test(line)) { hits++; console.log(`${file}:${i + 1} has a long dash`); }
  });
}
if (hits) process.exit(1);
console.log(`Copy check passed: ${phrases.length} phrases, ${files.length} files.`);
