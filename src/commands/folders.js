// The notes folder itself: choosing it, switching between several, and starter notes for an empty one.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { createStarter, isEmptyFolder } = require('../starter');
const { cfg, root, rootExists, openAt } = require('../util');
const { t } = require('../l10n');

module.exports = (ctx) => {
  const { reg, sub, index, views, requireRoot, reindex } = ctx;

  // --- Starter notes ---
  const addStarter = async (dir) => {
    const created = await createStarter(dir);
    index.invalidate();
    await reindex();
    const welcome = path.join(dir, 'Welcome.md');
    if (fs.existsSync(welcome)) await openAt(welcome);
    vscode.window.setStatusBarMessage(created.length
      ? t('Notes: added {0} starter file(s)', created.length)
      : t('Notes: the starter notes are already there'), 4000);
    return created;
  };
  /** For an empty notes folder, offers the starter folders and example notes. Returns true if they were added. */
  const offerStarter = async (dir) => {
    if (!cfg().get('starter.offer') || !(await isEmptyFolder(dir))) return false;
    const pick = await vscode.window.showInformationMessage(
      t('This notes folder is empty. Add a starter structure with example notes?'),
      { detail: t('Creates Welcome, Inbox, Daily, Projects, Meetings, Reference and Archive. You can delete any of it.') },
      t('Add Starter Notes'), t('Start Empty'));
    if (pick !== t('Add Starter Notes')) return false;
    await addStarter(dir);
    return true;
  };
  reg('notesExplorer.createStarter', async () => { requireRoot(); await addStarter(root()); });

  reg('notesExplorer.changeLocation', async () => {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
      defaultUri: rootExists() ? vscode.Uri.file(root()) : undefined, openLabel: t('Use as Notes Folder')
    });
    if (!picked) return;
    // Global so the location applies in every window; config listener re-indexes
    await cfg().update('rootPath', picked[0].fsPath, vscode.ConfigurationTarget.Global);
    if (!(await offerStarter(picked[0].fsPath))) vscode.window.showInformationMessage(t('Notes location set to {0}', picked[0].fsPath));
  });

  // --- Several notes folders ---
  const folderName = () => {
    const match = (cfg().get('folders') || []).find(x => x && x.path && x.path.toLowerCase() === root().toLowerCase());
    return match && match.name ? match.name : (root() ? path.basename(root()) : '');
  };
  const updateTitle = () => {
    const extra = (cfg().get('folders') || []).length;
    views.notesView.title = extra && root() ? folderName() : t('Notes');
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
    await offerStarter(p);
  });
};
