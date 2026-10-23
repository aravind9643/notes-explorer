// Note creation: templates, daily note, quick capture.
const vscode = require('vscode');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { cfg, root, openAt } = require('./util');
const { formatDate, renderTemplate } = require('./templates');
const { mergeTemplates, builtinByName } = require('./builtinTemplates');
const { t } = require('./l10n');

const templatesDir = () => path.join(root(), cfg().get('templatesFolder'));

async function listTemplates() {
  try {
    return (await fsp.readdir(templatesDir())).filter(f => /\.(md|markdown|txt)$/i.test(f)).sort();
  } catch { return []; } // no templates folder yet
}

async function readTemplate(name) {
  try { return await fsp.readFile(path.join(templatesDir(), name), 'utf8'); } catch { return null; }
}

/** Writes a note from a template (if it doesn't exist yet) and opens it with the caret at {{cursor}}. */
async function createFromTemplate(file, template, title) {
  let cursor = null;
  if (!fs.existsSync(file)) {
    const r = renderTemplate(template, { title, dateFormat: cfg().get('dateFormat') });
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, r.text);
    cursor = r.cursor;
  }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const at = cursor || { line: Math.max(0, lines.length - 1), col: lines[lines.length - 1].length };
  await openAt(file, at.line, at.col);
  return file;
}

const BLANK = '# {{title}}\n\n{{cursor}}';

/** Asks which template to use (built-in and your own); returns template text, or undefined if cancelled. */
async function pickTemplate() {
  const { builtins, extra } = mergeTemplates(await listTemplates());
  const items = [{ label: `$(file) ${t('Blank note')}`, template: BLANK }];
  if (extra.length) {
    items.push({ label: t('Your templates'), kind: vscode.QuickPickItemKind.Separator },
      ...extra.map(n => ({ label: `$(file-code) ${n.replace(/\.(md|markdown|txt)$/i, '')}`, description: n, name: n })));
  }
  if (cfg().get('templates.showBuiltIn')) {
    items.push({ label: t('Built-in'), kind: vscode.QuickPickItemKind.Separator },
      ...builtins.map(b => ({
        label: `$(${b.icon}) ${t(b.name)}`,
        description: b.overriddenBy ? t('customised in {0}', b.overriddenBy) : t(b.description),
        name: b.overriddenBy, template: b.overriddenBy ? undefined : b.body
      })));
  }
  if (items.length === 1) return BLANK;
  const pick = await vscode.window.showQuickPick(items, { placeHolder: t('Choose a template'), matchOnDescription: true });
  if (!pick) return undefined;
  return pick.template || (pick.name && (await readTemplate(pick.name))) || BLANK;
}

/** Template text for a name: your file in the templates folder, else the built-in one. */
async function templateText(name) {
  const own = await readTemplate(name);
  if (own !== null) return own;
  const b = builtinByName(name);
  return b ? b.body : null;
}

async function newNote(dir) {
  let name = await vscode.window.showInputBox({
    prompt: t('New note in {0}', path.relative(root(), dir) || t('Notes')),
    placeHolder: t('Meeting notes'),
    validateInput: (v) => (/[<>:"|?*]/.test(v) ? t('A note name cannot contain < > : " | ? *') : undefined)
  });
  if (!name) return;
  const template = await pickTemplate();
  if (template === undefined) return;
  if (!path.extname(name)) name += '.md';
  return createFromTemplate(path.join(dir, name), template, path.basename(name, path.extname(name)));
}

/** Opens a daily note (creating it from templates/daily.md, if present): today + `offsetDays`, or `date`. */
const dailyPath = (d) => path.join(root(), cfg().get('daily.folder'), `${formatDate(d, cfg().get('daily.fileNameFormat'))}.md`);

/** Creates the daily note for a date from its template if it doesn't exist. Returns { file, created, cursor }. */
async function ensureDaily(d) {
  const file = dailyPath(d);
  if (fs.existsSync(file)) return { file, created: false, cursor: null };
  // "daily.md" in the templates folder if you have one, otherwise the built-in Daily template
  const template = (await templateText(cfg().get('daily.template'))) || '# {{date:dddd, DD MMMM YYYY}}\n\n{{cursor}}';
  const r = renderTemplate(template, { title: path.basename(file, '.md'), now: d, dateFormat: cfg().get('dateFormat') });
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, r.text, { flag: 'wx' }).catch(err => { if (err.code !== 'EEXIST') throw err; });
  return { file, created: true, cursor: r.cursor };
}

/**
 * The most recent daily note before `d` (looking back up to 60 days), whatever the file name format.
 * Weekends and days off are skipped naturally, because only existing notes count.
 */
function previousDaily(d) {
  for (let back = 1; back <= 60; back++) {
    const f = dailyPath(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back));
    if (fs.existsSync(f)) return f;
  }
  return null;
}

async function openDaily(offsetDays = 0, date) {
  const d = date ? new Date(date) : new Date();
  if (!date) d.setDate(d.getDate() + offsetDays);
  const { file, created, cursor } = await ensureDaily(d);
  if (created) {
    const at = cursor || { line: 0, col: 0 };
    await openAt(file, at.line, at.col);
  } else await openAt(file, fs.readFileSync(file, 'utf8').split(/\r?\n/).length - 1);
  return { file, created };
}

/** Appends one line to the inbox note without leaving the current editor. */
async function quickCapture() {
  // Where captures go: the inbox note (capture.note), today's daily note, or ask each time
  const inbox = path.join(root(), cfg().get('capture.note'));
  const daily = path.join(root(), cfg().get('daily.folder'), `${formatDate(new Date(), cfg().get('daily.fileNameFormat'))}.md`);
  let file = cfg().get('capture.target') === 'daily' ? daily : inbox;
  if (cfg().get('capture.target') === 'ask') {
    const others = ['Todos.md', 'Tasks.md'].map(n => path.join(root(), n)).filter(f => fs.existsSync(f) && f.toLowerCase() !== inbox.toLowerCase());
    const pick = await vscode.window.showQuickPick([
      { label: `$(inbox) ${path.basename(inbox, path.extname(inbox))}`, f: inbox },
      { label: `$(calendar) ${t("Today's note")}`, f: daily },
      ...others.map(f => ({ label: `$(checklist) ${path.basename(f, '.md')}`, f }))
    ], { placeHolder: t('Capture to…') });
    if (!pick) return;
    file = pick.f;
  }
  const text = await vscode.window.showInputBox({ prompt: t('Capture to {0}', path.relative(root(), file)), placeHolder: t('Type a thought, task or link…') });
  if (!text) return;
  if (file === daily) await ensureDaily(new Date()); // a new daily note starts from its template
  const line = renderTemplate(cfg().get('capture.format'), { text, dateFormat: cfg().get('dateFormat') }).text;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  let prefix = '';
  if (fs.existsSync(file)) {
    const existing = await fsp.readFile(file, 'utf8');
    if (existing && !existing.endsWith('\n')) prefix = '\n';
  } else prefix = `# ${path.basename(file, path.extname(file))}\n\n`;
  await fsp.appendFile(file, `${prefix}${line}\n`);
  const pick = await vscode.window.showInformationMessage(t('Captured to {0}', path.basename(file)), t('Open'));
  if (pick) await openAt(file, fs.readFileSync(file, 'utf8').split(/\r?\n/).length - 2);
  return file;
}

module.exports = { newNote, openDaily, ensureDaily, previousDaily, dailyPath, quickCapture, listTemplates, templatesDir };
