// Collects t('…') strings from src/ into l10n/bundle.l10n.json, the base file translators copy to
// bundle.l10n.<locale>.json. Run: npm run l10n
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src');
const out = {};
for (const f of fs.readdirSync(src, { recursive: true }).filter(f => f.endsWith('.js'))) {
  const text = fs.readFileSync(path.join(src, f), 'utf8');
  for (const m of text.matchAll(/\b(?:t|tr)\('((?:\\.|[^'\\])*)'/g)) {
    const key = m[1].replace(/\\'/g, "'");
    out[key] = key;
  }
}
const sorted = Object.fromEntries(Object.keys(out).sort().map(k => [k, k]));
fs.mkdirSync(path.join(__dirname, '..', 'l10n'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'l10n', 'bundle.l10n.json'), JSON.stringify(sorted, null, 2) + '\n');
console.log(`${Object.keys(sorted).length} strings → l10n/bundle.l10n.json`);
