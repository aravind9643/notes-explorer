// File operations on notes and folders in the tree: refresh, preview, reveal, copy, rename, delete.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { itemPath } = require('../util');
const { t } = require('../l10n');

module.exports = (ctx) => {
  const { reg, index, store, reindex, reindexSoon } = ctx;

  reg('notesExplorer.refresh', () => { index.invalidate(); return reindex(); });
  reg('notesExplorer.preview', (item) => vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(itemPath(item))));
  reg('notesExplorer.reveal', (item) => vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(itemPath(item))));
  reg('notesExplorer.copyPath', (item) => vscode.env.clipboard.writeText(itemPath(item)));
  reg('notesExplorer.copyLink', (item) => {
    const p = itemPath(item);
    return vscode.env.clipboard.writeText(`[[${path.basename(p, path.extname(p))}]]`);
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
};
