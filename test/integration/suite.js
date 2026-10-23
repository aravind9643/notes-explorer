// Integration suite: runs inside a real VS Code extension host against a temporary notes folder.
// Prompts (input boxes, pickers, dialogs) are answered by temporarily replacing the vscode.window functions.
const vscode = require('vscode');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.NOTES_IT_ROOT;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(ROOT, f)), { recursive: true }); fs.writeFileSync(path.join(ROOT, f), s); };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
}

/** Replaces vscode.window prompt functions for the duration of `fn`, answering from the given queues. */
async function answering(answers, fn) {
  const w = vscode.window;
  const saved = {};
  const queue = (name, fallback) => {
    saved[name] = w[name];
    w[name] = async (...args) => {
      const q = answers[name];
      if (!q || !q.length) return fallback;
      const a = q.shift();
      return typeof a === 'function' ? a(...args) : a;
    };
  };
  for (const name of ['showInputBox', 'showQuickPick', 'showSaveDialog', 'showOpenDialog', 'showInformationMessage', 'showWarningMessage']) queue(name, undefined);
  try { return await fn(); } finally { Object.assign(w, saved); }
}

const errors = [];
const results = [];
async function step(name, fn) {
  const before = errors.length;
  try {
    await fn();
    if (errors.length > before) throw new Error(`command reported: ${errors.slice(before).join(' | ')}`);
    results.push(`  ✔ ${name}`);
  } catch (err) {
    results.push(`  ✖ ${name}\n      ${err.stack || err}`);
    throw Object.assign(err, { step: name });
  }
}

async function run() {
  // Any error a command shows (our `safe` wrapper) fails the current step
  const origErr = vscode.window.showErrorMessage;
  vscode.window.showErrorMessage = (msg, ...rest) => { errors.push(msg); return origErr(msg, ...rest); };
  let failed = 0;
  const tryStep = async (name, fn) => { try { await step(name, fn); } catch { failed++; } };

  write('Work/Project.md', '# Project\n\n## To do\n\n- [ ] Write spec #work @due(2020-01-01)\n- [x] Kickoff\n\n## Done\n');
  write('Links/A.md', 'See [[B]] and [[Missing Note]]\n');
  write('Links/B.md', '# B\n\nThe B note body. #ideas\n');
  write('Secrets.md', 'user: bob\npassword: Hunter2!\n');

  const ext = vscode.extensions.getExtension('AravindMerugu.notes-explorer');
  await tryStep('extension activates', async () => {
    assert.ok(ext, 'extension found');
    await ext.activate();
    assert.ok(ext.isActive);
  });

  await tryStep('every declared command is registered', async () => {
    const all = new Set(await vscode.commands.getCommands(true));
    const missing = ext.packageJSON.contributes.commands.map(c => c.command).filter(c => !all.has(c));
    assert.deepStrictEqual(missing, []);
  });

  await tryStep('refresh indexes the notes folder', async () => {
    await vscode.commands.executeCommand('notesExplorer.refresh');
  });

  await tryStep("daily note is created and opened", async () => {
    await vscode.commands.executeCommand('notesExplorer.openDaily');
    const file = path.join(ROOT, 'Daily', `${today()}.md`);
    await until(() => fs.existsSync(file), 'daily note file');
    await until(() => vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.fsPath.toLowerCase() === file.toLowerCase(), 'daily note editor');
  });

  await tryStep('quick capture appends to the inbox', async () => {
    await answering({ showInputBox: ['remember the milk'] }, () => vscode.commands.executeCommand('notesExplorer.quickCapture'));
    assert.match(read('Inbox.md'), /- remember the milk\n/);
  });

  await tryStep('new note from a template, caret at {{cursor}}', async () => {
    write('.templates/Meeting.md', '# {{title}}\n\nDate: {{date}}\n\n{{cursor}}\n');
    await answering({ showInputBox: ['Standup'], showQuickPick: [(items) => items.find(i => /Meeting/.test(i.label))] },
      () => vscode.commands.executeCommand('notesExplorer.newNote'));
    const text = await until(() => fs.existsSync(path.join(ROOT, 'Standup.md')) && read('Standup.md'), 'Standup.md');
    assert.strictEqual(text, `# Standup\n\nDate: ${today()}\n\n\n`);
    const ed = vscode.window.activeTextEditor;
    assert.strictEqual(ed.selection.active.line, 4);
  });

  await tryStep('built-in templates are offered without any template files', async () => {
    let offered;
    await answering({ showInputBox: ['Login fails'], showQuickPick: [(items) => { offered = items; return items.find(i => /Bug report/.test(i.label)); }] },
      () => vscode.commands.executeCommand('notesExplorer.newNote'));
    const labels = offered.filter(i => i.kind !== vscode.QuickPickItemKind.Separator).map(i => i.label.replace(/^\$\([\w-]+\) /, ''));
    for (const name of ['Blank note', 'Meeting', 'Daily', 'Weekly review', 'Project', '1-on-1', 'Standup', 'Bug report', 'Decision record', 'Retrospective', 'How-to', 'Reading notes', 'Credentials', 'Checklist'])
      assert.ok(labels.includes(name), `${name} offered`);
    const text = await until(() => fs.existsSync(path.join(ROOT, 'Login fails.md')) && read('Login fails.md'), 'bug note');
    assert.match(text, /^# Bug: Login fails\n/);
    assert.match(text, /## Steps to reproduce/);
    assert.doesNotMatch(text, /\{\{/);
  });

  await tryStep('Credentials template offers encryption right away', async () => {
    await answering({
      showInputBox: ['Work logins', 'pw for logins', 'pw for logins'],
      showQuickPick: [(items) => items.find(i => /Credentials/.test(i.label))],
      showWarningMessage: ['Encrypt Now', 'Encrypt']
    }, () => vscode.commands.executeCommand('notesExplorer.newNote'));
    const enc = path.join(ROOT, 'Work logins.mdenc');
    await until(() => fs.existsSync(enc) && !fs.existsSync(path.join(ROOT, 'Work logins.md')), 'encrypted credentials note');
    const text = require('../../src/secureNote').decrypt(fs.readFileSync(enc, 'utf8'), 'pw for logins');
    assert.match(text, /^# Work logins\n/);
    assert.match(text, /## Production[\s\S]*\*\*Password:\*\*/);
    assert.doesNotMatch(fs.readFileSync(enc, 'utf8'), /Production|Password/);
    await vscode.commands.executeCommand('notesExplorer.lockSecure');
  });

  await tryStep('marking a task done stamps the date', async () => {
    await vscode.commands.executeCommand('notesExplorer.toggleTask', { file: path.join(ROOT, 'Work/Project.md'), line: 4 });
    await until(() => read('Work/Project.md').includes(`- [x] Write spec #work @due(2020-01-01) ✓ ${today()}`), 'stamped task');
  });

  await tryStep('completed tasks move to the archive section', async () => {
    await vscode.commands.executeCommand('notesExplorer.archiveCompleted', path.join(ROOT, 'Work/Project.md'));
    const text = await until(() => read('Work/Project.md').includes('## Completed') && read('Work/Project.md'), 'archive section');
    assert.match(text, new RegExp(`## Completed\\n\\n### ${today()}\\n- \\[x\\] Write spec`));
    assert.match(text, /- \[x\] Kickoff/);
    assert.ok(!/## To do\n\n- \[x\]/.test(text), 'done tasks left the To do column');
  });

  await tryStep('missing [[link]] is reported with a quick fix', async () => {
    await vscode.commands.executeCommand('notesExplorer.refresh');
    const uri = vscode.Uri.file(path.join(ROOT, 'Links/A.md'));
    const diags = await until(() => { const d = vscode.languages.getDiagnostics(uri); return d.length ? d : null; }, 'diagnostics');
    assert.strictEqual(diags.length, 1);
    assert.match(diags[0].message, /Missing Note/);
    await vscode.workspace.openTextDocument(uri);
    const actions = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', uri, diags[0].range);
    assert.ok(actions.some(a => /Create note "Missing Note"/.test(a.title)), 'create-note quick fix offered');
  });

  await tryStep('hovering a [[link]] previews the note', async () => {
    const uri = vscode.Uri.file(path.join(ROOT, 'Links/A.md'));
    const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', uri, new vscode.Position(0, 6));
    const text = hovers.flatMap(h => h.contents.map(c => (typeof c === 'string' ? c : c.value))).join('\n');
    assert.match(text, /The B note body/);
  });

  await tryStep('renaming a note updates [[links]] to it', async () => {
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(vscode.Uri.file(path.join(ROOT, 'Links/B.md')), vscode.Uri.file(path.join(ROOT, 'Links/Bee.md')));
    assert.ok(await vscode.workspace.applyEdit(edit));
    await until(() => read('Links/A.md').includes('[[Bee]]'), 'link rewritten');
    assert.ok(read('Links/A.md').includes('[[Missing Note]]'), 'other links untouched');
  });

  await tryStep('renaming a tag updates every note', async () => {
    await vscode.commands.executeCommand('notesExplorer.refresh');
    await answering({ showQuickPick: [(items) => items.find(i => i.tag === 'ideas')], showInputBox: ['thoughts'] },
      () => vscode.commands.executeCommand('notesExplorer.renameTag'));
    await until(() => read('Links/Bee.md').includes('#thoughts'), 'tag renamed');
  });

  await tryStep('masking hides matched values and offers Copy on hover', async () => {
    await vscode.workspace.getConfiguration('notesExplorer').update('mask.patterns', ['password:\\s*(\\S+)'], vscode.ConfigurationTarget.Global);
    const uri = vscode.Uri.file(path.join(ROOT, 'Secrets.md'));
    await vscode.window.showTextDocument(uri);
    const hovers = await until(async () => {
      const h = await vscode.commands.executeCommand('vscode.executeHoverProvider', uri, new vscode.Position(1, 12));
      const s = h.flatMap(x => x.contents.map(c => (typeof c === 'string' ? c : c.value))).join('\n');
      return /Hidden value/.test(s) ? s : null;
    }, 'mask hover');
    assert.match(hovers, /copyMasked/);
    await vscode.workspace.getConfiguration('notesExplorer').update('mask.patterns', undefined, vscode.ConfigurationTarget.Global);
  });

  await tryStep('pin adds a note to Quick Access', async () => {
    await vscode.commands.executeCommand('notesExplorer.pin', path.join(ROOT, 'Standup.md'));
    await vscode.commands.executeCommand('notesExplorer.unpin', path.join(ROOT, 'Standup.md'));
  });

  await tryStep('task filters and sorting switch without errors', async () => {
    await answering({ showQuickPick: [(items) => items.find(i => i.key === 'done')] }, () => vscode.commands.executeCommand('notesExplorer.filterTasks'));
    await vscode.commands.executeCommand('notesExplorer.sortTasks');
    await vscode.commands.executeCommand('notesExplorer.sortTasks');
    await vscode.commands.executeCommand('notesExplorer.clearTaskFilter');
  });

  const webviewTabs = () => vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(tb => tb.input instanceof vscode.TabInputWebview);
  await tryStep('graph, calendar and board views open', async () => {
    await vscode.commands.executeCommand('notesExplorer.showGraph');
    await vscode.commands.executeCommand('notesExplorer.showCalendar');
    await vscode.commands.executeCommand('notesExplorer.showKanban', path.join(ROOT, 'Work/Project.md'));
    const tabs = await until(() => { const w = webviewTabs(); return w.length >= 3 ? w : null; }, 'three webview tabs');
    assert.deepStrictEqual(tabs.map(tb => tb.label).sort(), ['Board: Project', 'Notes Calendar', 'Notes Graph']);
  });

  await tryStep('calendar opens a daily note for a chosen date', async () => {
    await vscode.commands.executeCommand('notesExplorer.openDailyFor', new Date(2026, 0, 15));
    await until(() => fs.existsSync(path.join(ROOT, 'Daily', '2026-01-15.md')), 'dated daily note');
  });

  await tryStep('export to HTML renders the note', async () => {
    const out = path.join(ROOT, '..', `notes-it-export-${Date.now()}.html`);
    await answering({ showSaveDialog: [vscode.Uri.file(out)] },
      () => vscode.commands.executeCommand('notesExplorer.exportHtml', path.join(ROOT, 'Links/A.md')));
    const html = await until(() => fs.existsSync(out) && fs.readFileSync(out, 'utf8'), 'export file');
    assert.match(html, /See Bee and Missing Note/);
    fs.rmSync(out, { force: true });
  });

  await tryStep('export a folder to PDF (when Edge or Chrome is installed)', async () => {
    const browsers = process.platform === 'win32'
      ? [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean).flatMap(b => [path.join(b, 'Microsoft/Edge/Application/msedge.exe'), path.join(b, 'Google/Chrome/Application/chrome.exe')])
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
    if (!browsers.some(b => fs.existsSync(b))) { results.push('    (skipped: no Edge or Chrome found)'); return; }
    const out = path.join(ROOT, '..', `notes-it-export-${Date.now()}.pdf`);
    await answering({ showSaveDialog: [vscode.Uri.file(out)] },
      () => vscode.commands.executeCommand('notesExplorer.exportPdf', path.join(ROOT, 'Links')));
    const head = await until(() => fs.existsSync(out) && fs.statSync(out).size > 1000 && fs.readFileSync(out).subarray(0, 5).toString(), 'PDF file', 60000);
    assert.strictEqual(head, '%PDF-');
    fs.rmSync(out, { force: true });
  });

  await tryStep('link a note to a code file', async () => {
    const code = path.join(ROOT, '..', `notes-it-code-${Date.now()}.js`);
    fs.writeFileSync(code, '// code\n');
    await answering({ showQuickPick: [(items) => items.find(i => i.p && /Standup/.test(i.p))] },
      () => vscode.commands.executeCommand('notesExplorer.linkNoteToFile', vscode.Uri.file(code)));
    fs.rmSync(code, { force: true });
  });

  await tryStep('exported HTML has no scripts and blocks them with a CSP', async () => {
    write('Unsafe.md', '# Unsafe\n\n<script>alert(1)</script>\n\n<a href="javascript:alert(1)">x</a> <img src="x" onerror="alert(1)">\n');
    const out = path.join(ROOT, '..', `notes-it-unsafe-${Date.now()}.html`);
    await answering({ showSaveDialog: [vscode.Uri.file(out)] },
      () => vscode.commands.executeCommand('notesExplorer.exportHtml', path.join(ROOT, 'Unsafe.md')));
    const html = await until(() => fs.existsSync(out) && fs.readFileSync(out, 'utf8'), 'export file');
    assert.doesNotMatch(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''), /<script|javascript:|onerror/i);
    assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
    fs.rmSync(out, { force: true });
  });

  await tryStep('completing a recurring task adds the next one', async () => {
    write('Chores.md', '# Chores\n\n- [ ] Water plants @every(week) @due(2026-10-23)\n');
    await vscode.commands.executeCommand('notesExplorer.refresh');
    await vscode.commands.executeCommand('notesExplorer.toggleTask', { file: path.join(ROOT, 'Chores.md'), line: 2 });
    const text = await until(() => /\[ \] Water plants @every\(week\) @due\(2026-10-30\)/.test(read('Chores.md')) && read('Chores.md'), 'next occurrence');
    assert.match(text, new RegExp(`- \\[x\\] Water plants @due\\(2026-10-23\\) ✓ ${today()}\\n- \\[ \\] Water plants @every\\(week\\) @due\\(2026-10-30\\)`));
  });

  await tryStep('[[Note#Heading]] opens at the heading', async () => {
    write('Guide.md', '# Guide\n\nintro\n\n## Install\n\nsteps\n');
    await vscode.commands.executeCommand('notesExplorer.refresh');
    await vscode.commands.executeCommand('notesExplorer.openLink', 'Guide', { heading: 'install' });
    await until(() => { const ed = vscode.window.activeTextEditor; return ed && /Guide\.md$/i.test(ed.document.uri.fsPath) && ed.selection.active.line === 4; }, 'caret on heading');
  });

  await tryStep('exclude patterns and .gitignore keep files out of the index', async () => {
    write('Scratch/tmp.md', '- [ ] hidden scratch task\n');
    write('Logs/x.md', '- [ ] hidden log task\n');
    write('.gitignore', 'Logs/\n');
    await vscode.workspace.getConfiguration('notesExplorer').update('exclude', ['Scratch/'], vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('notesExplorer.refresh');
    let picked;
    await answering({ showQuickPick: [(items) => { picked = items; return undefined; }] }, () => vscode.commands.executeCommand('notesExplorer.quickOpen'));
    const names = picked.map(i => i.p);
    assert.ok(names.some(p => /Guide\.md$/.test(p)), 'normal notes listed');
    assert.ok(!names.some(p => /Scratch|Logs/.test(p)), 'excluded folders not listed');
    await vscode.workspace.getConfiguration('notesExplorer').update('exclude', undefined, vscode.ConfigurationTarget.Global);
    fs.rmSync(path.join(ROOT, '.gitignore'));
  });

  await tryStep('encrypt a note, edit it, and the file on disk stays encrypted', async () => {
    write('Vault.md', '# Vault\n\npin: 4321\n');
    const plain = path.join(ROOT, 'Vault.md'), enc = path.join(ROOT, 'Vault.mdenc');
    await answering({ showWarningMessage: ['Encrypt'], showInputBox: ['s3cret pass', 's3cret pass'] },
      () => vscode.commands.executeCommand('notesExplorer.encryptNote', plain));
    await until(() => fs.existsSync(enc) && !fs.existsSync(plain), 'encrypted file replaces the original');
    assert.doesNotMatch(fs.readFileSync(enc, 'utf8'), /4321|Vault/);
    const ed = await until(() => { const e = vscode.window.activeTextEditor; return e && e.document.uri.scheme === 'notes-secure' ? e : null; }, 'decrypted editor');
    assert.match(ed.document.getText(), /pin: 4321/);
    await ed.edit(b => b.insert(new vscode.Position(3, 0), 'added line\n'));
    await ed.document.save();
    const onDisk = fs.readFileSync(enc, 'utf8');
    assert.doesNotMatch(onDisk, /added line|4321/);
    assert.match(require('../../src/secureNote').decrypt(onDisk, 's3cret pass'), /added line/);
    // Locking forgets the password: reopening asks again, and a wrong password is refused
    await vscode.commands.executeCommand('notesExplorer.lockSecure');
    await answering({ showWarningMessage: ['Remove Password'], showInputBox: ['wrong', 's3cret pass'] },
      () => vscode.commands.executeCommand('notesExplorer.decryptNote', enc));
    await until(() => fs.existsSync(plain) && !fs.existsSync(enc), 'decrypted back to .md');
    assert.match(read('Vault.md'), /added line/);
  });

  await tryStep('choosing an empty folder offers starter notes', async () => {
    const fresh = fs.mkdtempSync(path.join(ROOT, '..', 'notes-it-fresh-'));
    await answering({ showOpenDialog: [[vscode.Uri.file(fresh)]], showInformationMessage: ['Add Starter Notes'] },
      () => vscode.commands.executeCommand('notesExplorer.changeLocation'));
    await until(() => fs.existsSync(path.join(fresh, 'Welcome.md')) && fs.existsSync(path.join(fresh, 'Projects', 'Example project.md')), 'starter files');
    for (const d of ['Daily', 'Meetings', 'Reference', 'Archive']) assert.ok(fs.existsSync(path.join(fresh, d)), `${d}/ created`);
    await until(() => vscode.window.activeTextEditor && /Welcome\.md$/.test(vscode.window.activeTextEditor.document.uri.fsPath), 'Welcome opened');
    // a folder with notes is not offered anything
    let offered = false;
    await answering({ showOpenDialog: [[vscode.Uri.file(ROOT)]], showInformationMessage: [(msg) => { if (/empty/.test(msg)) offered = true; }] },
      () => vscode.commands.executeCommand('notesExplorer.changeLocation'));
    assert.strictEqual(offered, false);
    // A picked folder's path can differ in drive-letter case (c:\ vs C:\), which Windows treats as the same
    await until(() => vscode.workspace.getConfiguration('notesExplorer').get('rootPath').toLowerCase() === ROOT.toLowerCase(), 'back to the main folder');
    await vscode.workspace.getConfiguration('notesExplorer').update('rootPath', ROOT, vscode.ConfigurationTarget.Global);
    fs.rmSync(fresh, { recursive: true, force: true });
  });

  await tryStep('switching notes folders', async () => {
    const other = fs.mkdtempSync(path.join(ROOT, '..', 'notes-it-other-'));
    fs.writeFileSync(path.join(other, 'Elsewhere.md'), '# Elsewhere\n');
    await vscode.workspace.getConfiguration('notesExplorer').update('folders', [{ name: 'Main', path: ROOT }, { name: 'Other', path: other }], vscode.ConfigurationTarget.Global);
    await answering({ showQuickPick: [(items) => items.find(i => i.folder && i.folder.name === 'Other')] }, () => vscode.commands.executeCommand('notesExplorer.switchFolder'));
    await until(() => vscode.workspace.getConfiguration('notesExplorer').get('rootPath') === other, 'rootPath switched');
    await answering({ showQuickPick: [(items) => items.find(i => i.folder && i.folder.name === 'Main')] }, () => vscode.commands.executeCommand('notesExplorer.switchFolder'));
    await until(() => vscode.workspace.getConfiguration('notesExplorer').get('rootPath') === ROOT, 'switched back');
    await vscode.workspace.getConfiguration('notesExplorer').update('folders', undefined, vscode.ConfigurationTarget.Global);
    fs.rmSync(other, { recursive: true, force: true });
  });

  await tryStep('headings appear in the tree and history opens the Timeline', async () => {
    await vscode.commands.executeCommand('notesExplorer.toggleHeadings');
    await until(() => vscode.workspace.getConfiguration('notesExplorer').get('showHeadings') === true, 'setting on');
    await vscode.commands.executeCommand('notesExplorer.showHistory', path.join(ROOT, 'Guide.md'));
    await vscode.commands.executeCommand('notesExplorer.toggleHeadings');
  });

  // ---------------- 1.2.0: adding tasks, carrying over, capture targets, and what the trees show
  const api = ext.exports && ext.exports._test;
  const labels = async (tree, el) => Promise.all((await tree.getChildren(el)).map(async c => {
    const item = await tree.getTreeItem(c);
    return typeof item.label === 'string' ? item.label : item.label.label;
  }));
  const isoIn = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  await tryStep('Add Task turns "tomorrow" into a due date and files it under the chosen section', async () => {
    write('Tasks.md', '# Tasks\n\n## Today\n\n- [ ] existing\n\n## Later\n\n- [ ] someday\n');
    await vscode.commands.executeCommand('notesExplorer.refresh');
    await answering({
      showInputBox: ['Call the bank tomorrow'],
      showQuickPick: [(items) => items.find(i => i.file && /Tasks\.md$/.test(i.file)), (items) => items.find(i => i.label === 'Later')]
    }, () => vscode.commands.executeCommand('notesExplorer.addTask'));
    await until(() => read('Tasks.md').includes(`- [ ] someday\n- [ ] Call the bank @due(${isoIn(1)})\n`), 'task in Later with due date');
  });

  await tryStep('unfinished tasks are carried over to a new daily note', async () => {
    const yesterday = path.join(ROOT, 'Daily', `${isoIn(-3)}.md`);
    write(path.relative(ROOT, yesterday), '# Earlier\n\n## Top 3 today\n\n- [ ] Finish slides\n  - [ ] speaker notes\n- [x] Done already\n');
    const todayFile = path.join(ROOT, 'Daily', `${today()}.md`);
    fs.rmSync(todayFile, { force: true });
    await answering({ showInformationMessage: ['Move'] }, () => vscode.commands.executeCommand('notesExplorer.openDaily'));
    await until(() => fs.existsSync(todayFile) && /## Carried over\n\n- \[ \] Finish slides\n {2}- \[ \] speaker notes/.test(read(path.relative(ROOT, todayFile))), 'carried into today');
    const left = fs.readFileSync(yesterday, 'utf8');
    assert.doesNotMatch(left, /Finish slides/, 'moved out of the old note');
    assert.match(left, /- \[x\] Done already/, 'finished tasks stay');
  });

  await tryStep('Quick Capture can ask where to put the line', async () => {
    await vscode.workspace.getConfiguration('notesExplorer').update('capture.target', 'ask', vscode.ConfigurationTarget.Global);
    await answering({ showQuickPick: [(items) => items.find(i => /Tasks\.md$/.test(i.f || ''))], showInputBox: ['captured into tasks'] },
      () => vscode.commands.executeCommand('notesExplorer.quickCapture'));
    await until(() => /- captured into tasks\n$/.test(read('Tasks.md')), 'captured line');
    await vscode.workspace.getConfiguration('notesExplorer').update('capture.target', undefined, vscode.ConfigurationTarget.Global);
  });

  await tryStep('Today view shows today\'s note, overdue and due-today tasks', async () => {
    assert.ok(api, 'test handles exported');
    write('Due.md', `# Due\n\n- [ ] Late thing @due(${isoIn(-2)})\n- [ ] Today thing @due(${today()})\n- [ ] Future @due(${isoIn(5)})\n`);
    await vscode.commands.executeCommand('notesExplorer.refresh');
    const top = await labels(api.trees.today);
    assert.deepStrictEqual(top, ["Today's note", 'Overdue', 'Due today']);
    const groups = await api.trees.today.getChildren();
    assert.ok((await labels(api.trees.today, groups[1])).includes('Late thing'));
    assert.deepStrictEqual(await labels(api.trees.today, groups[2]), ['Today thing']);
  });

  await tryStep('Tasks view groups a note\'s tasks by section', async () => {
    await vscode.commands.executeCommand('notesExplorer.refresh');
    const files = await api.trees.tasks.getChildren();
    const tasksNote = files.find(f => /Tasks\.md$/.test(f.file));
    assert.ok(tasksNote, 'Tasks.md listed');
    // (the captured line is plain text, not a "- [ ]" task, so it adds no section of its own)
    assert.deepStrictEqual(await labels(api.trees.tasks, tasksNote), ['Today', 'Later']);
    const sections = await api.trees.tasks.getChildren(tasksNote);
    assert.deepStrictEqual(await labels(api.trees.tasks, sections.find(s => s.section === 'Later')), ['someday', 'Call the bank']);
  });

  await tryStep('Notes tree lists folders first, then notes, with task counts', async () => {
    const top = await api.trees.notes.getChildren();
    const items = await Promise.all(top.map(p => api.trees.notes.getTreeItem(p)));
    const kinds = items.map(i => i.contextValue);
    assert.ok(kinds.indexOf('note') > kinds.lastIndexOf('folder'), 'folders before notes');
    const due = items.find(i => i.label === 'Due');
    assert.strictEqual(due.description, '3 open');
  });

  await tryStep('Quick Access shows pinned notes', async () => {
    await vscode.commands.executeCommand('notesExplorer.pin', path.join(ROOT, 'Due.md'));
    const groups = await api.trees.quick.getChildren();
    const pinned = groups.find(g => g.group === 'pinned');
    assert.ok(pinned, 'Pinned group');
    assert.deepStrictEqual(await labels(api.trees.quick, pinned), ['Due']);
    await vscode.commands.executeCommand('notesExplorer.unpin', path.join(ROOT, 'Due.md'));
  });

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  console.log(['', 'Notes Explorer integration tests', ...results, ''].join('\n'));
  if (failed) throw new Error(`${failed} integration step(s) failed`);
}

module.exports = { run };
