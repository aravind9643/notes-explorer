// Link and tag maintenance: missing-link warnings with a "Create note" fix, hover previews of [[links]],
// updating links when a note is renamed, and renaming a #tag everywhere.
const vscode = require('vscode');
const fsp = require('fs/promises');
const path = require('path');
const { root, isUnderRoot, cfg } = require('./util');
const { renameLinks, renameTag } = require('./editOps');
const { t } = require('./l10n');

const LINK_AT_RE = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;
const NOTE_EXT = /\.(md|markdown|txt)$/i;

/** Replaces a whole document's text through a WorkspaceEdit, so open editors and undo stay consistent. */
async function replaceAll(edit, file, newText) {
  const doc = await vscode.workspace.openTextDocument(file);
  edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), newText);
}

class LinkTools {
  constructor(index) {
    this.index = index;
    this.diagnostics = vscode.languages.createDiagnosticCollection('notesExplorer');
  }

  dispose() { this.diagnostics.dispose(); }

  /** Marks [[links]] to notes that don't exist, in every indexed note. */
  updateDiagnostics() {
    this.diagnostics.clear();
    if (!cfg().get('links.reportMissing')) return;
    for (const file of this.index.cache.keys()) {
      const missing = this.index.unresolvedLinks(file);
      if (!missing.length) continue;
      this.diagnostics.set(vscode.Uri.file(file), missing.map(l => {
        const d = new vscode.Diagnostic(new vscode.Range(l.line, l.col, l.line, l.col + l.length),
          t('No note named "{0}"', l.target), vscode.DiagnosticSeverity.Information);
        d.source = t('Notes');
        d.code = 'missing-note';
        return d;
      }));
    }
  }

  provideCodeActions(doc, range, context) {
    return context.diagnostics.filter(d => d.code === 'missing-note').map(d => {
      const target = /\[\[([^\]|#]+)/.exec(doc.getText(d.range))?.[1]?.trim();
      const action = new vscode.CodeAction(t('Create note "{0}"', target), vscode.CodeActionKind.QuickFix);
      action.command = { command: 'notesExplorer.openLink', title: action.title, arguments: [target, { create: true }] };
      action.diagnostics = [d];
      action.isPreferred = true;
      return action;
    });
  }

  /** Hover over [[link]]: the first lines of the target note. */
  async provideHover(doc, pos) {
    if (!isUnderRoot(doc.uri.fsPath)) return;
    const text = doc.lineAt(pos.line).text;
    for (const m of text.matchAll(LINK_AT_RE)) {
      if (pos.character < m.index || pos.character > m.index + m[0].length) continue;
      const range = new vscode.Range(pos.line, m.index, pos.line, m.index + m[0].length);
      const file = this.index.resolveLink(m[1].trim());
      if (!file) return new vscode.Hover(new vscode.MarkdownString(`$(warning) ${t('No note named "{0}" yet. Click the link to create it.', m[1].trim())}`, true), range);
      const n = this.index.cache.get(file);
      const lines = (n ? n.lines : []).slice(0, cfg().get('links.previewLines'));
      const md = new vscode.MarkdownString(`**${path.basename(file, path.extname(file))}** · _${path.relative(root(), path.dirname(file)) || t('Notes')}_\n\n---\n\n${lines.join('\n')}`);
      md.baseUri = vscode.Uri.file(path.dirname(file) + path.sep); // relative images resolve next to the note
      return new vscode.Hover(md, range);
    }
  }

  /** After notes are renamed: offers to rewrite [[Old]] → [[New]] in every note that links to them. */
  async onRenamed(files) {
    if (cfg().get('links.updateOnRename') === 'never') return;
    const renames = files
      .map(f => ({ from: f.oldUri.fsPath, to: f.newUri.fsPath }))
      .filter(r => isUnderRoot(r.to) && NOTE_EXT.test(r.from) && NOTE_EXT.test(r.to))
      .map(r => ({ ...r, oldName: path.basename(r.from, path.extname(r.from)), newName: path.basename(r.to, path.extname(r.to)) }))
      .filter(r => r.oldName.toLowerCase() !== r.newName.toLowerCase());
    if (!renames.length) return;

    // The index still holds pre-rename contents, which is what we want to search
    const affected = new Map(); // file → new text
    let count = 0;
    for (const [file, n] of this.index.cache) {
      let text = n.lines.join('\n');
      const target = renames.find(r => r.from.toLowerCase() === file.toLowerCase());
      const realFile = target ? target.to : file;
      let changed = 0;
      try { text = await fsp.readFile(realFile, 'utf8'); } catch { continue; }
      for (const r of renames) {
        const res = renameLinks(text, r.oldName, r.newName);
        text = res.text; changed += res.count;
      }
      if (changed) { affected.set(realFile, text); count += changed; }
    }
    if (!count) return;

    if (cfg().get('links.updateOnRename') === 'prompt') {
      const what = renames.length === 1 ? `"${renames[0].oldName}" → "${renames[0].newName}"` : t('{0} renamed notes', renames.length);
      const pick = await vscode.window.showInformationMessage(
        t('Update {0} link(s) in {1} note(s) for {2}?', count, affected.size, what), t('Update'), t('Always'), t('Never'));
      if (pick === t('Always')) await cfg().update('links.updateOnRename', 'always', vscode.ConfigurationTarget.Global);
      if (pick === t('Never')) await cfg().update('links.updateOnRename', 'never', vscode.ConfigurationTarget.Global);
      if (pick !== t('Update') && pick !== t('Always')) return;
    }
    const edit = new vscode.WorkspaceEdit();
    for (const [file, text] of affected) await replaceAll(edit, file, text);
    await vscode.workspace.applyEdit(edit);
    await Promise.all([...affected.keys()].map(async f => (await vscode.workspace.openTextDocument(f)).save()));
    vscode.window.setStatusBarMessage(t('Notes: updated {0} link(s)', count), 3000);
  }

  /** Renames #old to #new across all notes. */
  async renameTagEverywhere(oldTag, newTag) {
    const edit = new vscode.WorkspaceEdit();
    let count = 0;
    const files = [];
    for (const [file, n] of this.index.cache) {
      if (!n.tags.includes(oldTag.toLowerCase())) continue;
      const res = renameTag(await fsp.readFile(file, 'utf8'), oldTag, newTag);
      if (!res.count) continue;
      await replaceAll(edit, file, res.text);
      count += res.count;
      files.push(file);
    }
    if (!count) return { count, files: 0 };
    await vscode.workspace.applyEdit(edit);
    await Promise.all(files.map(async f => (await vscode.workspace.openTextDocument(f)).save()));
    return { count, files: files.length };
  }
}

module.exports = { LinkTools };
