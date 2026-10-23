// Hides text matching user-defined patterns while a note is on screen. The file itself is never changed.
// Off by default: nothing is masked until `notesExplorer.mask.patterns` has entries.
const vscode = require('vscode');
const { cfg, isUnderRoot } = require('./util');
const { t } = require('./l10n');

const { compile, findMasked } = require('./maskMatch');

class Masker {
  constructor() {
    this.revealed = false; // session-wide "show values" toggle
    this.regexes = compile(cfg().get('mask.patterns'));
    this.decoration = this._makeDecoration();
  }

  _makeDecoration() {
    // Value text is made invisible and collapsed; a fixed-width placeholder is drawn before it instead
    return vscode.window.createTextEditorDecorationType({
      opacity: '0',
      letterSpacing: '-1ch',
      before: { contentText: '••••••', color: new vscode.ThemeColor('editorCodeLens.foreground') }
    });
  }

  reload() { this.regexes = compile(cfg().get('mask.patterns')); this.updateAll(); }

  active() { return this.regexes.length > 0 && !this.revealed; }

  rangesFor(doc) {
    if (!this.regexes.length || !isUnderRoot(doc.uri.fsPath)) return [];
    const out = [];
    for (let i = 0; i < doc.lineCount; i++)
      for (const r of findMasked(doc.lineAt(i).text, this.regexes))
        out.push({ range: new vscode.Range(i, r.start, i, r.end), value: r.value });
    return out;
  }

  update(editor) {
    if (!editor) return;
    if (!this.active()) return editor.setDecorations(this.decoration, []);
    editor.setDecorations(this.decoration, this.rangesFor(editor.document).map(r => ({ range: r.range })));
  }
  updateAll() { vscode.window.visibleTextEditors.forEach(e => this.update(e)); }

  toggle() {
    this.revealed = !this.revealed;
    vscode.commands.executeCommand('setContext', 'notesExplorer.maskRevealed', this.revealed);
    this.updateAll();
    return this.revealed;
  }

  /** Hover over a masked value: a "Copy value" link, so it can be used without being shown. */
  provideHover(doc, pos) {
    if (!this.active()) return;
    const hit = this.rangesFor(doc).find(r => r.range.contains(pos));
    if (!hit) return;
    const args = encodeURIComponent(JSON.stringify([hit.value]));
    const md = new vscode.MarkdownString(`$(lock) ${t('Hidden value')} — [${t('Copy')}](command:notesExplorer.copyMasked?${args}) · [${t('Show all')}](command:notesExplorer.toggleMask)`, true);
    md.isTrusted = { enabledCommands: ['notesExplorer.copyMasked', 'notesExplorer.toggleMask'] };
    return new vscode.Hover(md, hit.range);
  }

  dispose() { this.decoration.dispose(); }
}

module.exports = { Masker };
