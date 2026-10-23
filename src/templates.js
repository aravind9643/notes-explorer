// Pure date formatting and template rendering. No `vscode` import, so it can be unit-tested with plain Node.

const pad = (n, w = 2) => String(n).padStart(w, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Formats a date with tokens YYYY, MM, DD, HH, mm, ss, MMMM, MMM, dddd, ddd. Text in [brackets] is kept literally. */
function formatDate(d, fmt) {
  const tokens = {
    YYYY: d.getFullYear(), MMMM: MONTHS[d.getMonth()], MMM: MONTHS[d.getMonth()].slice(0, 3), MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()), dddd: DAYS[d.getDay()], ddd: DAYS[d.getDay()].slice(0, 3),
    HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds())
  };
  return fmt.replace(/\[([^\]]*)\]|YYYY|MMMM|MMM|MM|DD|dddd|ddd|HH|mm|ss/g, (m, lit) => (lit !== undefined ? lit : String(tokens[m])));
}

/**
 * Fills {{title}}, {{date}}, {{time}}, {{datetime}}, {{date:FORMAT}} and {{text}} placeholders.
 * {{cursor}} is removed and its position returned, so the editor can put the caret there.
 */
function renderTemplate(template, { title = '', text = '', now = new Date(), dateFormat = 'YYYY-MM-DD' } = {}) {
  let out = template.replace(/\{\{\s*(\w+)(?::([^}]*))?\s*\}\}/g, (m, key, arg) => {
    switch (key.toLowerCase()) {
      case 'title': return title;
      case 'text': return text;
      case 'date': return formatDate(now, arg ? arg.trim() : dateFormat);
      case 'time': return formatDate(now, arg ? arg.trim() : 'HH:mm');
      case 'datetime': return formatDate(now, `${dateFormat} HH:mm`);
      case 'cursor': return m; // resolved below
      default: return m;       // unknown placeholders are left for the user to see
    }
  });
  const at = out.search(/\{\{\s*cursor\s*\}\}/i);
  let cursor = null;
  if (at >= 0) {
    const before = out.slice(0, at);
    cursor = { line: before.split('\n').length - 1, col: at - before.lastIndexOf('\n') - 1 };
    out = out.replace(/\{\{\s*cursor\s*\}\}/i, '');
  }
  return { text: out, cursor };
}

/** "5m ago", "3h ago", "2d ago", or a date for anything older than a week. */
function relativeTime(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(new Date(ms), 'YYYY-MM-DD');
}

module.exports = { formatDate, renderTemplate, relativeTime };
