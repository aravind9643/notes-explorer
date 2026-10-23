// Masking values on screen, and password-encrypted notes.
const vscode = require('vscode');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { encrypt, decrypt, EXT: SECURE_EXT } = require('../secureNote');
const { itemPath, isUnderRoot, isSecureFile, secureUri, openAt, SECURE_SCHEME } = require('../util');
const { t } = require('../l10n');

/** Closes every editor tab whose document matches `test(uri)`. */
async function closeTabs(test, skipSave) {
  for (const tab of vscode.window.tabGroups.all.flatMap(g => g.tabs))
    if (tab.input && tab.input.uri && test(tab.input.uri)) await vscode.window.tabGroups.close(tab, skipSave);
}

module.exports = (ctx) => {
  const { reg, index, store, masker, secureFs, activeFile, reindex } = ctx;

  // --- Masking ---
  reg('notesExplorer.toggleMask', () => {
    if (!masker.regexes.length) {
      return vscode.window.showInformationMessage(t('Masking is off. Add patterns to "notesExplorer.mask.patterns" to hide sensitive values.'), t('Open Settings'))
        .then(p => p && vscode.commands.executeCommand('workbench.action.openSettings', 'notesExplorer.mask.patterns'));
    }
    const shown = masker.toggle();
    vscode.window.setStatusBarMessage(shown ? t('Notes: hidden values shown') : t('Notes: hidden values masked'), 2500);
  });
  reg('notesExplorer.copyMasked', async (value) => {
    await vscode.env.clipboard.writeText(value);
    vscode.window.setStatusBarMessage(t('Notes: copied hidden value'), 2500);
  });

  // --- Encrypted notes ---
  reg('notesExplorer.encryptNote', async (item) => {
    const file = itemPath(item) || activeFile();
    if (!file || !isUnderRoot(file) || isSecureFile(file)) throw new Error(t('choose a note to encrypt'));
    const ok = await vscode.window.showWarningMessage(
      t('Encrypt "{0}" with a password?', path.basename(file)), {
        modal: true,
        detail: t('The note is replaced by an encrypted copy and the original is deleted permanently (not to the Recycle Bin). It is no longer searchable, and if you forget the password the note cannot be recovered.')
      }, t('Encrypt'));
    if (ok !== t('Encrypt')) return;
    const password = await secureFs.askPassword(file, { confirm: true });
    const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath.toLowerCase() === file.toLowerCase());
    const text = doc ? doc.getText() : await fsp.readFile(file, 'utf8');
    const dest = file.replace(/\.(md|markdown|txt)$/i, '') + SECURE_EXT;
    if (fs.existsSync(dest)) throw new Error(t('"{0}" already exists', path.basename(dest)));
    await fsp.writeFile(dest, encrypt(text, password));
    decrypt(await fsp.readFile(dest, 'utf8'), password); // verify before removing the original
    await closeTabs(uri => uri.fsPath.toLowerCase() === file.toLowerCase(), true);
    await fsp.rm(file);
    secureFs.remember(dest, password);
    await store.renamed(file, dest);
    index.invalidate(file);
    await reindex();
    await vscode.window.showTextDocument(secureUri(dest), { preview: false });
  });
  reg('notesExplorer.decryptNote', async (item) => {
    const file = itemPath(item) || activeFile();
    if (!file || !isSecureFile(file)) throw new Error(t('choose an encrypted note'));
    const ok = await vscode.window.showWarningMessage(t('Remove the password from "{0}"?', path.basename(file)), {
      modal: true, detail: t('The note is saved as plain Markdown again and becomes searchable.')
    }, t('Remove Password'));
    if (ok !== t('Remove Password')) return;
    const text = (await secureFs.readFile(secureUri(file))).toString('utf8'); // asks for the password if needed
    const dest = file.replace(/\.mdenc$/i, '.md');
    if (fs.existsSync(dest)) throw new Error(t('"{0}" already exists', path.basename(dest)));
    await closeTabs(uri => uri.scheme === SECURE_SCHEME && itemPath(uri).toLowerCase() === file.toLowerCase(), true);
    await fsp.writeFile(dest, text);
    await fsp.rm(file);
    await store.renamed(file, dest);
    await reindex();
    await openAt(dest);
  });
  reg('notesExplorer.lockSecure', async () => {
    secureFs.lock();
    await closeTabs(uri => uri.scheme === SECURE_SCHEME, false);
    vscode.window.setStatusBarMessage(t('Notes: encrypted notes locked'), 2500);
  });
};
