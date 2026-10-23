// Finding and arranging notes: quick open, search, tag filter, sorting, pinned and recent notes.
const vscode = require('vscode');
const path = require('path');
const { cfg, root, hidden, listOpts, itemPath, openAt } = require('../util');
const { t } = require('../l10n');

const SEARCH_OPTS_KEY = 'notesExplorer.searchOptions';

module.exports = (ctx) => {
  const { reg, context, index, store, trees, requireRoot, targetDir, activeFile, reindex } = ctx;

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
    const scopeText = () => [folder && t('in {0}', path.relative(root(), folder) || t('Notes')), trees.notes.tagFilter && `#${trees.notes.tagFilter}`].filter(Boolean).join(' · ');
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
    try { hits = index.search(q, { ...opts, folder, tag: trees.notes.tagFilter }); }
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
    if (pick) trees.notes.setTagFilter(pick.tag);
  });
  reg('notesExplorer.clearFilter', () => trees.notes.setTagFilter(null));

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
  reg('notesExplorer.toggleHeadings', () => cfg().update('showHeadings', !cfg().get('showHeadings'), vscode.ConfigurationTarget.Global));

  // --- Pinned & recent ---
  reg('notesExplorer.pin', async (item) => { const p = itemPath(item) || activeFile(); if (p) await store.pin(p); });
  reg('notesExplorer.unpin', async (item) => { const p = itemPath(item) || activeFile(); if (p) await store.unpin(p); });
  reg('notesExplorer.clearRecent', () => store.clearRecent());
};
