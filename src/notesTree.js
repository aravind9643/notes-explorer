const vscode = require('vscode');
const fs = require('fs/promises');
const path = require('path');
const { cfg, root, hidden, rootExists, excludeMatcher, isSecureFile, secureUri } = require('./util');
const { relativeTime } = require('./templates');
const { t } = require('./l10n');

const MIME = 'application/vnd.code.tree.notesexplorer.tree';

const fileIcon = (p) => {
  const name = path.basename(p).toLowerCase(), ext = path.extname(name);
  if (ext === '.mdenc') return 'lock';
  if (ext === '.md' || ext === '.markdown' || ext === '.txt') return 'note';
  if (ext === '.json') return 'json';
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) return 'file-media';
  if (ext === '.pdf') return 'file-pdf';
  return 'file';
};

class NotesTree {
  constructor(index) {
    this.index = index;
    this.tagFilter = null;      // when set, only files carrying this tag (and their folders) are shown
    this.projectDirs = new Set(); // folders matching the open workspace, highlighted in the tree
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    this.dropMimeTypes = [MIME, 'text/uri-list'];
    this.dragMimeTypes = [MIME];
  }
  refresh() { this._emitter.fire(); }

  setTagFilter(tag) {
    this.tagFilter = tag;
    vscode.commands.executeCommand('setContext', 'notesExplorer.filtered', !!tag);
    this.refresh();
  }

  async getTreeItem(p) {
    if (typeof p === 'object') {
      const item = new vscode.TreeItem(p.text, p.children.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.id = `h:${p.file}:${p.line}`;
      item.iconPath = new vscode.ThemeIcon('symbol-string');
      item.contextValue = 'heading';
      item.tooltip = `${'#'.repeat(p.level)} ${p.text}`;
      item.accessibilityInformation = { label: t('Heading {0}', p.text) };
      item.command = { command: 'notesExplorer.openTask', title: t('Open'), arguments: [{ file: p.file, line: p.line }] };
      return item;
    }
    const st = await fs.stat(p);
    const isDir = st.isDirectory();
    const item = new vscode.TreeItem(
      isDir ? path.basename(p) : path.basename(p).replace(/\.(md|mdenc)$/i, ''),
      isDir ? (this.tagFilter || this.projectDirs.has(p) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
            : this.headingsOf(p).length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    item.id = p;
    item.resourceUri = vscode.Uri.file(p);
    item.contextValue = isDir ? 'folder' : isSecureFile(p) ? 'secureNote' : 'note';
    item.tooltip = p;
    // Explicit codicons keep the tree flat and monochrome instead of following the colourful file icon theme
    item.iconPath = new vscode.ThemeIcon(isDir ? 'folder' : fileIcon(p));
    item.accessibilityInformation = { label: isDir ? t('Folder {0}', path.basename(p)) : t('Note {0}', path.basename(p)) };
    if (isDir && this.projectDirs.has(p)) {
      item.description = t('● current project');
      item.iconPath = new vscode.ThemeIcon('folder-active', new vscode.ThemeColor('charts.green'));
    }
    if (!isDir) {
      const n = this.index.cache.get(p);
      const open = n ? n.tasks.filter(x => !x.done).length : 0;
      const parts = [];
      if (open) parts.push(t('{0} open', open));
      if (cfg().get('showModifiedTime')) parts.push(relativeTime(st.mtimeMs));
      if (parts.length) item.description = parts.join(' · ');
      item.tooltip = new vscode.MarkdownString(`**${path.basename(p)}**

${p}

${t('Modified {0}', new Date(st.mtimeMs).toLocaleString())}`);
      item.command = { command: 'vscode.open', title: t('Open'), arguments: [isSecureFile(p) ? secureUri(p) : item.resourceUri] };
      if (isSecureFile(p)) item.description = [item.description, t('encrypted')].filter(Boolean).join(' · ');
    }
    return item;
  }

  /** Headings of a note as a tree (when notesExplorer.showHeadings is on). */
  headingsOf(file) {
    if (!cfg().get('showHeadings')) return [];
    const n = this.index.cache.get(file);
    if (!n || !n.headings.length) return [];
    const top = [], stack = [];
    for (const h of n.headings) {
      const node = { ...h, file, children: [] };
      while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
      (stack.length ? stack[stack.length - 1].children : top).push(node);
      stack.push(node);
    }
    // A single H1 title adds nothing: show its sections directly
    return top.length === 1 && top[0].level === 1 ? top[0].children : top;
  }

  async getChildren(p) {
    if (p && typeof p === 'object') return p.children;
    if (p && !(await fs.stat(p).then(st => st.isDirectory(), () => false))) return this.headingsOf(p);
    if (!p) vscode.commands.executeCommand('setContext', 'notesExplorer.missingRoot', !rootExists());
    if (!rootExists()) return []; // empty tree shows the "Set Notes Location" welcome button
    const dir = p || root();
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return []; } // folder vanished or is unreadable
    const templates = cfg().get('templatesFolder');
    const exclude = excludeMatcher();
    const visible = entries.filter(e => !(e.isDirectory() && (hidden().has(e.name) || (!p && e.name === templates)))
      && !exclude(path.relative(root(), path.join(dir, e.name)), e.isDirectory()));
    const sortBy = cfg().get('sortBy');
    const stats = new Map();
    if (sortBy !== 'name')
      await Promise.all(visible.map(async e => {
        try { stats.set(e.name, await fs.stat(path.join(dir, e.name))); } catch { /* vanished */ }
      }));
    const time = (e) => { const st = stats.get(e.name); return st ? (sortBy === 'created' ? st.birthtimeMs : st.mtimeMs) : 0; };
    let paths = visible
      .sort((a, b) => (b.isDirectory() - a.isDirectory())
        || (sortBy === 'name' ? 0 : time(b) - time(a))
        || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
      .map(e => path.join(dir, e.name));
    if (this.tagFilter) {
      const matches = this.index.filesWithTag(this.tagFilter).map(f => f.toLowerCase());
      paths = paths.filter(x => matches.some(m => m === x.toLowerCase() || m.startsWith(x.toLowerCase() + path.sep)));
    }
    return paths;
  }

  getParent(p) {
    if (typeof p === 'object') return p.file; // headings: the tree only needs the note for reveal()
    const parent = path.dirname(p);
    return !root() || parent.toLowerCase() === root().toLowerCase() ? undefined : parent;
  }

  // Drag & drop: move notes/folders between folders
  handleDrag(sources, data) {
    data.set(MIME, new vscode.DataTransferItem(sources.filter(x => typeof x === 'string')));
  }

  async handleDrop(target, data) {
    const destDir = !target ? root() : (await fs.stat(target)).isDirectory() ? target : path.dirname(target);
    let sources = data.get(MIME)?.value;
    if (!sources) {
      const uris = await data.get('text/uri-list')?.asString();
      sources = uris ? uris.split(/\r?\n/).filter(Boolean).map(u => vscode.Uri.parse(u).fsPath) : [];
    }
    const edit = new vscode.WorkspaceEdit();
    for (const src of sources) {
      const dest = path.join(destDir, path.basename(src));
      if (dest === src || destDir.toLowerCase().startsWith(src.toLowerCase() + path.sep)) continue; // no-op or into itself
      edit.renameFile(vscode.Uri.file(src), vscode.Uri.file(dest), { overwrite: false });
    }
    if (!(await vscode.workspace.applyEdit(edit))) vscode.window.showWarningMessage(t('Notes: some items could not be moved (a file with that name may already exist).'));
    this.refresh();
  }
}

module.exports = { NotesTree };
