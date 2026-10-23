const vscode = require('vscode');
const fs = require('fs');

const cfg = () => vscode.workspace.getConfiguration('notesExplorer');
const root = () => (cfg().get('rootPath') || '').trim();
// Templates are not notes: keep them out of the tree, tasks and search
const hidden = () => new Set([...(cfg().get('hiddenFolders') || []), cfg().get('templatesFolder')].filter(Boolean));
const rootExists = () => { const r = root(); return !!r && fs.existsSync(r); };

// Tree elements are raw path strings; command args can be a path, a TreeItem, or a Uri
const itemPath = (item) => {
  if (!item) return undefined;
  if (typeof item === 'string') return item;
  if (item.resourceUri) return item.resourceUri.fsPath;
  if (item.fsPath) return item.fsPath;
  if (item.file) return item.file;
  return undefined;
};

/** Wraps a command so failures show a message instead of failing silently. */
const safe = (name, fn) => async (...args) => {
  try { return await fn(...args); }
  catch (err) {
    console.error(`[notes-explorer] ${name}`, err);
    vscode.window.showErrorMessage(require('./l10n').t('Notes: {0} failed: {1}', name, err && err.message ? err.message : String(err)));
  }
};

const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

const isUnderRoot = (file) => {
  const r = root();
  return !!r && !!file && file.toLowerCase().startsWith(r.toLowerCase());
};

const openAt = (file, line = 0, col = 0, viewColumn) => {
  const pos = new vscode.Position(line, col);
  return vscode.window.showTextDocument(vscode.Uri.file(file), { selection: new vscode.Range(pos, pos), preview: false, viewColumn });
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

module.exports = { cfg, root, hidden, rootExists, itemPath, safe, debounce, isUnderRoot, openAt, today };
