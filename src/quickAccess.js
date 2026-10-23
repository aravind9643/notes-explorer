const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { root, isUnderRoot } = require('./util');
const { t } = require('./l10n');

/** "Quick Access" view: Pinned and Recent notes. Elements: { group } or { file, group }. */
class QuickAccessTree {
  constructor(store) {
    this.store = store;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    store.onDidChange(() => this.refresh());
  }
  refresh() { this._emitter.fire(); }

  getTreeItem(el) {
    if (!el.file) {
      const pinned = el.group === 'pinned';
      const item = new vscode.TreeItem(pinned ? t('Pinned') : t('Recent'), vscode.TreeItemCollapsibleState.Expanded);
      item.id = `qa:${el.group}`;
      item.iconPath = new vscode.ThemeIcon(pinned ? 'pinned' : 'history');
      item.contextValue = pinned ? 'qaPinnedGroup' : 'qaRecentGroup';
      return item;
    }
    const name = path.basename(el.file).replace(/\.md$/i, '');
    const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.None);
    item.id = `qa:${el.group}:${el.file}`;
    item.resourceUri = vscode.Uri.file(el.file);
    item.iconPath = new vscode.ThemeIcon('note');
    item.description = path.relative(root(), path.dirname(el.file));
    item.tooltip = el.file;
    item.contextValue = this.store.isPinned(el.file) ? 'qaNotePinned' : 'qaNote';
    item.accessibilityInformation = { label: `${el.group === 'pinned' ? t('Pinned note') : t('Recent note')} ${name}` };
    item.command = { command: 'vscode.open', title: t('Open'), arguments: [item.resourceUri] };
    return item;
  }

  getChildren(el) {
    const exists = (f) => isUnderRoot(f) && fs.existsSync(f);
    if (!el) {
      const groups = [];
      if (this.store.pinned().some(exists)) groups.push({ group: 'pinned' });
      // Recent excludes pinned notes, so each note appears once
      if (this.store.recent().some(f => exists(f) && !this.store.isPinned(f))) groups.push({ group: 'recent' });
      return groups;
    }
    if (el.file) return [];
    const files = el.group === 'pinned' ? this.store.pinned() : this.store.recent().filter(f => !this.store.isPinned(f));
    return files.filter(exists).map(file => ({ file, group: el.group }));
  }
}

module.exports = { QuickAccessTree };
