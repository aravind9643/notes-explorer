const vscode = require('vscode');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { NoteIndex } = require('./noteIndex');
const { NotesTree } = require('./notesTree');
const { TasksTree, toggleTask } = require('./tasksTree');
const { WikiLinkProvider, WikiLinkCompletion, RelatedTree } = require('./links');
const { QuickAccessTree } = require('./quickAccess');
const { Store } = require('./store');
const { Masker } = require('./masking');
const { newNote, openDaily, quickCapture } = require('./capture');
const { LinkTools } = require('./linkTools');
const { showGraph, showKanban, showCalendar } = require('./webviews');
const { exportNotes } = require('./exporter');
const { SecureNotesFs } = require('./secureFs');
const { encrypt, decrypt, EXT: SECURE_EXT } = require('./secureNote');
const { rollRecurring } = require('./recurrence');
const { archiveCompleted } = require('./editOps');
const { FILTERS } = require('./tasksTree');
const { checkReminders } = require('./reminders');
const { t } = require('./l10n');
const { cfg, root, hidden, rootExists, itemPath, safe, debounce, isUnderRoot, openAt, today, listOpts, SECURE_SCHEME, isSecureFile, secureUri } = require('./util');

const SEARCH_OPTS_KEY = 'notesExplorer.searchOptions';
const PASTE_KEY = 'notesExplorer.pasteDestinationKey';

/** Folders linked to (or, failing that, named like) the open workspace folders. */
async function findProjectDirs(store) {
  const ws = vscode.workspace.workspaceFolders || [];
  const found = new Set();
  if (!ws.length || !rootExists()) return found;
  for (const f of ws) {
    const linked = store.projectFolder(f.uri.fsPath);
    if (linked && fs.existsSync(linked)) found.add(linked);
  }
  if (found.size) return found;
  const names = ws.map(f => f.name.toLowerCase());
  const walk = async (dir, depth) => {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || hidden().has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (names.includes(e.name.toLowerCase())) found.add(p);
      if (depth < 3) await walk(p, depth + 1);
    }
  };
  await walk(root(), 1);
  return found;
}

/**
 * Pasted/dropped images in notes are saved next to the note (in `pasteImages.folder`) by VS Code's
 * built-in Markdown support. We point its `markdown.copyFiles.destination` at the notes folder only.
 */
async function syncPasteDestination(context) {
  const md = vscode.workspace.getConfiguration('markdown');
  const current = { ...(md.get('copyFiles.destination') || {}) };
  const oldKey = context.globalState.get(PASTE_KEY);
  if (oldKey) delete current[oldKey];
  let newKey;
  if (cfg().get('pasteImages.enabled') && rootExists()) {
    newKey = `${root().replace(/\\/g, '/').replace(/\/+$/, '')}/**/*`;
    current[newKey] = `${cfg().get('pasteImages.folder').replace(/\\/g, '/').replace(/\/+$/, '')}/\${fileName}`;
  }
  if (oldKey === newKey && (!newKey || md.get('copyFiles.destination')?.[newKey] === current[newKey])) return;
  await md.update('copyFiles.destination', Object.keys(current).length ? current : undefined, vscode.ConfigurationTarget.Global);
  await context.globalState.update(PASTE_KEY, newKey);
}

function activate(context) {
  const index = new NoteIndex();
  const store = new Store(context.globalState);
  const notes = new NotesTree(index);
  const tasks = new TasksTree(index, context.globalState);
  const related = new RelatedTree(index, store);
  const quick = new QuickAccessTree(store);
  const masker = new Masker();
  const linkTools = new LinkTools(index);
  const live = { graph: null, calendar: null }; // open webviews that follow index changes
  const sub = (...d) => context.subscriptions.push(...d);
  // Reminder bookkeeping follows Settings Sync, so a task isn't announced again on another machine the same day
  context.globalState.setKeysForSync(['notesExplorer.remindersShown', SEARCH_OPTS_KEY]);

  const secureFs = new SecureNotesFs();
  sub(vscode.workspace.registerFileSystemProvider(SECURE_SCHEME, secureFs, { isCaseSensitive: process.platform === 'linux' }));
  const notesView = vscode.window.createTreeView('notesExplorer.tree', { treeDataProvider: notes, dragAndDropController: notes, canSelectMany: true, showCollapseAll: true });
  const quickView = vscode.window.createTreeView('notesExplorer.quick', { treeDataProvider: quick });
  const tasksView = vscode.window.createTreeView('notesExplorer.tasks', { treeDataProvider: tasks });
  const relatedView = vscode.window.createTreeView('notesExplorer.related', { treeDataProvider: related });
  sub(notesView, quickView, tasksView, relatedView, masker, linkTools);
  vscode.commands.executeCommand('setContext', 'notesExplorer.tasksFiltered', tasks.view.filter !== 'open' || !!tasks.view.tag);
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
    notes.projectDirs = await findProjectDirs(store);
    notes.refresh(); tasks.refresh(); related.refresh(); quick.refresh(); updateStatus();
    tasksView.description = tasks.describe() || undefined;
    linkTools.updateDiagnostics();
    if (live.graph) live.graph.update();
    if (live.calendar) live.calendar.update();
  }).catch(err => console.error('[notes-explorer] reindex', err)));
  // File-system churn while nothing of ours is on screen only marks the index dirty; it is rebuilt
  // when a view becomes visible again (and hourly, for the status bar and reminders).
  const anyVisible = () => [notesView, quickView, tasksView, relatedView].some(v => v.visible) || !!live.graph || !!live.calendar;
  const reindexNow = debounce(reindex, 300);
  const reindexSoon = () => { if (anyVisible()) reindexNow(); else dirty = true; };
  for (const v of [notesView, quickView, tasksView, relatedView]) sub(v.onDidChangeVisibility(e => { if (e.visible && dirty) reindexNow(); }));

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
    related.setCurrent(file);
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

  // First scan, then reminders; reminders re-checked hourly
  syncPasteDestination(context).catch(err => console.error('[notes-explorer] paste', err));
  reindex().then(() => {
    onEditor(vscode.window.activeTextEditor);
    checkReminders(context, index);
  });
  const timer = setInterval(() => reindex().then(() => checkReminders(context, index)), 60 * 60 * 1000);
  sub({ dispose: () => clearInterval(timer) });

  const reg = (id, fn) => sub(vscode.commands.registerCommand(id, safe(id.replace('notesExplorer.', ''), fn)));
  const targetDir = async (item) => {
    const p = itemPath(item);
    if (!p) return root();
    return (await fsp.stat(p)).isDirectory() ? p : path.dirname(p);
  };
  const requireRoot = () => { if (!rootExists()) throw new Error(t('notes folder not found. Use "Notes: Change Notes Location".')); };
  const activeFile = () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return undefined;
    if (ed.document.uri.scheme === SECURE_SCHEME) return itemPath(ed.document.uri);
    return ed.document.uri.scheme === 'file' ? ed.document.uri.fsPath : undefined;
  };

  reg('notesExplorer.refresh', () => { index.invalidate(); return reindex(); });

  // --- Creating notes ---
  reg('notesExplorer.newNote', async (item) => {
    requireRoot();
    if (await newNote(await targetDir(item))) reindexSoon();
  });
  reg('notesExplorer.newFolder', async (item) => {
    requireRoot();
    const name = await vscode.window.showInputBox({ prompt: t('New folder name') });
    if (!name) return;
    await fsp.mkdir(path.join(await targetDir(item), name), { recursive: true });
    notes.refresh();
  });
  reg('notesExplorer.openDaily', async () => { requireRoot(); await openDaily(0); reindexSoon(); });
  reg('notesExplorer.openYesterday', async () => { requireRoot(); await openDaily(-1); reindexSoon(); });
  reg('notesExplorer.openDailyFor', async (date) => { requireRoot(); await openDaily(0, date); reindexNow(); });
  reg('notesExplorer.quickCapture', async () => { requireRoot(); if (await quickCapture()) reindexSoon(); });
  reg('notesExplorer.openTemplates', async () => {
    requireRoot();
    const dir = path.join(root(), cfg().get('templatesFolder'));
    if (!fs.existsSync(dir)) {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, 'Meeting.md'),
        '# {{title}}\n\n**Date:** {{date}}  \n**Attendees:** \n\n## Agenda\n\n- {{cursor}}\n\n## Notes\n\n## Action items\n\n- [ ] \n');
      await fsp.writeFile(path.join(dir, 'daily.md'), '# {{date:dddd, DD MMMM YYYY}}\n\n## Today\n\n- [ ] {{cursor}}\n\n## Notes\n\n');
    }
    const files = (await fsp.readdir(dir)).filter(f => /\.(md|markdown|txt)$/i.test(f));
    const pick = await vscode.window.showQuickPick(
      [...files.map(f => ({ label: f, f })), { label: `$(add) ${t('New template…')}`, create: true }],
      { placeHolder: `${t('Templates in {0}', cfg().get('templatesFolder'))} · {{title}} {{date}} {{time}} {{date:FORMAT}} {{cursor}}` });
    if (!pick) return;
    if (pick.create) {
      let name = await vscode.window.showInputBox({ prompt: t('Template name'), placeHolder: 'Bug report' });
      if (!name) return;
      if (!path.extname(name)) name += '.md';
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) await fsp.writeFile(file, '# {{title}}\n\n{{cursor}}\n');
      return openAt(file);
    }
    return openAt(path.join(dir, pick.f));
  });

  // --- Finding notes ---
  reg('notesExplorer.quickOpen', async () => {
    requireRoot();
    const r = root();
    const files = await index.listFiles(r, hidden(), listOpts());
    const rank = (p) => (store.isPinned(p) ? 0 : store.recent().some(x => x.toLowerCase() === p.toLowerCase()) ? 1 : 2);
    const picks = files.sort((a, b) => rank(a) - rank(b)).map(p => ({
      label: `${store.isPinned(p) ? '$(pinned) ' : ''}${path.basename(p)}`, description: path.relative(r, path.dirname(p)), p
    }));
    const pick = await vscode.window.showQuickPick(picks, { placeHolder: t('Open note…'), matchOnDescription: true });
    if (pick) await openAt(pick.p);
  });

  reg('notesExplorer.search', async (item) => {
    requireRoot();
    const folder = item ? await targetDir(item) : undefined;
    const opts = { matchCase: false, wholeWord: false, regex: false, ...context.globalState.get(SEARCH_OPTS_KEY, {}) };
    const scopeText = () => [folder && t('in {0}', path.relative(root(), folder) || t('Notes')), notes.tagFilter && `#${notes.tagFilter}`].filter(Boolean).join(' · ');
    const toggles = [
      { key: 'matchCase', icon: 'case-sensitive', label: t('Match Case') },
      { key: 'wholeWord', icon: 'whole-word', label: t('Match Whole Word') },
      { key: 'regex', icon: 'regex', label: t('Use Regular Expression') }
    ];
    const box = vscode.window.createInputBox();
    const render = () => {
      box.buttons = toggles.map(x => ({ iconPath: new vscode.ThemeIcon(opts[x.key] ? 'pass-filled' : x.icon), tooltip: `${x.label}: ${opts[x.key] ? t('on') : t('off')}`, key: x.key }));
      const on = toggles.filter(x => opts[x.key]).map(x => x.label);
      box.prompt = [t('Search text in notes'), scopeText(), on.length ? on.join(', ') : ''].filter(Boolean).join(' · ');
    };
    box.placeholder = t('Search text in notes');
    render();
    box.onDidTriggerButton(b => { opts[b.key] = !opts[b.key]; context.globalState.update(SEARCH_OPTS_KEY, opts); render(); });
    const q = await new Promise(resolve => {
      box.onDidAccept(() => { resolve(box.value); box.hide(); });
      box.onDidHide(() => resolve(undefined));
      box.show();
    });
    box.dispose();
    if (!q) return;
    await reindex(); // cheap: only changed files are re-read
    let hits;
    try { hits = index.search(q, { ...opts, folder, tag: notes.tagFilter }); }
    catch (err) { throw new Error(t('invalid regular expression: {0}', err.message)); }
    if (!hits.length) return vscode.window.showInformationMessage(t('No matches for "{0}".', q));
    const r = root();
    const picks = hits.map(h => ({ label: h.text.trim().slice(0, 120) || ' ', description: `${path.relative(r, h.file)}:${h.line + 1}`, h }));
    const pick = await vscode.window.showQuickPick(picks, { placeHolder: t('{0} matches for "{1}"', hits.length, q), matchOnDescription: true });
    if (!pick) return;
    const ed = await openAt(pick.h.file, pick.h.line, pick.h.col);
    ed.selection = new vscode.Selection(pick.h.line, pick.h.col, pick.h.line, pick.h.col + pick.h.length);
  });

  reg('notesExplorer.filterByTag', async () => {
    requireRoot();
    await reindex();
    const tags = index.allTags();
    if (!tags.length) return vscode.window.showInformationMessage(t('No #tags found in notes yet. Add one like #ideas to any note.'));
    const pick = await vscode.window.showQuickPick(tags.map(([tag, n]) => ({ label: `#${tag}`, description: t('{0} note(s)', n), tag })), { placeHolder: t('Show only notes with tag…') });
    if (pick) notes.setTagFilter(pick.tag);
  });
  reg('notesExplorer.clearFilter', () => notes.setTagFilter(null));

  reg('notesExplorer.sortBy', async () => {
    const current = cfg().get('sortBy');
    const items = [
      { label: t('Name'), value: 'name' },
      { label: t('Last modified (newest first)'), value: 'modified' },
      { label: t('Created (newest first)'), value: 'created' }
    ].map(i => ({ ...i, description: i.value === current ? t('current') : undefined }));
    const pick = await vscode.window.showQuickPick(items, { placeHolder: t('Sort notes by…') });
    if (pick) await cfg().update('sortBy', pick.value, vscode.ConfigurationTarget.Global);
  });
  reg('notesExplorer.toggleModifiedTime', () => cfg().update('showModifiedTime', !cfg().get('showModifiedTime'), vscode.ConfigurationTarget.Global));

  // --- Pinned & recent ---
  reg('notesExplorer.pin', async (item) => { const p = itemPath(item) || activeFile(); if (p) await store.pin(p); });
  reg('notesExplorer.unpin', async (item) => { const p = itemPath(item) || activeFile(); if (p) await store.unpin(p); });
  reg('notesExplorer.clearRecent', () => store.clearRecent());

  // --- Tasks ---
  reg('notesExplorer.openTask', (x) => openAt(x.file, x.line));
  reg('notesExplorer.toggleTask', async (x) => { await toggleTask(x); index.invalidate(x.file); await reindex(); });

  reg('notesExplorer.filterTasks', async () => {
    await reindex();
    const v = tasks.view;
    const items = Object.entries(FILTERS).map(([key, f]) => ({ label: f.label(), key, description: v.filter === key && !v.tag ? t('current') : undefined }));
    const tagsUsed = [...new Set(index.allTasks().flatMap(x => x.tags))].sort();
    if (tagsUsed.length) items.push({ label: t('By tag'), kind: vscode.QuickPickItemKind.Separator }, ...tagsUsed.map(tag => ({ label: `#${tag}`, tag, description: v.tag === tag ? t('current') : undefined })));
    const pick = await vscode.window.showQuickPick(items, { placeHolder: t('Show tasks…') });
    if (!pick) return;
    await tasks.setView(pick.tag ? { tag: pick.tag } : { filter: pick.key, tag: null });
    tasksView.description = tasks.describe() || undefined;
  });
  reg('notesExplorer.clearTaskFilter', async () => { await tasks.setView({ filter: 'open', tag: null }); tasksView.description = tasks.describe() || undefined; });
  reg('notesExplorer.sortTasks', async () => {
    await tasks.setView({ sort: tasks.view.sort === 'due' ? 'file' : 'due' });
    tasksView.description = tasks.describe() || undefined;
  });
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

  // --- Tags ---
  reg('notesExplorer.renameTag', async () => {
    requireRoot();
    await reindex();
    const tags = index.allTags();
    if (!tags.length) return vscode.window.showInformationMessage(t('No #tags found in notes yet. Add one like #ideas to any note.'));
    const pick = await vscode.window.showQuickPick(tags.map(([tag, n]) => ({ label: `#${tag}`, description: t('{0} note(s)', n), tag })), { placeHolder: t('Tag to rename') });
    if (!pick) return;
    const next = await vscode.window.showInputBox({
      prompt: t('Rename #{0} in all notes to', pick.tag), value: pick.tag,
      validateInput: (v) => (/^[A-Za-z][\w/-]*$/.test(v.replace(/^#/, '')) ? undefined : t('Tags start with a letter and contain letters, digits, - _ or /'))
    });
    const newTag = next && next.replace(/^#/, '');
    if (!newTag || newTag === pick.tag) return;
    const res = await linkTools.renameTagEverywhere(pick.tag, newTag);
    if (notes.tagFilter === pick.tag) notes.setTagFilter(newTag.toLowerCase());
    await reindex();
    vscode.window.showInformationMessage(t('Renamed #{0} to #{1}: {2} change(s) in {3} note(s)', pick.tag, newTag, res.count, res.files));
  });

  // --- Graph, board, calendar, export ---
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

  // --- Links ---
  reg('notesExplorer.openLink', async (target, opts = {}) => {
    opts = opts || {};
    requireRoot();
    await reindex();
    let file = index.resolveLink(target);
    if (!file) {
      if (!opts.create) {
        const ok = await vscode.window.showInformationMessage(t('Note "{0}" doesn\'t exist. Create it?', target), t('Create'));
        if (ok !== t('Create')) return;
      }
      file = path.join(root(), `${target}.md`);
      await fsp.writeFile(file, `# ${target}\n\n`);
      reindexSoon();
    }
    const line = opts.heading ? index.headingLine(file, opts.heading) : null;
    await openAt(file, line || 0);
  });

  reg('notesExplorer.linkNoteToFile', async (uri) => {
    requireRoot();
    const file = (uri && uri.fsPath) || activeFile();
    if (!file) throw new Error(t('open a file first'));
    if (isUnderRoot(file)) throw new Error(t('this is a note. Use [[note name]] to link notes to each other.'));
    const r = root();
    const files = (await index.listFiles(r, hidden(), listOpts())).filter(f => /\.(md|markdown|txt)$/i.test(f));
    const items = [{ label: `$(add) ${t('New note…')}`, create: true }, ...files.map(p => ({ label: path.basename(p), description: path.relative(r, path.dirname(p)), p }))];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: t('Link a note to {0}', path.basename(file)), matchOnDescription: true });
    if (!pick) return;
    let note = pick.p;
    if (pick.create) {
      const dirs = [...notes.projectDirs];
      note = await newNote(dirs[0] || r);
      if (!note) return;
      reindexSoon();
    }
    await store.linkNote(file, note);
    related.setCurrent(file);
    vscode.commands.executeCommand('notesExplorer.related.focus');
    vscode.window.showInformationMessage(t('Linked {0} to {1}', path.basename(note), path.basename(file)));
  });
  reg('notesExplorer.unlinkNote', async (el) => {
    const file = related.current;
    if (file && el) await store.unlinkNote(file, itemPath(el));
  });

  // --- Projects ---
  reg('notesExplorer.linkFolderToProject', async (item) => {
    requireRoot();
    const ws = vscode.workspace.workspaceFolders;
    if (!ws || !ws.length) throw new Error(t('open a project folder first'));
    const folder = await targetDir(item);
    const target = ws.length === 1 ? ws[0] : (await vscode.window.showWorkspaceFolderPick({ placeHolder: t('Link {0} to which project?', path.basename(folder)) }));
    if (!target) return;
    await store.linkProject(target.uri.fsPath, folder);
    await reindex();
    vscode.window.showInformationMessage(t('{0} is now the notes folder for {1}', path.relative(root(), folder) || t('Notes'), target.name));
  });
  reg('notesExplorer.unlinkProject', async () => {
    const ws = vscode.workspace.workspaceFolders || [];
    for (const f of ws) await store.unlinkProject(f.uri.fsPath);
    await reindex();
  });
  reg('notesExplorer.openProjectNotes', async () => {
    requireRoot();
    const ws = vscode.workspace.workspaceFolders;
    if (!ws || !ws.length) throw new Error(t('open a project folder first'));
    const dirs = [...notes.projectDirs];
    let dir = dirs[0];
    if (dirs.length > 1) dir = (await vscode.window.showQuickPick(dirs.map(d => ({ label: path.relative(root(), d), d })), { placeHolder: t('Project notes folder') }))?.d;
    if (!dir) {
      if (dirs.length) return;
      const choice = await vscode.window.showQuickPick([
        { label: `$(new-folder) ${t('Create {0}', path.join(cfg().get('projectsFolder'), ws[0].name))}`, create: true },
        { label: `$(folder) ${t('Choose an existing folder…')}` }
      ], { placeHolder: t('No notes folder is linked to {0} yet', ws[0].name) });
      if (!choice) return;
      if (choice.create) dir = path.join(root(), cfg().get('projectsFolder'), ws[0].name);
      else {
        const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, defaultUri: vscode.Uri.file(root()), openLabel: t('Use for this project') });
        if (!picked) return;
        dir = picked[0].fsPath;
        if (!isUnderRoot(dir)) throw new Error(t('choose a folder inside your notes folder'));
      }
      await fsp.mkdir(dir, { recursive: true });
      await store.linkProject(ws[0].uri.fsPath, dir);
    }
    const files = (await fsp.readdir(dir)).filter(f => /\.(md|txt)$/i.test(f));
    const file = path.join(dir, files.find(f => /^readme\.md$/i.test(f)) || files[0] || 'README.md');
    if (!fs.existsSync(file)) await fsp.writeFile(file, `# ${ws[0].name}\n\n`);
    await reindex();
    await openAt(file);
    notesView.reveal(dir, { expand: true }).then(undefined, () => {});
  });

  // --- Masking ---
  reg('notesExplorer.toggleMask', () => {
    if (!masker.regexes.length) {
      return vscode.window.showInformationMessage(t('Masking is off. Add patterns to "notesExplorer.mask.patterns" to hide sensitive values.'), t('Open Settings'))
        .then(p => p && vscode.commands.executeCommand('workbench.action.openSettings', 'notesExplorer.mask.patterns'));
    }
    const shown = masker.toggle();
    vscode.window.setStatusBarMessage(shown ? t('Notes: hidden values shown') : t('Notes: hidden values masked'), 2500);
  });
  reg('notesExplorer.copyMasked', async (value) => {
    await vscode.env.clipboard.writeText(value);
    vscode.window.setStatusBarMessage(t('Notes: copied hidden value'), 2500);
  });

  // --- Encrypted notes ---
  reg('notesExplorer.encryptNote', async (item) => {
    const file = itemPath(item) || activeFile();
    if (!file || !isUnderRoot(file) || isSecureFile(file)) throw new Error(t('choose a note to encrypt'));
    const ok = await vscode.window.showWarningMessage(
      t('Encrypt "{0}" with a password?', path.basename(file)), {
        modal: true,
        detail: t('The note is replaced by an encrypted copy and the original is deleted permanently (not to the Recycle Bin). It is no longer searchable, and if you forget the password the note cannot be recovered.')
      }, t('Encrypt'));
    if (ok !== t('Encrypt')) return;
    const password = await secureFs.askPassword(file, { confirm: true });
    const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath.toLowerCase() === file.toLowerCase());
    const text = doc ? doc.getText() : await fsp.readFile(file, 'utf8');
    const dest = file.replace(/\.(md|markdown|txt)$/i, '') + SECURE_EXT;
    if (fs.existsSync(dest)) throw new Error(t('"{0}" already exists', path.basename(dest)));
    await fsp.writeFile(dest, encrypt(text, password));
    decrypt(await fsp.readFile(dest, 'utf8'), password); // verify before removing the original
    for (const tab of vscode.window.tabGroups.all.flatMap(g => g.tabs))
      if (tab.input && tab.input.uri && tab.input.uri.fsPath.toLowerCase() === file.toLowerCase()) await vscode.window.tabGroups.close(tab, true);
    await fsp.rm(file);
    secureFs.remember(dest, password);
    await store.renamed(file, dest);
    index.invalidate(file);
    await reindex();
    await vscode.window.showTextDocument(secureUri(dest), { preview: false });
  });
  reg('notesExplorer.decryptNote', async (item) => {
    const file = itemPath(item) || activeFile();
    if (!file || !isSecureFile(file)) throw new Error(t('choose an encrypted note'));
    const ok = await vscode.window.showWarningMessage(t('Remove the password from "{0}"?', path.basename(file)), {
      modal: true, detail: t('The note is saved as plain Markdown again and becomes searchable.')
    }, t('Remove Password'));
    if (ok !== t('Remove Password')) return;
    const text = (await secureFs.readFile(secureUri(file))).toString('utf8'); // asks for the password if needed
    const dest = file.replace(/\.mdenc$/i, '.md');
    if (fs.existsSync(dest)) throw new Error(t('"{0}" already exists', path.basename(dest)));
    for (const tab of vscode.window.tabGroups.all.flatMap(g => g.tabs))
      if (tab.input && tab.input.uri && tab.input.uri.scheme === SECURE_SCHEME && itemPath(tab.input.uri).toLowerCase() === file.toLowerCase()) await vscode.window.tabGroups.close(tab, true);
    await fsp.writeFile(dest, text);
    await fsp.rm(file);
    await store.renamed(file, dest);
    await reindex();
    await openAt(dest);
  });
  reg('notesExplorer.lockSecure', async () => {
    secureFs.lock();
    for (const tab of vscode.window.tabGroups.all.flatMap(g => g.tabs))
      if (tab.input && tab.input.uri && tab.input.uri.scheme === SECURE_SCHEME) await vscode.window.tabGroups.close(tab, false);
    vscode.window.setStatusBarMessage(t('Notes: encrypted notes locked'), 2500);
  });

  // --- Several notes folders ---
  const folderName = () => {
    const match = (cfg().get('folders') || []).find(x => x && x.path && x.path.toLowerCase() === root().toLowerCase());
    return match && match.name ? match.name : (root() ? path.basename(root()) : '');
  };
  const updateTitle = () => {
    const extra = (cfg().get('folders') || []).length;
    notesView.title = extra && root() ? folderName() : t('Notes');
  };
  updateTitle();
  sub(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('notesExplorer')) updateTitle(); }));
  reg('notesExplorer.switchFolder', async () => {
    const folders = (cfg().get('folders') || []).filter(x => x && x.path);
    const items = folders.map(x => ({
      label: `${x.path.toLowerCase() === root().toLowerCase() ? '$(check) ' : '$(folder) '}${x.name || path.basename(x.path)}`,
      description: x.path, folder: x
    }));
    if (root() && !folders.some(x => x.path.toLowerCase() === root().toLowerCase()))
      items.unshift({ label: `$(check) ${path.basename(root())}`, description: root(), folder: { name: path.basename(root()), path: root() } });
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator }, { label: `$(add) ${t('Add Notes Folder…')}`, add: true });
    if (folders.length) items.push({ label: `$(remove) ${t('Remove a Notes Folder from this list…')}`, remove: true });
    const pick = await vscode.window.showQuickPick(items, { placeHolder: t('Switch notes folder') });
    if (!pick) return;
    if (pick.add) return vscode.commands.executeCommand('notesExplorer.addFolder');
    if (pick.remove) {
      const del = await vscode.window.showQuickPick(folders.map(x => ({ label: x.name || path.basename(x.path), description: x.path, x })), { placeHolder: t('Remove which folder from the list? Its files are not touched.') });
      if (del) await cfg().update('folders', folders.filter(x => x !== del.x), vscode.ConfigurationTarget.Global);
      return;
    }
    await cfg().update('rootPath', pick.folder.path, vscode.ConfigurationTarget.Global);
  });
  reg('notesExplorer.addFolder', async () => {
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: t('Add Notes Folder') });
    if (!picked) return;
    const p = picked[0].fsPath;
    const name = await vscode.window.showInputBox({ prompt: t('Name for this notes folder'), value: path.basename(p) });
    if (name === undefined) return;
    const folders = (cfg().get('folders') || []).filter(x => x && x.path && x.path.toLowerCase() !== p.toLowerCase());
    // Keep the current folder in the list too, so you can switch back to it
    if (root() && !folders.some(x => x.path.toLowerCase() === root().toLowerCase()) && root().toLowerCase() !== p.toLowerCase())
      folders.unshift({ name: path.basename(root()), path: root() });
    folders.push({ name: name || path.basename(p), path: p });
    await cfg().update('folders', folders, vscode.ConfigurationTarget.Global);
    await cfg().update('rootPath', p, vscode.ConfigurationTarget.Global);
  });

  // --- Outline and history ---
  reg('notesExplorer.toggleHeadings', () => cfg().update('showHeadings', !cfg().get('showHeadings'), vscode.ConfigurationTarget.Global));
  reg('notesExplorer.showHistory', async (item) => {
    const file = itemPath(item) || activeFile();
    if (!file) throw new Error(t('open a note first'));
    if (isSecureFile(file)) throw new Error(t('history is not kept for encrypted notes'));
    await openAt(file);
    // VS Code's Timeline view lists the note's Local History (every save made in VS Code) and Git history
    await vscode.commands.executeCommand('timeline.focus');
  });

  // --- File operations ---
  reg('notesExplorer.preview', (item) => vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(itemPath(item))));
  reg('notesExplorer.reveal', (item) => vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(itemPath(item))));
  reg('notesExplorer.copyPath', (item) => vscode.env.clipboard.writeText(itemPath(item)));
  reg('notesExplorer.copyLink', (item) => {
    const p = itemPath(item);
    return vscode.env.clipboard.writeText(`[[${path.basename(p, path.extname(p))}]]`);
  });

  reg('notesExplorer.changeLocation', async () => {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
      defaultUri: rootExists() ? vscode.Uri.file(root()) : undefined, openLabel: t('Use as Notes Folder')
    });
    if (!picked) return;
    // Global so the location applies in every window; config listener re-indexes
    await cfg().update('rootPath', picked[0].fsPath, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(t('Notes location set to {0}', picked[0].fsPath));
  });

  reg('notesExplorer.rename', async (item) => {
    const p = itemPath(item);
    const name = await vscode.window.showInputBox({ prompt: t('Rename to'), value: path.basename(p), valueSelection: [0, path.basename(p, path.extname(p)).length] });
    if (!name || name === path.basename(p)) return;
    const dest = path.join(path.dirname(p), name);
    if (fs.existsSync(dest) && dest.toLowerCase() !== p.toLowerCase()) throw new Error(t('"{0}" already exists', name));
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(vscode.Uri.file(p), vscode.Uri.file(dest)); // keeps open editors pointed at the renamed file
    await vscode.workspace.applyEdit(edit);
    reindexSoon();
  });

  reg('notesExplorer.delete', async (item, selected) => {
    const paths = (selected && selected.length ? selected : [item]).map(itemPath).filter(Boolean);
    const label = paths.length === 1 ? `"${path.basename(paths[0])}"` : t('{0} items', paths.length);
    const ok = await vscode.window.showWarningMessage(t('Move {0} to Recycle Bin?', label), { modal: true }, t('Delete'));
    if (ok !== t('Delete')) return;
    for (const p of paths) { await vscode.workspace.fs.delete(vscode.Uri.file(p), { recursive: true, useTrash: true }); await store.unpin(p); }
    reindexSoon();
  });
}

module.exports = { activate, deactivate() {} };
