// Links between notes, tags, notes for code files and project folders.
const vscode = require('vscode');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { newNote } = require('../capture');
const { cfg, root, hidden, listOpts, itemPath, isUnderRoot, openAt } = require('../util');
const { t } = require('../l10n');

module.exports = (ctx) => {
  const { reg, index, store, trees, views, linkTools, requireRoot, targetDir, activeFile, reindex, reindexSoon } = ctx;

  reg('notesExplorer.openLink', async (target, opts = {}) => {
    opts = opts || {};
    requireRoot();
    await reindex();
    let file = index.resolveLink(target);
    if (!file) {
      if (!opts.create) {
        const ok = await vscode.window.showInformationMessage(t('Note "{0}" doesn\'t exist. Create it?', target), t('Create'));
        if (ok !== t('Create')) return;
      }
      file = path.join(root(), `${target}.md`);
      await fsp.writeFile(file, `# ${target}\n\n`);
      reindexSoon();
    }
    const line = opts.heading ? index.headingLine(file, opts.heading) : null;
    await openAt(file, line || 0);
  });

  reg('notesExplorer.renameTag', async () => {
    requireRoot();
    await reindex();
    const tags = index.allTags();
    if (!tags.length) return vscode.window.showInformationMessage(t('No #tags found in notes yet. Add one like #ideas to any note.'));
    const pick = await vscode.window.showQuickPick(tags.map(([tag, n]) => ({ label: `#${tag}`, description: t('{0} note(s)', n), tag })), { placeHolder: t('Tag to rename') });
    if (!pick) return;
    const next = await vscode.window.showInputBox({
      prompt: t('Rename #{0} in all notes to', pick.tag), value: pick.tag,
      validateInput: (v) => (/^[A-Za-z][\w/-]*$/.test(v.replace(/^#/, '')) ? undefined : t('Tags start with a letter and contain letters, digits, - _ or /'))
    });
    const newTag = next && next.replace(/^#/, '');
    if (!newTag || newTag === pick.tag) return;
    const res = await linkTools.renameTagEverywhere(pick.tag, newTag);
    if (trees.notes.tagFilter === pick.tag) trees.notes.setTagFilter(newTag.toLowerCase());
    await reindex();
    vscode.window.showInformationMessage(t('Renamed #{0} to #{1}: {2} change(s) in {3} note(s)', pick.tag, newTag, res.count, res.files));
  });

  // --- Notes for code files ---
  reg('notesExplorer.linkNoteToFile', async (uri) => {
    requireRoot();
    const file = (uri && uri.fsPath) || activeFile();
    if (!file) throw new Error(t('open a file first'));
    if (isUnderRoot(file)) throw new Error(t('this is a note. Use [[note name]] to link notes to each other.'));
    const r = root();
    const files = (await index.listFiles(r, hidden(), listOpts())).filter(f => /\.(md|markdown|txt)$/i.test(f));
    const items = [{ label: `$(add) ${t('New note…')}`, create: true }, ...files.map(p => ({ label: path.basename(p), description: path.relative(r, path.dirname(p)), p }))];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: t('Link a note to {0}', path.basename(file)), matchOnDescription: true });
    if (!pick) return;
    let note = pick.p;
    if (pick.create) {
      const dirs = [...trees.notes.projectDirs];
      note = await newNote(dirs[0] || r);
      if (!note) return;
      reindexSoon();
    }
    await store.linkNote(file, note);
    trees.related.setCurrent(file);
    vscode.commands.executeCommand('notesExplorer.related.focus');
    vscode.window.showInformationMessage(t('Linked {0} to {1}', path.basename(note), path.basename(file)));
  });
  reg('notesExplorer.unlinkNote', async (el) => {
    const file = trees.related.current;
    if (file && el) await store.unlinkNote(file, itemPath(el));
  });

  // --- Project folders ---
  reg('notesExplorer.linkFolderToProject', async (item) => {
    requireRoot();
    const ws = vscode.workspace.workspaceFolders;
    if (!ws || !ws.length) throw new Error(t('open a project folder first'));
    const folder = await targetDir(item);
    const target = ws.length === 1 ? ws[0] : (await vscode.window.showWorkspaceFolderPick({ placeHolder: t('Link {0} to which project?', path.basename(folder)) }));
    if (!target) return;
    await store.linkProject(target.uri.fsPath, folder);
    await reindex();
    vscode.window.showInformationMessage(t('{0} is now the notes folder for {1}', path.relative(root(), folder) || t('Notes'), target.name));
  });
  reg('notesExplorer.unlinkProject', async () => {
    const ws = vscode.workspace.workspaceFolders || [];
    for (const f of ws) await store.unlinkProject(f.uri.fsPath);
    await reindex();
  });
  reg('notesExplorer.openProjectNotes', async () => {
    requireRoot();
    const ws = vscode.workspace.workspaceFolders;
    if (!ws || !ws.length) throw new Error(t('open a project folder first'));
    const dirs = [...trees.notes.projectDirs];
    let dir = dirs[0];
    if (dirs.length > 1) dir = (await vscode.window.showQuickPick(dirs.map(d => ({ label: path.relative(root(), d), d })), { placeHolder: t('Project notes folder') }))?.d;
    if (!dir) {
      if (dirs.length) return;
      const choice = await vscode.window.showQuickPick([
        { label: `$(new-folder) ${t('Create {0}', path.join(cfg().get('projectsFolder'), ws[0].name))}`, create: true },
        { label: `$(folder) ${t('Choose an existing folder…')}` }
      ], { placeHolder: t('No notes folder is linked to {0} yet', ws[0].name) });
      if (!choice) return;
      if (choice.create) dir = path.join(root(), cfg().get('projectsFolder'), ws[0].name);
      else {
        const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, defaultUri: vscode.Uri.file(root()), openLabel: t('Use for this project') });
        if (!picked) return;
        dir = picked[0].fsPath;
        if (!isUnderRoot(dir)) throw new Error(t('choose a folder inside your notes folder'));
      }
      await fsp.mkdir(dir, { recursive: true });
      await store.linkProject(ws[0].uri.fsPath, dir);
    }
    const files = (await fsp.readdir(dir)).filter(f => /\.(md|txt)$/i.test(f));
    const file = path.join(dir, files.find(f => /^readme\.md$/i.test(f)) || files[0] || 'README.md');
    if (!fs.existsSync(file)) await fsp.writeFile(file, `# ${ws[0].name}\n\n`);
    await reindex();
    await openAt(file);
    views.notesView.reveal(dir, { expand: true }).then(undefined, () => {});
  });
};
