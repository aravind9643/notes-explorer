// Note creation: templates, daily note, quick capture.
const vscode = require('vscode');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { cfg, root, openAt } = require('./util');
const { formatDate, renderTemplate } = require('./templates');
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

/** Asks which template to use; returns template text, or undefined if cancelled. */
async function pickTemplate() {
  const names = await listTemplates();
  if (!names.length) return '# {{title}}\n\n{{cursor}}';
  const blank = { label: `$(file) ${t('Blank note')}`, template: '# {{title}}\n\n{{cursor}}' };
  const items = [blank, ...names.map(n => ({ label: `$(file-code) ${n.replace(/\.(md|markdown|txt)$/i, '')}`, description: n, name: n }))];
  const pick = await vscode.window.showQuickPick(items, { placeHolder: t('Choose a template') });
  if (!pick) return undefined;
  return pick.template || (await readTemplate(pick.name)) || blank.template;
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
async function openDaily(offsetDays = 0, date) {
  const d = date ? new Date(date) : new Date();
  if (!date) d.setDate(d.getDate() + offsetDays);
  const name = formatDate(d, cfg().get('daily.fileNameFormat'));
  const file = path.join(root(), cfg().get('daily.folder'), `${name}.md`);
  const template = (await readTemplate(cfg().get('daily.template'))) || '# {{date:dddd, DD MMMM YYYY}}\n\n{{cursor}}';
  const r = renderTemplate(template, { title: name, now: d, dateFormat: cfg().get('dateFormat') });
  if (!fs.existsSync(file)) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, r.text);
    const at = r.cursor || { line: 0, col: 0 };
    await openAt(file, at.line, at.col);
  } else await openAt(file, fs.readFileSync(file, 'utf8').split(/\r?\n/).length - 1);
  return file;
}

/** Appends one line to the inbox note without leaving the current editor. */
async function quickCapture() {
  const text = await vscode.window.showInputBox({ prompt: t('Capture to {0}', cfg().get('capture.note')), placeHolder: t('Type a thought, task or link…') });
  if (!text) return;
  const file = path.join(root(), cfg().get('capture.note'));
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

module.exports = { newNote, openDaily, quickCapture };
