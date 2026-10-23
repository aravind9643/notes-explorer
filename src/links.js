const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { t } = require('./l10n');
const { root, isUnderRoot } = require('./util');

const LINK_RE = /\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|[^\]]*)?\]\]/g;

/** Makes [[note name]] clickable inside notes. Missing targets offer to create the note. */
class WikiLinkProvider {
  constructor(index) { this.index = index; }
  provideDocumentLinks(doc) {
    if (!isUnderRoot(doc.uri.fsPath)) return [];
    const links = [];
    for (let i = 0; i < doc.lineCount; i++) {
      // Same rule as the index: [[examples]] inside `inline code` are not links
      const text = doc.lineAt(i).text.replace(/(`+)[^`]*?\1/g, (m) => ' '.repeat(m.length));
      for (const m of text.matchAll(LINK_RE)) {
        const range = new vscode.Range(i, m.index, i, m.index + m[0].length);
        // [[Note#Heading]] opens the note at that heading
        const args = encodeURIComponent(JSON.stringify([m[1].trim(), { heading: m[2] ? m[2].trim() : undefined }]));
        const link = new vscode.DocumentLink(range, vscode.Uri.parse(`command:notesExplorer.openLink?${args}`));
        link.tooltip = this.index.resolveLink(m[1].trim()) ? t('Open note') : t('Create note');
        links.push(link);
      }
    }
    return links;
  }
}

/** Suggests note names after typing [[ */
class WikiLinkCompletion {
  constructor(index) { this.index = index; }
  provideCompletionItems(doc, pos) {
    if (!isUnderRoot(doc.uri.fsPath)) return [];
    const before = doc.lineAt(pos).text.slice(0, pos.character);
    const open = before.lastIndexOf('[[');
    if (open < 0 || before.indexOf(']]', open) >= 0) return [];
    // After "[[Note#", suggest that note's headings
    const hash = before.indexOf('#', open);
    if (hash > open) {
      const file = this.index.resolveLink(before.slice(open + 2, hash).trim());
      const n = file && this.index.cache.get(file);
      if (!n) return [];
      const range = new vscode.Range(pos.line, hash + 1, pos.line, pos.character);
      return n.headings.map((h, i) => {
        const item = new vscode.CompletionItem(h.text, vscode.CompletionItemKind.Reference);
        item.detail = '#'.repeat(h.level);
        item.sortText = String(i).padStart(4, '0'); // document order
        item.range = range;
        return item;
      });
    }
    const range = new vscode.Range(pos.line, open + 2, pos.line, pos.character);
    return [...this.index.cache.keys()].map(f => {
      const name = path.basename(f, path.extname(f));
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.File);
      item.detail = path.relative(root(), f);
      item.range = range;
      return item;
    });
  }
}

/**
 * "Related Notes" for the active editor: for a note, the notes that [[link]] to it;
 * for any other file (code, docs…), the notes linked to it with "Link Note to This File".
 */
class RelatedTree {
  constructor(index, store) {
    this.index = index;
    this.store = store;
    this.current = null;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    store.onDidChange(() => this.refresh());
  }
  setCurrent(file) {
    this.current = file || null;
    vscode.commands.executeCommand('setContext', 'notesExplorer.activeIsCode', !!file && !isUnderRoot(file));
    vscode.commands.executeCommand('setContext', 'notesExplorer.activeIsNote', !!file && isUnderRoot(file));
    this.refresh();
  }
  refresh() { this._emitter.fire(); }
  getTreeItem(el) {
    const name = path.basename(el.file).replace(/.md$/i, '');
    const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.None);
    item.resourceUri = vscode.Uri.file(el.file);
    if (el.kind === 'linked') {
      item.description = path.relative(root(), path.dirname(el.file));
      item.tooltip = t('Linked to {0}', path.basename(this.current));
      item.iconPath = new vscode.ThemeIcon('link');
      item.contextValue = 'linkedNote';
      item.accessibilityInformation = { label: t('Linked note {0}', name) };
      item.command = { command: 'vscode.open', title: t('Open'), arguments: [item.resourceUri] };
    } else {
      item.description = el.text.trim().slice(0, 80);
      item.tooltip = `${el.file}:${el.line + 1}`;
      item.iconPath = new vscode.ThemeIcon('references');
      item.contextValue = 'backlink';
      item.accessibilityInformation = { label: t('{0} links here: {1}', name, el.text.trim()) };
      item.command = { command: 'notesExplorer.openTask', title: t('Open'), arguments: [el] };
    }
    return item;
  }
  getChildren(el) {
    if (el || !this.current) return [];
    if (isUnderRoot(this.current))
      return this.index.backlinks(this.current).filter(l => l.file !== this.current).map(l => ({ ...l, kind: 'backlink' }));
    return this.store.notesFor(this.current).filter(f => fs.existsSync(f)).map(file => ({ file, kind: 'linked' }));
  }
}

module.exports = { WikiLinkProvider, WikiLinkCompletion, RelatedTree };
