// Graph, board and calendar views, export, and note history.
const vscode = require('vscode');
const path = require('path');
const { showGraph, showKanban, showCalendar } = require('../webviews');
const { exportNotes } = require('../exporter');
const { root, hidden, listOpts, itemPath, isUnderRoot, isSecureFile, openAt } = require('../util');
const { t } = require('../l10n');

module.exports = (ctx) => {
  const { reg, index, live, requireRoot, activeFile, reindex } = ctx;

  reg('notesExplorer.showGraph', async () => {
    requireRoot();
    await reindex();
    live.graph = showGraph(index);
    live.graph.panel.onDidDispose(() => { live.graph = null; });
  });
  reg('notesExplorer.showKanban', async (item) => {
    let file = itemPath(item) || activeFile();
    if (!file || !isUnderRoot(file) || !/\.(md|markdown)$/i.test(file)) {
      requireRoot();
      const files = (await index.listFiles(root(), hidden(), listOpts())).filter(f => /\.(md|markdown)$/i.test(f));
      const pick = await vscode.window.showQuickPick(files.map(p => ({ label: path.basename(p), description: path.relative(root(), path.dirname(p)), p })), { placeHolder: t('Show which note as a board?') });
      if (!pick) return;
      file = pick.p;
    }
    await showKanban(file);
  });
  reg('notesExplorer.showCalendar', async () => {
    requireRoot();
    await reindex();
    live.calendar = showCalendar(index);
    live.calendar.panel.onDidDispose(() => { live.calendar = null; });
  });

  const exportCmd = (format) => async (item) => {
    let target = itemPath(item) || activeFile();
    if (!target) { requireRoot(); target = root(); }
    await exportNotes(target, format);
  };
  reg('notesExplorer.exportHtml', exportCmd('html'));
  reg('notesExplorer.exportPdf', exportCmd('pdf'));

  reg('notesExplorer.showHistory', async (item) => {
    const file = itemPath(item) || activeFile();
    if (!file) throw new Error(t('open a note first'));
    if (isSecureFile(file)) throw new Error(t('history is not kept for encrypted notes'));
    await openAt(file);
    // VS Code's Timeline view lists the note's Local History (every save made in VS Code) and Git history
    await vscode.commands.executeCommand('timeline.focus');
  });
};
