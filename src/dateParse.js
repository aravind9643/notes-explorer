// Natural due dates in task text: "call the bank tomorrow" → { text: "call the bank", due: "2026-10-24" }.
// English only; anything not understood is left in the text. No `vscode` import.
//
// Understood (optionally after "by", "on", "due", "before"):
//   today, tonight, tomorrow, monday…sunday (next one), next week, next month, this weekend, end of month,
//   in 3 days / in 2 weeks / in 1 month, 30 oct / oct 30 / 30 october, 30/10 or 30-10 (day first), 2026-10-30

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const dayNames = DAYS.map(d => `${d}|${d.slice(0, 3)}`).join('|');
const monthNames = MONTHS.map(m => `${m}|${m.slice(0, 3)}`).join('|');
const lead = String.raw`(?:(?:by|on|due|before|until)\s+)?`;

const monthIndex = (s) => MONTHS.findIndex(m => m.startsWith(s.toLowerCase().slice(0, 3)));
/** A day and month with no year: this year, or next year if that date has already passed. */
function upcoming(now, month, day) {
  if (month < 0 || day < 1 || day > 31) return null;
  let d = new Date(now.getFullYear(), month, day);
  if (d.getMonth() !== month) return null; // 31 Feb
  if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d = new Date(now.getFullYear() + 1, month, day);
  return d;
}

const RULES = [
  { re: String.raw`(\d{4})-(\d{2})-(\d{2})`, date: (m) => new Date(+m[1], +m[2] - 1, +m[3]) },
  { re: String.raw`today|tonight`, date: (m, now) => now },
  { re: String.raw`tomorrow|tmrw`, date: (m, now) => addDays(now, 1) },
  { re: String.raw`in\s+(\d+)\s+(days?|weeks?|months?)`, date: (m, now) => {
    const n = +m[1];
    if (/^d/.test(m[2])) return addDays(now, n);
    if (/^w/.test(m[2])) return addDays(now, 7 * n);
    return new Date(now.getFullYear(), now.getMonth() + n, now.getDate());
  } },
  { re: String.raw`next\s+week`, date: (m, now) => addDays(now, ((1 - now.getDay() + 7) % 7) || 7) }, // next Monday
  { re: String.raw`next\s+month`, date: (m, now) => new Date(now.getFullYear(), now.getMonth() + 1, 1) },
  { re: String.raw`(?:this\s+)?weekend`, date: (m, now) => addDays(now, ((6 - now.getDay() + 7) % 7) || (now.getDay() === 6 ? 0 : 7)) },
  { re: String.raw`end\s+of\s+(?:the\s+)?month`, date: (m, now) => new Date(now.getFullYear(), now.getMonth() + 1, 0) },
  { re: String.raw`(?:next\s+)?(${dayNames})`, date: (m, now) => {
    const want = DAYS.findIndex(d => d.startsWith(m[1].toLowerCase().slice(0, 3)));
    return addDays(now, ((want - now.getDay() + 7) % 7) || 7); // "friday" on a Friday means next Friday
  } },
  { re: String.raw`(\d{1,2})(?:st|nd|rd|th)?\s+(${monthNames})`, date: (m, now) => upcoming(now, monthIndex(m[2]), +m[1]) },
  { re: String.raw`(${monthNames})\s+(\d{1,2})(?:st|nd|rd|th)?`, date: (m, now) => upcoming(now, monthIndex(m[1]), +m[2]) },
  { re: String.raw`(\d{1,2})[/.](\d{1,2})`, date: (m, now) => upcoming(now, +m[2] - 1, +m[1]) }
];

/**
 * Finds the last date phrase in the text (so "call Monday's caller by friday" uses friday) and removes it.
 * Text that already has @due(...) is returned unchanged.
 */
function parseDue(input, now = new Date()) {
  const text = String(input);
  if (/@due\(/.test(text)) return { text: text.trim(), due: null };
  let best = null;
  for (const rule of RULES) {
    // Punctuation only ends a phrase when a space or the end follows, so "Monday.com" is not a date
    const re = new RegExp(String.raw`(^|\s)${lead}(?:${rule.re})(?=$|\s|[,.!?;](?:\s|$))`, 'gi');
    for (const m of text.matchAll(re)) {
      const inner = new RegExp(`^${lead}(?:${rule.re})$`, 'i').exec(m[0].slice(m[1].length));
      const d = inner && rule.date(inner, now);
      if (d && !isNaN(d) && (!best || m.index > best.index)) best = { index: m.index, length: m[0].length, d };
    }
  }
  if (!best) return { text: text.trim(), due: null };
  const rest = (text.slice(0, best.index) + text.slice(best.index + best.length)).replace(/\s{2,}/g, ' ').replace(/\s+([,.!?;])/g, '$1').trim();
  return { text: rest, due: iso(best.d) };
}

module.exports = { parseDue };
