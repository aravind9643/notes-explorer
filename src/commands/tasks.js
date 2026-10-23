// Task commands: open and tick tasks, Tasks view filters, sorting and grouping, archiving finished tasks.
const vscode = require('vscode');
const path = require('path');
const { toggleTask, FILTERS } = require('../tasksTree');
const { archiveCompleted } = require('../editOps');
const { cfg, today, itemPath, isUnderRoot, openAt } = require('../util');
const { t } = require('../l10n');

module.exports = (ctx) => {
  const { reg, index, trees, views, activeFile, reindex } = ctx;
  const describe = () => { views.tasksView.description = trees.tasks.describe() || undefined; };

  reg('notesExplorer.openTask', (x) => openAt(x.file, x.line));
  reg('notesExplorer.toggleTask', async (x) => { await toggleTask(x); index.invalidate(x.file); await reindex(); });

  reg('notesExplorer.filterTasks', async () => {
    await reindex();
    const v = trees.tasks.view;
    const items = Object.entries(FILTERS).map(([key, f]) => ({ label: f.label(), key, description: v.filter === key && !v.tag ? t('current') : undefined }));
    const tagsUsed = [...new Set(index.allTasks().flatMap(x => x.tags))].sort();
    if (tagsUsed.length) items.push({ label: t('By tag'), kind: vscode.QuickPickItemKind.Separator }, ...tagsUsed.map(tag => ({ label: `#${tag}`, tag, description: v.tag === tag ? t('current') : undefined })));
    const pick = await vscode.window.showQuickPick(items, { placeHolder: t('Show tasks…') });
    if (!pick) return;
    await trees.tasks.setView(pick.tag ? { tag: pick.tag } : { filter: pick.key, tag: null });
    describe();
  });
  reg('notesExplorer.clearTaskFilter', async () => { await trees.tasks.setView({ filter: 'open', tag: null }); describe(); });
  reg('notesExplorer.sortTasks', async () => {
    await trees.tasks.setView({ sort: trees.tasks.view.sort === 'due' ? 'file' : 'due' });
    describe();
  });
  reg('notesExplorer.toggleTaskSections', () => cfg().update('tasks.groupBySection', !cfg().get('tasks.groupBySection'), vscode.ConfigurationTarget.Global));

  reg('notesExplorer.archiveCompleted', async (item) => {
    const file = itemPath(item) || activeFile();
    if (!file || !isUnderRoot(file)) throw new Error(t('open a note first'));
    const doc = await vscode.workspace.openTextDocument(file);
    const res = archiveCompleted(doc.getText(), { heading: cfg().get('tasks.archiveHeading'), date: today() });
    if (!res.moved) return vscode.window.showInformationMessage(t('No completed tasks to move in {0}.', path.basename(file)));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), res.text);
    await vscode.workspace.applyEdit(edit);
    await doc.save();
    vscode.window.setStatusBarMessage(t('Notes: moved {0} completed task(s) to "{1}"', res.moved, cfg().get('tasks.archiveHeading')), 3000);
  });
};
