// Export a note, or every note in a folder, to a standalone HTML file or a PDF.
// Rendering uses VS Code's built-in Markdown engine; PDF printing uses an installed Edge or Chrome.
const vscode = require('vscode');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { root, hidden } = require('./util');
const { t } = require('./l10n');

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** [[Target|alias]] → alias, [[Target#h]] → Target, so exported text reads naturally. */
const flattenWikiLinks = (md) => md.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (m, target, alias) => alias || target);

/** Relative image/link paths become absolute file URLs, so the output works wherever it is saved. */
function absolutize(html, baseDir) {
  return html.replace(/(<(?:img|a)\b[^>]*?\s(?:src|href)=")([^"#:][^"]*)"/gi, (m, pre, url) => {
    if (/^[a-z][\w+.-]*:/i.test(url) || url.startsWith('//')) return m;
    return `${pre}${vscode.Uri.file(path.resolve(baseDir, decodeURIComponent(url))).toString()}"`;
  });
}

async function renderNote(file) {
  const md = flattenWikiLinks(await fsp.readFile(file, 'utf8'));
  const html = await vscode.commands.executeCommand('markdown.api.render', md);
  return absolutize(String(html || ''), path.dirname(file));
}

function wrap(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
  body { font: 15px/1.6 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f2328; max-width: 860px; margin: 32px auto; padding: 0 24px; }
  h1, h2, h3 { line-height: 1.25; } h1 { border-bottom: 1px solid #d0d7de; padding-bottom: .3em; }
  code, pre { font-family: ui-monospace, Consolas, monospace; font-size: 90%; background: #f6f8fa; border-radius: 4px; }
  code { padding: .15em .35em; } pre { padding: 12px 16px; overflow: auto; } pre code { padding: 0; background: none; }
  table { border-collapse: collapse; } th, td { border: 1px solid #d0d7de; padding: 6px 12px; } th { background: #f6f8fa; }
  blockquote { margin: 0; padding: 0 1em; color: #59636e; border-left: 4px solid #d0d7de; }
  img { max-width: 100%; } a { color: #0969da; }
  ul.contains-task-list, .task-list-item { list-style: none; } .task-list-item input { margin-right: .4em; }
  .note + .note { break-before: page; margin-top: 48px; }
  .toc { background: #f6f8fa; padding: 12px 24px; border-radius: 6px; }
  @media print { body { margin: 0; max-width: none; } a { color: inherit; } }
</style></head><body>${body}</body></html>`;
}

async function buildHtml(target) {
  const isDir = (await fsp.stat(target)).isDirectory();
  if (!isDir) return { title: path.basename(target, path.extname(target)), html: wrap(path.basename(target, path.extname(target)), `<article class="note">${await renderNote(target)}</article>`) };
  const files = [];
  const hide = hidden();
  const walk = async (dir) => {
    const entries = (await fsp.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!hide.has(e.name)) await walk(p); }
      else if (/\.(md|markdown)$/i.test(e.name)) files.push(p);
    }
  };
  await walk(target);
  if (!files.length) throw new Error(t('no Markdown notes in {0}', path.basename(target)));
  const title = path.basename(target) || t('Notes');
  const toc = `<nav class="toc"><strong>${esc(title)}</strong><ol>${files.map((f, i) => `<li><a href="#n${i}">${esc(path.relative(target, f).replace(/\.(md|markdown)$/i, ''))}</a></li>`).join('')}</ol></nav>`;
  const parts = [];
  for (const [i, f] of files.entries()) parts.push(`<article class="note" id="n${i}">${await renderNote(f)}</article>`);
  return { title, html: wrap(title, toc + parts.join('\n')) };
}

/** Finds Edge or Chrome for headless PDF printing (Windows, macOS, Linux). */
function findBrowser() {
  const custom = vscode.workspace.getConfiguration('notesExplorer').get('export.browserPath');
  if (custom && fs.existsSync(custom)) return custom;
  const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = process.platform === 'win32'
    ? pf.flatMap(b => [path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe')])
    : process.platform === 'darwin'
      ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      : ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  return candidates.find(c => fs.existsSync(c));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * On Windows the Edge/Chrome launcher can exit before its child process has written the PDF,
 * so wait for the file to appear and stop growing before reporting success (or cleaning up).
 */
async function printToPdf(browser, htmlFile, pdfFile, timeoutMs = 60000) {
  await fsp.rm(pdfFile, { force: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-pdf-profile-'));
  let launchError = null, output = '';
  execFile(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-pdf-header-footer', `--user-data-dir=${profile}`,
    `--print-to-pdf=${pdfFile}`, require('url').pathToFileURL(htmlFile).href], { timeout: timeoutMs }, (err, stdout, stderr) => {
    launchError = err;
    output = `${stdout || ''}${stderr || ''}`.trim();
  });
  try {
    const end = Date.now() + timeoutMs;
    let lastSize = -1;
    while (Date.now() < end) {
      await sleep(300);
      const size = fs.existsSync(pdfFile) ? fs.statSync(pdfFile).size : -1;
      if (size > 0 && size === lastSize) return;
      lastSize = size;
      if (launchError && launchError.code === 'ENOENT') throw launchError; // browser path is wrong
    }
    const detail = (output || (launchError && launchError.message) || '').split(/\r?\n/).filter(Boolean).slice(-3).join(' | ');
    throw new Error(t('the browser did not produce a PDF within {0} seconds', timeoutMs / 1000) + (detail ? ` (${detail})` : ''));
  } finally {
    // Give the browser a moment to release its profile before removing it
    setTimeout(() => fs.rm(profile, { recursive: true, force: true }, () => {}), 5000);
  }
}

async function exportNotes(target, format) {
  const isDir = fs.statSync(target).isDirectory();
  const base = isDir ? (path.basename(target) || 'Notes') : path.basename(target, path.extname(target));
  const defaultDir = isDir ? path.dirname(target) : path.dirname(target);
  const dest = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(defaultDir === root() && isDir ? os.homedir() : defaultDir, `${base}.${format}`)),
    filters: format === 'pdf' ? { PDF: ['pdf'] } : { HTML: ['html'] },
    saveLabel: t('Export')
  });
  if (!dest) return;
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('Exporting {0}…', base) }, async () => {
    const { html } = await buildHtml(target);
    if (format === 'html') {
      await fsp.writeFile(dest.fsPath, html);
    } else {
      const browser = findBrowser();
      if (!browser) throw new Error(t('PDF export needs Microsoft Edge or Google Chrome. Install one, or set "notesExplorer.export.browserPath".'));
      const tmp = path.join(os.tmpdir(), `notes-export-${Date.now()}.html`);
      await fsp.writeFile(tmp, html);
      try { await printToPdf(browser, tmp, dest.fsPath); } finally { fsp.rm(tmp, { force: true }).catch(() => {}); }
    }
    const pick = await vscode.window.showInformationMessage(t('Exported to {0}', path.basename(dest.fsPath)), t('Open'), t('Show in Folder'));
    if (pick === t('Open')) vscode.env.openExternal(dest);
    if (pick === t('Show in Folder')) vscode.commands.executeCommand('revealFileInOS', dest);
    return dest.fsPath;
  });
}

module.exports = { exportNotes, buildHtml, flattenWikiLinks };
