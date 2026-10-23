const vscode = require('vscode');
const path = require('path');
const { today, cfg } = require('./util');
const { t: tr } = require('./l10n');

const SHOWN_KEY = 'notesExplorer.remindersShown';

/** Notifies once per day per task for open tasks with @due(date) today or earlier. */
async function checkReminders(context, index) {
  if (!cfg().get('reminders')) return;
  const t = today();
  const shown = context.globalState.get(SHOWN_KEY, {});
  if (shown.date !== t) { shown.date = t; shown.keys = []; }
  const due = index.openTasks().filter(x => x.due && x.due <= t && !shown.keys.includes(`${x.file}|${x.text}`));
  if (!due.length) return;
  shown.keys.push(...due.map(x => `${x.file}|${x.text}`));
  await context.globalState.update(SHOWN_KEY, shown);

  const first = due[0];
  const msg = due.length === 1
    ? `📌 ${first.due < t ? tr('Overdue: {0} ({1})', first.text, path.basename(first.file)) : tr('Due today: {0} ({1})', first.text, path.basename(first.file))}`
    : `📌 ${tr('{0} note tasks are due or overdue.', due.length)}`;
  const pick = await vscode.window.showInformationMessage(msg, due.length === 1 ? tr('Open') : tr('Show Tasks'));
  if (pick === tr('Open')) vscode.commands.executeCommand('notesExplorer.openTask', first);
  if (pick === tr('Show Tasks')) vscode.commands.executeCommand('notesExplorer.tasks.focus');
}

module.exports = { checkReminders };
