// Creating notes and tasks: new note/folder, daily notes and carrying tasks over, quick capture,
// Add Task, templates.
const vscode = require('vscode');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { newNote, openDaily, ensureDaily, previousDaily, dailyPath, quickCapture, listTemplates, templatesDir } = require('../capture');
const { mergeTemplates } = require('../builtinTemplates');
const { parseDue } = require('../dateParse');
const { insertTask, sections, takeOpenTasks, addUnderHeading } = require('../taskOps');
const { cfg, root, hidden, listOpts, isUnderRoot, openAt } = require('../util');
const { t } = require('../l10n');

const LAST_TARGET_KEY = 'notesExplorer.addTaskTarget';

/** Replaces a document's text through a WorkspaceEdit (keeps undo and open editors in step) and saves it. */
async function writeNote(file, text) {
  const doc = await vscode.workspace.openTextDocument(file);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), text);
  await vscode.workspace.applyEdit(edit);
  await doc.save();
}

module.exports = (ctx) => {
  const { reg, context, index, trees, requireRoot, targetDir, activeFile, reindex, reindexNow, reindexSoon } = ctx;

  reg('notesExplorer.newNote', async (item) => {
    requireRoot();
    if (await newNote(await targetDir(item))) reindexSoon();
  });
  reg('notesExplorer.newFolder', async (item) => {
    requireRoot();
    const name = await vscode.window.showInputBox({ prompt: t('New folder name') });
    if (!name) return;
    await fsp.mkdir(path.join(await targetDir(item), name), { recursive: true });
    trees.notes.refresh();
  });

  // --- Daily notes ---
  /**
   * Moves (or copies) unfinished tasks from the most recent earlier daily note into a "Carried over"
   * section of `todayFile`. Returns the number of tasks carried.
   */
  const carryOver = async (todayFile, mode) => {
    const prev = previousDaily(new Date());
    if (!prev || prev.toLowerCase() === todayFile.toLowerCase()) return 0;
    const prevText = (await vscode.workspace.openTextDocument(prev)).getText();
    const taken = takeOpenTasks(prevText);
    if (!taken.count) return 0;
    if (mode === 'ask') {
      const pick = await vscode.window.showInformationMessage(
        t('{0} unfinished task(s) in {1}. Bring them to today?', taken.count, path.basename(prev, '.md')),
        t('Move'), t('Copy'), t('Not Now'));
      if (pick === t('Move')) mode = 'move';
      else if (pick === t('Copy')) mode = 'copy';
      else return 0;
    }
    const todayText = (await vscode.workspace.openTextDocument(todayFile)).getText();
    await writeNote(todayFile, addUnderHeading(todayText, cfg().get('daily.carryOverHeading'), taken.tasks));
    if (mode === 'move') await writeNote(prev, taken.remaining);
    vscode.window.setStatusBarMessage(mode === 'move'
      ? t('Notes: moved {0} task(s) from {1}', taken.count, path.basename(prev, '.md'))
      : t('Notes: copied {0} task(s) from {1}', taken.count, path.basename(prev, '.md')), 4000);
    return taken.count;
  };

  reg('notesExplorer.openDaily', async () => {
    requireRoot();
    const { file, created } = await openDaily(0);
    // Offer yesterday's leftovers once, when the day's note is first created
    if (created && cfg().get('daily.carryOver') !== 'off') await carryOver(file, cfg().get('daily.carryOver'));
    reindexSoon();
  });
  reg('notesExplorer.openYesterday', async () => { requireRoot(); await openDaily(-1); reindexSoon(); });
  reg('notesExplorer.openDailyFor', async (date) => { requireRoot(); await openDaily(0, date); reindexNow(); });
  reg('notesExplorer.carryOver', async () => {
    requireRoot();
    const { file } = await ensureDaily(new Date());
    const n = await carryOver(file, 'ask');
    if (!n && !previousDaily(new Date())) vscode.window.showInformationMessage(t('No earlier daily note to carry tasks from.'));
    await openAt(file);
    reindexNow();
  });
  reg('notesExplorer.quickCapture', async () => { requireRoot(); if (await quickCapture()) reindexSoon(); });

  // --- Add Task ---
  /** Notes offered by Add Task, most useful first; the last one used is preselected. */
  const taskTargets = () => {
    const r = root();
    const seen = new Set();
    const out = [];
    const add = (file, label, icon, description) => {
      const k = file.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ label: `$(${icon}) ${label}`, description, file });
    };
    const last = context.globalState.get(LAST_TARGET_KEY);
    if (last && fs.existsSync(last) && isUnderRoot(last)) add(last, path.basename(last, path.extname(last)), 'history', t('last used'));
    for (const n of ['Tasks.md', 'Todos.md']) { const f = path.join(r, n); if (fs.existsSync(f)) add(f, n.replace('.md', ''), 'checklist'); }
    add(dailyPath(new Date()), t("Today's note"), 'calendar');
    const inbox = path.join(r, cfg().get('capture.note'));
    add(inbox, path.basename(inbox, path.extname(inbox)), 'inbox');
    const current = activeFile();
    if (current && isUnderRoot(current) && /\.(md|markdown|txt)$/i.test(current)) add(current, path.basename(current, path.extname(current)), 'edit', t('open note'));
    for (const p of ctx.store.pinned()) if (fs.existsSync(p) && /\.(md|markdown|txt)$/i.test(p)) add(p, path.basename(p, path.extname(p)), 'pinned', t('pinned'));
    out.push({ label: `$(search) ${t('Another note…')}`, other: true });
    return out;
  };

  reg('notesExplorer.addTask', async (preset) => {
    requireRoot();
    // 1. The task, with a live preview of the date understood from the text
    const raw = typeof preset === 'string' ? preset : await vscode.window.showInputBox({
      prompt: t('New task. Dates like "tomorrow", "by friday" or "30 oct" become a due date.'),
      placeHolder: t('Call the bank tomorrow'),
      validateInput: (v) => {
        const p = parseDue(v);
        return p.due ? { message: t('Due {0}: "{1}"', p.due, p.text), severity: vscode.InputBoxValidationSeverity.Info } : undefined;
      }
    });
    if (!raw || !raw.trim()) return;
    const parsed = parseDue(raw);
    const line = `- [ ] ${parsed.text}${parsed.due ? ` @due(${parsed.due})` : ''}`;

    // 2. Which note
    let pick = await vscode.window.showQuickPick(taskTargets(), { placeHolder: t('Add "{0}" to…', parsed.text), matchOnDescription: true });
    if (!pick) return;
    let file = pick.file;
    if (pick.other) {
      const files = (await index.listFiles(root(), hidden(), listOpts())).filter(f => /\.(md|markdown|txt)$/i.test(f));
      const other = await vscode.window.showQuickPick(files.map(f => ({ label: path.basename(f), description: path.relative(root(), path.dirname(f)), f })), { placeHolder: t('Add to which note?'), matchOnDescription: true });
      if (!other) return;
      file = other.f;
    }
    if (file.toLowerCase() === dailyPath(new Date()).toLowerCase()) await ensureDaily(new Date());
    if (!fs.existsSync(file)) {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, `# ${path.basename(file, path.extname(file))}\n\n`);
    }

    // 3. Which section, when the note has several (Enter keeps the suggested one)
    const text = (await vscode.workspace.openTextDocument(file)).getText();
    const secs = sections(text).filter(s => !/^(done|completed|archive)$/i.test(s.title));
    let section;
    if (secs.length > 1) {
      const suggested = insertTask(text, line).line;
      const items = secs.map(s => ({ label: s.title, s, picked: suggested > s.line && suggested <= s.end }));
      items.sort((a, b) => (b.picked ? 1 : 0) - (a.picked ? 1 : 0));
      const sp = await vscode.window.showQuickPick(items, { placeHolder: t('Section in {0}', path.basename(file, path.extname(file))) });
      if (!sp) return;
      section = sp.s.title;
    }
    await writeNote(file, insertTask(text, line, section).text);
    await context.globalState.update(LAST_TARGET_KEY, file);
    index.invalidate(file);
    await reindex();
    vscode.window.setStatusBarMessage(parsed.due
      ? t('Notes: added "{0}" to {1}, due {2}', parsed.text, path.basename(file, path.extname(file)), parsed.due)
      : t('Notes: added "{0}" to {1}', parsed.text, path.basename(file, path.extname(file))), 4000);
  });

  // --- Templates ---
  reg('notesExplorer.openTemplates', async () => {
    requireRoot();
    const dir = templatesDir();
    const { builtins, extra } = mergeTemplates(await listTemplates());
    const items = [
      { label: `$(add) ${t('New template…')}`, create: true },
      ...(extra.length ? [{ label: t('Your templates'), kind: vscode.QuickPickItemKind.Separator }] : []),
      ...extra.map(f => ({ label: `$(file-code) ${f.replace(/\.(md|markdown|txt)$/i, '')}`, description: f, f })),
      { label: t('Built-in (pick one to customise it)'), kind: vscode.QuickPickItemKind.Separator },
      ...builtins.map(b => ({
        label: `$(${b.icon}) ${b.name}`,
        description: b.overriddenBy ? t('customised in {0}', b.overriddenBy) : b.description,
        f: b.overriddenBy, builtin: b
      }))
    ];
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `${t('Templates in {0}', cfg().get('templatesFolder'))} · {{title}} {{date}} {{time}} {{date:FORMAT}} {{cursor}}`, matchOnDescription: true
    });
    if (!pick) return;
    await fsp.mkdir(dir, { recursive: true });
    if (pick.create) {
      let name = await vscode.window.showInputBox({ prompt: t('Template name'), placeHolder: 'Bug report' });
      if (!name) return;
      if (!path.extname(name)) name += '.md';
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) await fsp.writeFile(file, '# {{title}}\n\n{{cursor}}\n');
      return openAt(file);
    }
    // A built-in template is copied into the templates folder, where your edits replace the original
    if (pick.builtin && !pick.f) {
      const file = path.join(dir, `${pick.builtin.name}.md`);
      await fsp.writeFile(file, pick.builtin.body);
      vscode.window.setStatusBarMessage(t('Notes: "{0}" copied to {1}. Your changes now replace the built-in version.', pick.builtin.name, cfg().get('templatesFolder')), 5000);
      return openAt(file);
    }
    return openAt(path.join(dir, pick.f));
  });
};
