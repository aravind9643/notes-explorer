// Keeping the extension in step with the open workspace and VS Code settings.
const vscode = require('vscode');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { cfg, root, hidden, rootExists } = require('./util');

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

module.exports = { findProjectDirs, syncPasteDestination };
