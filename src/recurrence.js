// Recurring tasks: "- [ ] Water plants @every(week) @due(2026-10-23)". When such a task is completed,
// the next occurrence is added below it and the completed copy drops its @every. No `vscode` import.
//
// Rules: day | week | month | year | weekday | N days | N weeks | N months | monday … sunday (several: "mon,thu")

const EVERY_RE = /@every\(([^)]+)\)/i;
const DUE_RE = /@due\((\d{4}-\d{2}-\d{2})\)/;
const DONE_TASK_RE = /^(\s*[-*+]\s+)\[(x|X)\](\s+.*)$/;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

/** Adds months without overflowing into the following month (Jan 31 + 1 month → Feb 28/29). */
function addMonths(d, n) {
  const day = d.getDate();
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
  r.setDate(Math.min(day, new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()));
  return r;
}

/** Next date strictly after `from` (a Date) for a rule; returns null when the rule isn't understood. */
function nextDate(rule, from) {
  const r = String(rule).trim().toLowerCase();
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const m = /^(\d+)\s*(day|days|week|weeks|month|months|year|years)$/.exec(r);
  const unit = m ? m[2].replace(/s$/, '') : r;
  const n = m ? Math.max(1, Number(m[1])) : 1;
  switch (unit) {
    case 'day': case 'daily': d.setDate(d.getDate() + n); return d;
    case 'week': case 'weekly': d.setDate(d.getDate() + 7 * n); return d;
    case 'month': case 'monthly': return addMonths(d, n);
    case 'year': case 'yearly': return addMonths(d, 12 * n);
    case 'weekday': case 'weekdays': do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); return d;
  }
  const wanted = r.split(/[,\s]+/).map(x => DAYS.findIndex(day => x.length >= 3 && day.startsWith(x))).filter(i => i >= 0);
  if (!wanted.length) return null;
  do d.setDate(d.getDate() + 1); while (!wanted.includes(d.getDay()));
  return d;
}

/**
 * For each completed task line that still has @every(...), inserts the next open occurrence right after it
 * (and after its indented sub-lines) and removes @every from the completed line. Returns { text, created }.
 * The next due date counts from the task's @due if it has one, otherwise from `today`.
 */
function rollRecurring(text, today) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let created = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = DONE_TASK_RE.exec(lines[i]);
    if (!m) continue;
    const every = EVERY_RE.exec(m[3]);
    if (!every) continue;
    const due = DUE_RE.exec(m[3]);
    const base = due ? parseIso(due[1]) : parseIso(today);
    const next = nextDate(every[1], base);
    if (!next) continue;
    let body = m[3].replace(/\s+✓\s*\d{4}-\d{2}-\d{2}\s*$/, ''); // the new copy is open, so no completion stamp
    body = due ? body.replace(DUE_RE, `@due(${iso(next)})`) : `${body.replace(/\s+$/, '')} @due(${iso(next)})`;
    lines[i] = lines[i].replace(/\s*@every\([^)]+\)/i, '');
    let at = i + 1;
    while (at < lines.length && /^\s+\S/.test(lines[at]) && lines[at].search(/\S/) > m[1].search(/\S/)) at++;
    lines.splice(at, 0, `${m[1]}[ ]${body}`);
    created++;
    i = at; // skip the line we just added
  }
  return { text: lines.join(eol), created };
}

module.exports = { nextDate, rollRecurring, iso };
