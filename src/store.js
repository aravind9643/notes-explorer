// Per-machine state kept in globalState: pinned/recent notes, code-file → note links, project → folder links.
// Paths are machine-specific, so none of these keys are synced.
const vscode = require('vscode');

const KEYS = { pinned: 'notesExplorer.pinned', recent: 'notesExplorer.recent', fileLinks: 'notesExplorer.fileLinks', projectLinks: 'notesExplorer.projectLinks' };
const MAX_RECENT = 10;
const norm = (p) => p.toLowerCase();

class Store {
  constructor(state) {
    this.state = state;
    this._emitter = new vscode.EventEmitter();
    this.onDidChange = this._emitter.event;
  }
  _get(k, dflt) { return this.state.get(KEYS[k], dflt); }
  async _set(k, v) { await this.state.update(KEYS[k], v); this._emitter.fire(k); }

  pinned() { return this._get('pinned', []); }
  isPinned(file) { return this.pinned().some(p => norm(p) === norm(file)); }
  pin(file) { return this.isPinned(file) ? undefined : this._set('pinned', [...this.pinned(), file]); }
  unpin(file) { return this._set('pinned', this.pinned().filter(p => norm(p) !== norm(file))); }

  recent() { return this._get('recent', []); }
  touch(file) {
    const list = [file, ...this.recent().filter(p => norm(p) !== norm(file))].slice(0, MAX_RECENT);
    if (list.join('|') === this.recent().join('|')) return;
    return this._set('recent', list);
  }
  clearRecent() { return this._set('recent', []); }

  /** Notes linked to a code file. */
  notesFor(file) { return (this._get('fileLinks', {})[norm(file)] || []); }
  linkNote(file, note) {
    const all = { ...this._get('fileLinks', {}) };
    const list = all[norm(file)] || [];
    if (!list.some(n => norm(n) === norm(note))) all[norm(file)] = [...list, note];
    return this._set('fileLinks', all);
  }
  unlinkNote(file, note) {
    const all = { ...this._get('fileLinks', {}) };
    all[norm(file)] = (all[norm(file)] || []).filter(n => norm(n) !== norm(note));
    if (!all[norm(file)].length) delete all[norm(file)];
    return this._set('fileLinks', all);
  }

  /** Notes folder linked to a workspace (project) folder. */
  projectFolder(workspacePath) { return this._get('projectLinks', {})[norm(workspacePath)]; }
  linkProject(workspacePath, folder) { return this._set('projectLinks', { ...this._get('projectLinks', {}), [norm(workspacePath)]: folder }); }
  unlinkProject(workspacePath) {
    const all = { ...this._get('projectLinks', {}) };
    delete all[norm(workspacePath)];
    return this._set('projectLinks', all);
  }

  /** Keeps stored paths pointing at renamed/moved notes. */
  async renamed(from, to) {
    const swap = (p) => (norm(p) === norm(from) ? to : norm(p).startsWith(norm(from) + require('path').sep) ? to + p.slice(from.length) : p);
    await this.state.update(KEYS.pinned, this.pinned().map(swap));
    await this.state.update(KEYS.recent, this.recent().map(swap));
    const links = this._get('fileLinks', {});
    for (const k of Object.keys(links)) links[k] = links[k].map(swap);
    await this.state.update(KEYS.fileLinks, links);
    const projects = this._get('projectLinks', {});
    for (const k of Object.keys(projects)) projects[k] = swap(projects[k]);
    await this.state.update(KEYS.projectLinks, projects);
    this._emitter.fire('all');
  }
}

module.exports = { Store };
