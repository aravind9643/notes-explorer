const vscode = require('vscode');
const path = require('path');
const { root, today, cfg } = require('./util');
const { toggleTaskLine } = require('./editOps');
const { t } = require('./l10n');

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

/** Filter kinds shown in the Tasks view's filter picker. */
const FILTERS = {
  open: { label: () => t('All open tasks'), test: (x) => !x.done },
  overdue: { label: () => t('Overdue'), test: (x, td) => !x.done && x.due && x.due < td },
  today: { label: () => t('Due today or overdue'), test: (x, td) => !x.done && x.due && x.due <= td },
  week: { label: () => t('Due in the next 7 days'), test: (x, td) => !x.done && x.due && x.due <= addDays(td, 7) },
  nodue: { label: () => t('No due date'), test: (x) => !x.done && !x.due },
  done: { label: () => t('Completed in the last 7 days'), test: (x, td) => x.done && x.doneOn && x.doneOn >= addDays(td, -7) }
};

/**
 * Tasks from all notes. Grouped by file (elements { file } and task leaves), or a flat list sorted by
 * due date when sort = 'due'. State: { filter, tag, sort }.
 */
class TasksTree {
  constructor(index, state) {
    this.index = index;
    this.state = state; // globalState, to remember filter and sort
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
  }
  get view() { return { filter: 'open', tag: null, sort: 'file', ...this.state.get('notesExplorer.tasksView', {}) }; }
  async setView(patch) {
    const v = { ...this.view, ...patch };
    await this.state.update('notesExplorer.tasksView', v);
    vscode.commands.executeCommand('setContext', 'notesExplorer.tasksFiltered', v.filter !== 'open' || !!v.tag);
    this.refresh();
  }
  refresh() { this._emitter.fire(); }

  describe() {
    const v = this.view;
    return [FILTERS[v.filter] ? FILTERS[v.filter].label() : '', v.tag ? `#${v.tag}` : '', v.sort === 'due' ? t('by due date') : ''].filter(Boolean).join(' · ');
  }

  tasks() {
    const v = this.view, td = today();
    const f = FILTERS[v.filter] || FILTERS.open;
    return this.index.allTasks().filter(x => f.test(x, td) && (!v.tag || x.tags.includes(v.tag)));
  }

  getTreeItem(el) {
    if (el.kind === 'section') { // "## Heading" inside a note
      const item = new vscode.TreeItem(el.section || t('(no section)'), vscode.TreeItemCollapsibleState.Expanded);
      item.id = `section:${el.file}:${el.section}`;
      item.description = String(el.count);
      item.iconPath = new vscode.ThemeIcon('symbol-string');
      item.contextValue = 'taskSection';
      item.accessibilityInformation = { label: t('{0}, {1} tasks', item.label, el.count) };
      return item;
    }
    if (el.line === undefined) { // file group
      const count = el.count;
      const item = new vscode.TreeItem(path.basename(el.file).replace(/\.md$/i, ''), vscode.TreeItemCollapsibleState.Expanded);
      item.id = `group:${el.file}`;
      item.description = `${path.relative(root(), path.dirname(el.file))} · ${count}`.replace(/^ · /, '');
      item.resourceUri = vscode.Uri.file(el.file);
      item.iconPath = new vscode.ThemeIcon('checklist');
      item.contextValue = 'taskFile';
      item.accessibilityInformation = { label: t('{0}, {1} tasks', item.label, count) };
      return item;
    }
    const item = new vscode.TreeItem(el.text || t('(empty task)'), vscode.TreeItemCollapsibleState.None);
    item.id = `task:${el.file}:${el.line}`;
    item.contextValue = el.done ? 'taskDone' : 'task';
    item.tooltip = `${el.text}\n${el.file}:${el.line + 1}`;
    const td = today();
    const flat = this.view.sort === 'due';
    const where = flat ? path.basename(el.file).replace(/\.md$/i, '') : '';
    if (el.done) {
      item.description = [el.doneOn ? t('done {0}', el.doneOn) : t('done'), where].filter(Boolean).join(' · ');
      item.iconPath = new vscode.ThemeIcon('pass-filled');
    } else if (el.due) {
      const when = el.due < td ? t('overdue · {0}', el.due) : el.due === td ? t('due today') : t('due {0}', el.due);
      item.description = [when, where].filter(Boolean).join(' · ');
      item.iconPath = new vscode.ThemeIcon(el.due <= td ? 'warning' : 'calendar',
        el.due < td ? new vscode.ThemeColor('errorForeground') : el.due === td ? new vscode.ThemeColor('editorWarning.foreground') : undefined);
    } else {
      item.description = where || undefined;
      item.iconPath = new vscode.ThemeIcon('circle-large-outline');
    }
    item.accessibilityInformation = { label: [el.done ? t('Completed task') : t('Task'), el.text, item.description].filter(Boolean).join(', ') };
    item.command = { command: 'notesExplorer.openTask', title: t('Open'), arguments: [el] };
    return item;
  }

  getChildren(el) {
    const list = this.tasks();
    if (this.view.sort === 'due') {
      if (el) return [];
      // No due date sorts last; then by file and line
      return list.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.file.localeCompare(b.file) || a.line - b.line);
    }
    if (!el) {
      const counts = new Map();
      for (const x of list) counts.set(x.file, (counts.get(x.file) || 0) + 1);
      return [...counts].map(([file, count]) => ({ file, count }));
    }
    const inFile = list.filter(x => x.file === el.file);
    if (el.kind === 'section') return inFile.filter(x => (x.section || null) === el.section);
    // Notes with tasks under two or more "##" headings show those headings as a middle level
    const order = [...new Set(inFile.map(x => x.section || null))];
    if (!cfg().get('tasks.groupBySection') || order.length < 2) return inFile;
    return order.map(section => ({ kind: 'section', file: el.file, section, count: inFile.filter(x => (x.section || null) === section).length }));
  }

  getParent(el) {
    if (el.kind === 'section') return { file: el.file };
    return undefined;
  }
}

/** Flips `[ ]` <-> `[x]` on a task line via a WorkspaceEdit, so undo and open editors stay consistent. */
async function toggleTask(task) {
  const doc = await vscode.workspace.openTextDocument(task.file);
  const line = doc.lineAt(task.line);
  const next = toggleTaskLine(line.text, cfg().get('tasks.stampCompletion') ? today() : null);
  if (next === null) throw new Error(t('that line is no longer a task. Refresh and try again.'));
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, line.range, next);
  await vscode.workspace.applyEdit(edit);
  await doc.save();
}

module.exports = { TasksTree, toggleTask, FILTERS };
