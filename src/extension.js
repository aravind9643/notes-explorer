// Entry point: builds the index, views and editor features, keeps them up to date, and registers the
// commands, which live in ./commands/ grouped by feature.
const vscode = require('vscode');
const fsp = require('fs/promises');
const path = require('path');
const { NoteIndex } = require('./noteIndex');
const { NotesTree } = require('./notesTree');
const { TasksTree } = require('./tasksTree');
const { TodayTree } = require('./todayTree');
const { WikiLinkProvider, WikiLinkCompletion, RelatedTree } = require('./links');
const { QuickAccessTree } = require('./quickAccess');
const { Store } = require('./store');
const { Masker } = require('./masking');
const { LinkTools } = require('./linkTools');
const { SecureNotesFs } = require('./secureFs');
const { rollRecurring } = require('./recurrence');
const { checkReminders } = require('./reminders');
const { findProjectDirs, syncPasteDestination } = require('./workspaceSync');
const { t } = require('./l10n');
const { cfg, root, hidden, rootExists, itemPath, safe, debounce, isUnderRoot, today, listOpts, SECURE_SCHEME } = require('./util');

// Static requires, so the bundler includes every module
const COMMAND_MODULES = [
  require('./commands/create'), require('./commands/find'), require('./commands/tasks'), require('./commands/links'),
  require('./commands/views'), require('./commands/secure'), require('./commands/folders'), require('./commands/files')
];

function activate(context) {
  const index = new NoteIndex();
  const store = new Store(context.globalState);
  const trees = {
    notes: new NotesTree(index),
    today: new TodayTree(index),
    tasks: new TasksTree(index, context.globalState),
    related: new RelatedTree(index, store),
    quick: new QuickAccessTree(store)
  };
  const masker = new Masker();
  const linkTools = new LinkTools(index);
  const secureFs = new SecureNotesFs();
  const live = { graph: null, calendar: null }; // open webviews that follow index changes
  const sub = (...d) => context.subscriptions.push(...d);
  // Reminder bookkeeping follows Settings Sync, so a task isn't announced again on another machine the same day
  context.globalState.setKeysForSync(['notesExplorer.remindersShown', 'notesExplorer.searchOptions']);

  sub(vscode.workspace.registerFileSystemProvider(SECURE_SCHEME, secureFs, { isCaseSensitive: process.platform === 'linux' }));
  const views = {
    notesView: vscode.window.createTreeView('notesExplorer.tree', { treeDataProvider: trees.notes, dragAndDropController: trees.notes, canSelectMany: true, showCollapseAll: true }),
    todayView: vscode.window.createTreeView('notesExplorer.today', { treeDataProvider: trees.today }),
    quickView: vscode.window.createTreeView('notesExplorer.quick', { treeDataProvider: trees.quick }),
    tasksView: vscode.window.createTreeView('notesExplorer.tasks', { treeDataProvider: trees.tasks, showCollapseAll: true }),
    relatedView: vscode.window.createTreeView('notesExplorer.related', { treeDataProvider: trees.related })
  };
  sub(...Object.values(views), masker, linkTools);
  vscode.commands.executeCommand('setContext', 'notesExplorer.tasksFiltered', trees.tasks.view.filter !== 'open' || !!trees.tasks.view.tag);
  const setQuickContext = () => vscode.commands.executeCommand('setContext', 'notesExplorer.hasQuickAccess', store.pinned().length + store.recent().length > 0);
  setQuickContext();
  sub(store.onDidChange(setQuickContext));

  // Status bar: open task count, click to focus the Tasks view
  const status = vscode.window.createStatusBarItem('notesExplorer.tasks', vscode.StatusBarAlignment.Left, 50);
  status.name = t('Notes: open tasks');
  status.command = 'notesExplorer.tasks.focus';
  sub(status);
  const updateStatus = () => {
    const open = index.openTasks();
    const overdue = open.filter(x => x.due && x.due < today()).length;
    status.text = `$(checklist) ${open.length}${overdue ? ` $(warning) ${overdue}` : ''}`;
    status.tooltip = overdue ? t('Notes: {0} open task(s), {1} overdue. Click to show.', open.length, overdue) : t('Notes: {0} open task(s). Click to show.', open.length);
    status.accessibilityInformation = { label: status.tooltip };
    if (cfg().get('showStatusBar') && rootExists() && open.length) status.show(); else status.hide();
  };

  // Single re-index path: async scan (mtime-cached), then refresh every view
  let scanning = Promise.resolve();
  let dirty = false;
  let warnedTruncated = false;
  const reindex = () => (scanning = scanning.then(async () => {
    dirty = false;
    if (!rootExists()) index.invalidate();
    else {
      await index.scan(root(), hidden(), listOpts());
      if (index.truncated && !warnedTruncated) {
        warnedTruncated = true;
        vscode.window.showWarningMessage(t('Notes: only the first {0} files are indexed. Raise "notesExplorer.maxFiles" or exclude folders with "notesExplorer.exclude".', cfg().get('maxFiles')), t('Open Settings'))
          .then(p => p && vscode.commands.executeCommand('workbench.action.openSettings', 'notesExplorer.maxFiles'));
      }
    }
    trees.notes.projectDirs = await findProjectDirs(store);
    for (const tree of Object.values(trees)) tree.refresh();
    updateStatus();
    views.tasksView.description = trees.tasks.describe() || undefined;
    const g = trees.today.groups();
    views.todayView.badge = g.overdue.length + g.today.length
      ? { value: g.overdue.length + g.today.length, tooltip: t('{0} overdue, {1} due today', g.overdue.length, g.today.length) }
      : undefined;
    linkTools.updateDiagnostics();
    if (live.graph) live.graph.update();
    if (live.calendar) live.calendar.update();
  }).catch(err => console.error('[notes-explorer] reindex', err)));
  // File-system churn while nothing of ours is on screen only marks the index dirty; it is rebuilt
  // when a view becomes visible again (and hourly, for the status bar and reminders).
  const anyVisible = () => Object.values(views).some(v => v.visible) || !!live.graph || !!live.calendar;
  const reindexNow = debounce(reindex, 300);
  const reindexSoon = () => { if (anyVisible()) reindexNow(); else dirty = true; };
  for (const v of Object.values(views)) sub(v.onDidChangeVisibility(e => { if (e.visible && dirty) reindexNow(); }));

  // Watch create/change/delete (rename = delete + create). Saves inside VS Code are also caught below,
  // in case the OS watcher misses events for folders outside the workspace.
  let watcher;
  const watch = () => {
    if (watcher) watcher.dispose();
    watcher = undefined;
    if (!rootExists()) return;
    watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root()), '**/*'));
    const onFs = (uri) => { index.invalidate(uri.fsPath); reindexSoon(); };
    watcher.onDidCreate(onFs); watcher.onDidChange(onFs); watcher.onDidDelete(onFs);
  };
  watch();
  sub({ dispose: () => watcher && watcher.dispose() });
  // Saving a note always re-indexes (one changed file is cheap), so the status bar count stays current
  const rolling = new Set();
  sub(vscode.workspace.onDidSaveTextDocument(async (d) => {
    if (d.uri.scheme !== 'file' || !isUnderRoot(d.uri.fsPath)) return;
    index.invalidate(d.uri.fsPath);
    reindexNow();
    // Recurring tasks: roll completed @every tasks forward (also covers ticks typed by hand)
    if (!cfg().get('tasks.recurring') || rolling.has(d.uri.fsPath) || !/@every\(/i.test(d.getText())) return;
    const res = rollRecurring(d.getText(), today());
    if (!res.created) return;
    rolling.add(d.uri.fsPath);
    try {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(d.uri, new vscode.Range(0, 0, d.lineCount, 0), res.text);
      await vscode.workspace.applyEdit(edit);
      await d.save();
      vscode.window.setStatusBarMessage(t('Notes: added the next {0} recurring task(s)', res.created), 3000);
    } finally { rolling.delete(d.uri.fsPath); }
  }));
  sub(vscode.workspace.onDidRenameFiles(async (e) => {
    // Links are rewritten from the pre-rename index, before it is rebuilt
    await linkTools.onRenamed(e.files).catch(err => vscode.window.showErrorMessage(t('Notes: updating links failed: {0}', err.message)));
    for (const f of e.files) await store.renamed(f.oldUri.fsPath, f.newUri.fsPath);
    reindexNow();
  }));
  sub(vscode.workspace.onDidChangeWorkspaceFolders(() => reindexSoon()));
  sub(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('notesExplorer.mask')) masker.reload();
    if (e.affectsConfiguration('notesExplorer.rootPath') || e.affectsConfiguration('notesExplorer.pasteImages'))
      syncPasteDestination(context).catch(err => console.error('[notes-explorer] paste', err));
    if (e.affectsConfiguration('notesExplorer')) { index.invalidate(); watch(); reindex(); masker.updateAll(); }
  }));

  // Active editor drives Related Notes, Recent and masking
  const onEditor = (ed) => {
    const file = ed && ed.document.uri.scheme === 'file' ? ed.document.uri.fsPath : null;
    trees.related.setCurrent(file);
    if (file && isUnderRoot(file)) store.touch(file);
    masker.update(ed);
  };
  sub(vscode.window.onDidChangeActiveTextEditor(onEditor));
  sub(vscode.window.onDidChangeVisibleTextEditors(() => masker.updateAll()));
  const remask = debounce((doc) => vscode.window.visibleTextEditors.filter(e => e.document === doc).forEach(e => masker.update(e)), 150);
  sub(vscode.workspace.onDidChangeTextDocument(e => remask(e.document)));

  // [[wiki links]] and masked-value hovers in notes
  const noteSelector = [{ scheme: 'file', language: 'markdown' }, { scheme: 'file', language: 'plaintext' }];
  sub(vscode.languages.registerDocumentLinkProvider(noteSelector, new WikiLinkProvider(index)),
    vscode.languages.registerCompletionItemProvider(noteSelector, new WikiLinkCompletion(index), '[', '#'),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, { provideHover: (doc, pos) => masker.provideHover(doc, pos) }),
    vscode.languages.registerHoverProvider(noteSelector, { provideHover: (doc, pos) => cfg().get('links.hoverPreview') ? linkTools.provideHover(doc, pos) : undefined }),
    vscode.languages.registerCodeActionsProvider(noteSelector, { provideCodeActions: (doc, range, ctx) => linkTools.provideCodeActions(doc, range, ctx) },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));

  // First scan, then reminders; reminders re-checked hourly (and the Today view rolls over at midnight)
  syncPasteDestination(context).catch(err => console.error('[notes-explorer] paste', err));
  reindex().then(() => {
    onEditor(vscode.window.activeTextEditor);
    checkReminders(context, index);
  });
  const timer = setInterval(() => reindex().then(() => checkReminders(context, index)), 60 * 60 * 1000);
  sub({ dispose: () => clearInterval(timer) });

  // --- Shared helpers for the command modules ---
  const ctx = {
    context, sub, index, store, trees, views, masker, linkTools, secureFs, live,
    reindex, reindexNow, reindexSoon,
    reg: (id, fn) => sub(vscode.commands.registerCommand(id, safe(id.replace('notesExplorer.', ''), fn))),
    requireRoot: () => { if (!rootExists()) throw new Error(t('notes folder not found. Use "Notes: Change Notes Location".')); },
    targetDir: async (item) => {
      const p = itemPath(item);
      if (!p) return root();
      return (await fsp.stat(p)).isDirectory() ? p : path.dirname(p);
    },
    activeFile: () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return undefined;
      if (ed.document.uri.scheme === SECURE_SCHEME) return itemPath(ed.document.uri);
      return ed.document.uri.scheme === 'file' ? ed.document.uri.fsPath : undefined;
    }
  };
  for (const register of COMMAND_MODULES) register(ctx);

  // Internal handles for the integration tests (what the trees show); not a public API
  return { _test: { index, trees, reindex } };
}

module.exports = { activate, deactivate() {} };
