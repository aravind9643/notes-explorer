// Virtual file system for encrypted notes (.mdenc). Opening "notes-secure:/…/Note.mdenc.md" asks for the
// password once per session, decrypts into the editor, and every save re-encrypts to disk. Plain text is
// only ever in memory; passwords are kept in memory until "Lock Encrypted Notes" or the window closes.
const vscode = require('vscode');
const fs = require('fs/promises');
const path = require('path');
const { encrypt, decrypt } = require('./secureNote');
const { SECURE_SCHEME, fileOfSecureUri } = require('./util');
const { t } = require('./l10n');

class SecureNotesFs {
  constructor() {
    this.passwords = new Map(); // lower-cased file path → password
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeFile = this._emitter.event;
  }

  key(file) { return file.toLowerCase(); }
  lock() { this.passwords.clear(); }
  remember(file, password) { this.passwords.set(this.key(file), password); }

  async askPassword(file, { confirm = false, retry = false } = {}) {
    const name = path.basename(file, path.extname(file));
    const pw = await vscode.window.showInputBox({
      password: true, ignoreFocusOut: true,
      prompt: retry ? t('Wrong password for "{0}". Try again.', name) : t('Password for "{0}"', name),
      validateInput: (v) => (v ? undefined : t('Enter a password'))
    });
    if (!pw) throw vscode.FileSystemError.NoPermissions(t('no password entered'));
    if (confirm) {
      const again = await vscode.window.showInputBox({ password: true, ignoreFocusOut: true, prompt: t('Repeat the password. It cannot be recovered if you forget it.') });
      if (again !== pw) throw new Error(t('the passwords do not match'));
    }
    return pw;
  }

  // --- FileSystemProvider ---
  watch() { return new vscode.Disposable(() => {}); }

  async stat(uri) {
    const st = await this._wrap(() => fs.stat(fileOfSecureUri(uri)));
    return { type: vscode.FileType.File, ctime: st.ctimeMs, mtime: st.mtimeMs, size: st.size };
  }

  async readFile(uri) {
    const file = fileOfSecureUri(uri);
    const raw = await this._wrap(() => fs.readFile(file, 'utf8'));
    let pw = this.passwords.get(this.key(file));
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!pw) pw = await this.askPassword(file, { retry: attempt > 0 });
      try {
        const text = decrypt(raw, pw);
        this.remember(file, pw);
        return Buffer.from(text, 'utf8');
      } catch (err) {
        if (err.code !== 'WRONG_PASSWORD') throw err;
        this.passwords.delete(this.key(file));
        pw = null;
      }
    }
    throw vscode.FileSystemError.NoPermissions(t('wrong password'));
  }

  async writeFile(uri, content) {
    const file = fileOfSecureUri(uri);
    let pw = this.passwords.get(this.key(file));
    if (!pw) { pw = await this.askPassword(file, { confirm: true }); this.remember(file, pw); }
    await fs.writeFile(file, encrypt(Buffer.from(content).toString('utf8'), pw));
    this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  readDirectory() { return []; }
  createDirectory() { throw vscode.FileSystemError.NoPermissions(); }
  async delete(uri) { await fs.rm(fileOfSecureUri(uri), { force: true }); }
  async rename(oldUri, newUri) { await fs.rename(fileOfSecureUri(oldUri), fileOfSecureUri(newUri)); }

  async _wrap(fn) {
    try { return await fn(); }
    catch (err) {
      if (err.code === 'ENOENT') throw vscode.FileSystemError.FileNotFound();
      throw err;
    }
  }
}

module.exports = { SecureNotesFs, SECURE_SCHEME };
