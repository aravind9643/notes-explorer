// Renders the Graph, Board and Calendar webviews outside VS Code, with sample notes and VS Code's
// Dark Modern theme colours, and screenshots them with headless Edge/Chrome into docs/.
// Run: npm run screenshots
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT = path.join(__dirname, '..', 'docs');
const notes = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-shots-'));
const w = (f, s) => { fs.mkdirSync(path.dirname(path.join(notes, f)), { recursive: true }); fs.writeFileSync(path.join(notes, f), s); };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

w('Projects/Website.md', `# Website relaunch\n\n## Backlog\n\n- [ ] Write copy for pricing page #web\n- [ ] Compress hero images\n- [ ] Cookie banner @due(${day(9)})\n\n## In progress\n\n- [ ] New navigation #web @due(${day(2)})\n- [ ] Accessibility audit\n\n## Review\n\n- [ ] Blog template\n\n## Done\n\n- [x] Pick fonts ✓ ${day(-3)}\n- [x] Domain renewal ✓ ${day(-1)}\n`);
w('Projects/Mobile app.md', `# Mobile app\n\nSee [[Website]] and [[Release checklist]].\n\n- [ ] Push notifications @due(${day(-2)})\n- [ ] Offline mode @due(${day(5)})\n`);
w('Release checklist.md', '# Release checklist\n\nUsed by [[Mobile app]] and [[Website]].\n');
w('Meetings/Weekly sync.md', '# Weekly sync\n\n[[Website]] · [[Mobile app]] · [[Hiring plan]]\n\n- [ ] Send notes @due(' + day(0) + ')\n');
w('Hiring plan.md', '# Hiring plan\n\nRelated: [[Weekly sync]], [[Budget]]\n');
w('Ideas/Reading list.md', '# Reading list\n\n[[Ideas]] [[Book notes]]\n');
w('Ideas/Book notes.md', '# Book notes\n\nBack to [[Reading list]].\n');
w('Inbox.md', '# Inbox\n\n- call the bank\n');
for (const n of [-6, -4, -1, 0]) w(`Daily/${day(n)}.md`, `# ${day(n)}\n`);

// Dark Modern colours for the CSS variables VS Code injects into webviews
const THEME = {
  '--vscode-font-family': '"Segoe UI", system-ui, sans-serif', '--vscode-font-size': '13px', '--vscode-foreground': '#cccccc',
  '--vscode-editor-background': '#1f1f1f', '--vscode-descriptionForeground': '#9d9d9d', '--vscode-focusBorder': '#0078d4',
  '--vscode-input-background': '#313131', '--vscode-input-foreground': '#cccccc', '--vscode-input-border': '#3c3c3c',
  '--vscode-button-background': '#0078d4', '--vscode-button-foreground': '#ffffff',
  '--vscode-button-secondaryBackground': '#313131', '--vscode-button-secondaryForeground': '#cccccc', '--vscode-button-secondaryHoverBackground': '#3c3c3c',
  '--vscode-sideBar-background': '#181818', '--vscode-panel-border': '#2b2b2b', '--vscode-list-hoverBackground': '#2a2d2e',
  '--vscode-badge-background': '#616161', '--vscode-badge-foreground': '#f8f8f8', '--vscode-inputValidation-errorBackground': '#5a1d1d',
  '--vscode-charts-blue': '#3794ff', '--vscode-editorIndentGuide-background': '#404040'
};

// --- Minimal vscode stub: captures each panel's HTML and the messages the extension posts to it
const panels = [];
const cfgValues = { rootPath: notes, hiddenFolders: [], templatesFolder: '.templates', 'daily.folder': 'Daily', 'daily.fileNameFormat': 'YYYY-MM-DD', 'kanban.doneColumn': 'Done', 'calendar.weekStart': 'monday', 'tasks.stampCompletion': true };
const disposable = { dispose() {} };
const vscode = {
  env: { language: 'en' }, l10n: { t: (m, ...a) => m.replace(/\{(\d+)\}/g, (x, i) => a[i]) },
  Uri: { file: (p) => ({ fsPath: p, scheme: 'file', toString: () => 'file:///' + p.replace(/\\/g, '/') }) },
  ViewColumn: { Active: -1, Beside: -2 }, Range: class {}, WorkspaceEdit: class { replace() {} },
  workspace: {
    getConfiguration: () => ({ get: (k) => cfgValues[k] }),
    openTextDocument: async (f) => ({ getText: () => fs.readFileSync(f, 'utf8'), lineCount: 1 }),
    onDidChangeTextDocument: () => disposable, applyEdit: async () => true
  },
  window: {
    createWebviewPanel: (type, title) => {
      const p = { title, messages: [], webview: { cspSource: 'vscode-resource:', html: '', postMessage(m) { p.messages.push(m); }, onDidReceiveMessage: () => disposable },
        onDidDispose: () => disposable, reveal() {} };
      panels.push(p);
      return p;
    },
    showTextDocument: async () => {}
  },
  commands: { executeCommand: async () => {} }
};
const load = Module._load;
Module._load = function (req, ...rest) { return req === 'vscode' ? vscode : load.call(this, req, ...rest); };

(async () => {
  const { NoteIndex } = require('../src/noteIndex');
  const { showGraph, showKanban, showCalendar } = require('../src/webviews');
  const index = new NoteIndex();
  await index.scan(notes, new Set());
  showGraph(index);
  await showKanban(path.join(notes, 'Projects', 'Website.md'));
  showCalendar(index);

  const browser = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].find(p => fs.existsSync(p));
  if (!browser) throw new Error('Edge or Chrome is needed to take screenshots');
  fs.mkdirSync(OUT, { recursive: true });
  const names = ['graph', 'board', 'calendar'];
  for (const [i, p] of panels.entries()) {
    // Stand-in for acquireVsCodeApi, theme variables, and the messages the extension sent
    const vars = Object.entries(THEME).map(([k, v]) => `${k}:${v}`).join(';');
    const shim = `<script>window.acquireVsCodeApi=()=>({postMessage(){}});document.documentElement.style.cssText=${JSON.stringify(vars)};` +
      `addEventListener('load',()=>{for(const m of ${JSON.stringify(p.messages)})dispatchEvent(new MessageEvent('message',{data:m}));});</script>`;
    const html = p.webview.html
      .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
      .replace(/<script nonce="[^"]*">/, `${shim}<script>`);
    const file = path.join(notes, `${names[i]}.html`);
    fs.writeFileSync(file, html);
    const png = path.join(OUT, `${names[i]}.png`);
    fs.rmSync(png, { force: true });
    execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--virtual-time-budget=4000',
      '--window-size=1100,640', `--screenshot=${png}`, require('url').pathToFileURL(file).href], { stdio: 'ignore' });
    for (let t = 0; t < 100 && !fs.existsSync(png); t++) await new Promise(r => setTimeout(r, 200)); // launcher may exit first
    console.log(fs.existsSync(png) ? `docs/${names[i]}.png` : `failed: ${names[i]}`);
  }
  setTimeout(() => fs.rmSync(notes, { recursive: true, force: true }), 3000);
})().catch(err => { console.error(err); process.exitCode = 1; });
