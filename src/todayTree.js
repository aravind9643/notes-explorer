const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { root, cfg, today } = require('./util');
const { formatDate } = require('./templates');
const { t } = require('./l10n');

/** Path of the daily note for a date (it may not exist yet). */
const dailyFile = (d = new Date()) => path.join(root(), cfg().get('daily.folder'), `${formatDate(d, cfg().get('daily.fileNameFormat'))}.md`);

/**
 * "Today" view: today's note, then overdue tasks and tasks due today, from every note.
 * Elements: { kind: 'daily' } | { kind: 'group', group: 'overdue' | 'today' } | task objects.
 */
class TodayTree {
  constructor(index) {
    this.index = index;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
  }
  refresh() { this._emitter.fire(); }

  groups() {
    const td = today();
    const open = this.index.openTasks().filter(x => x.due);
    return {
      overdue: open.filter(x => x.due < td).sort((a, b) => a.due.localeCompare(b.due)),
      today: open.filter(x => x.due === td)
    };
  }

  getTreeItem(el) {
    if (el.kind === 'daily') {
      const file = dailyFile();
      const exists = fs.existsSync(file);
      const item = new vscode.TreeItem(exists ? t("Today's note") : t("Start today's note"), vscode.TreeItemCollapsibleState.None);
      item.id = 'today:daily';
      item.description = formatDate(new Date(), 'dddd, DD MMM');
      item.iconPath = new vscode.ThemeIcon(exists ? 'calendar' : 'add');
      item.tooltip = file;
      item.command = { command: 'notesExplorer.openDaily', title: t("Open Today's Note") };
      item.accessibilityInformation = { label: `${item.label}, ${item.description}` };
      return item;
    }
    if (el.kind === 'group') {
      const list = this.groups()[el.group];
      const overdue = el.group === 'overdue';
      const item = new vscode.TreeItem(overdue ? t('Overdue') : t('Due today'), vscode.TreeItemCollapsibleState.Expanded);
      item.id = `today:${el.group}`;
      item.description = String(list.length);
      item.iconPath = new vscode.ThemeIcon(overdue ? 'warning' : 'bell', overdue ? new vscode.ThemeColor('errorForeground') : undefined);
      item.accessibilityInformation = { label: t('{0}, {1} tasks', item.label, list.length) };
      return item;
    }
    const item = new vscode.TreeItem(el.text || t('(empty task)'), vscode.TreeItemCollapsibleState.None);
    item.id = `today:task:${el.file}:${el.line}`;
    item.contextValue = 'task';
    item.description = [el.due < today() ? el.due : '', path.basename(el.file).replace(/\.md$/i, '')].filter(Boolean).join(' · ');
    item.tooltip = `${el.text}\n${path.relative(root(), el.file)}:${el.line + 1}`;
    item.iconPath = new vscode.ThemeIcon('circle-large-outline');
    item.accessibilityInformation = { label: [t('Task'), el.text, item.description].join(', ') };
    item.command = { command: 'notesExplorer.openTask', title: t('Open'), arguments: [el] };
    return item;
  }

  getChildren(el) {
    if (!root()) return [];
    if (!el) {
      const g = this.groups();
      return [{ kind: 'daily' }, ...(['overdue', 'today'].filter(k => g[k].length).map(group => ({ kind: 'group', group })))];
    }
    if (el.kind === 'group') return this.groups()[el.group];
    return [];
  }
}

module.exports = { TodayTree, dailyFile };
