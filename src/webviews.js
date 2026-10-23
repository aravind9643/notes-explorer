// Graph, Kanban board and Calendar views. Each is a webview panel with inline, nonce-locked script,
// styled with VS Code theme variables so it follows light, dark and high-contrast themes.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { root, isUnderRoot, cfg, openAt, today } = require('./util');
const { parseBoard, moveCard, toggleTaskLine, monthGrid } = require('./editOps');
const { formatDate } = require('./templates');
const { t } = require('./l10n');

const nonce = () => Array.from({ length: 32 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(webview, title, body, script, n) {
  return `<!doctype html><html lang="${esc(vscode.env.language)}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${webview.cspSource} data:; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 12px 16px; font: var(--vscode-font-size) var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  button, input, select { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 3px 8px; }
  button { cursor: pointer; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 0; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  :focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
  .muted { color: var(--vscode-descriptionForeground); }
  h1 { font-size: 1.15em; font-weight: 600; margin: 0; }
</style></head><body>${body}<script nonce="${n}">const vscode = acquireVsCodeApi();\n${script}</script></body></html>`;
}

/** Keeps one panel per key; reveals the existing one instead of opening duplicates. */
const panels = new Map();
function getPanel(key, title, onMessage) {
  let p = panels.get(key);
  if (p) { p.reveal(); return { panel: p, created: false }; }
  p = vscode.window.createWebviewPanel('notesExplorer.' + key.split(':')[0], title, vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
  p.iconPath = vscode.Uri.file(path.join(__dirname, '..', 'media', 'notes.svg'));
  panels.set(key, p);
  p.onDidDispose(() => panels.delete(key));
  p.webview.onDidReceiveMessage(async (m) => {
    try { await onMessage(m, p); }
    catch (err) { vscode.window.showErrorMessage(t('Notes: {0} failed: {1}', key.split(':')[0], err.message)); }
  });
  return { panel: p, created: true };
}

// ---------------------------------------------------------------- Graph
function showGraph(index) {
  const { panel, created } = getPanel('graph', t('Notes Graph'), async (m) => {
    if (m.type === 'open') {
      if (m.id.startsWith('missing:')) return vscode.commands.executeCommand('notesExplorer.openLink', m.name);
      return openAt(m.id, 0, 0, vscode.ViewColumn.Beside);
    }
  });
  const data = () => {
    const g = index.graph();
    return { nodes: g.nodes.map(n => ({ ...n, folder: n.missing ? '' : path.relative(root(), path.dirname(n.id)) })), edges: g.edges };
  };
  const n = nonce();
  if (created) panel.webview.html = page(panel.webview, t('Notes Graph'), `
<div class="bar"><h1>${esc(t('Notes Graph'))}</h1>
  <input id="q" type="search" placeholder="${esc(t('Filter notes…'))}" aria-label="${esc(t('Filter notes'))}">
  <label><input id="orphans" type="checkbox"> ${esc(t('Hide notes without links'))}</label>
  <button id="fit">${esc(t('Fit'))}</button><span id="stats" class="muted"></span></div>
<canvas id="c" role="img" aria-label="${esc(t('Graph of notes and the links between them. Click a note to open it.'))}" style="width:100%;height:calc(100vh - 70px);display:block;cursor:grab"></canvas>`, `
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const css = (v) => getComputedStyle(document.body).getPropertyValue(v).trim();
let nodes = [], edges = [], byId = new Map(), view = { x: 0, y: 0, k: 1 }, hover = null, drag = null, alpha = 1, autoFit = true;
function load(d) {
  const old = new Map(nodes.map(n => [n.id, n]));
  nodes = d.nodes.map(n => Object.assign(old.get(n.id) || { x: (Math.random() - .5) * 400, y: (Math.random() - .5) * 400, vx: 0, vy: 0 }, n));
  byId = new Map(nodes.map(n => [n.id, n]));
  edges = d.edges.filter(e => byId.has(e.from) && byId.has(e.to));
  alpha = 1; autoFit = true; filter();
}
function visible(n) {
  const q = document.getElementById('q').value.toLowerCase();
  if (document.getElementById('orphans').checked && !n.links) return false;
  return !q || n.name.toLowerCase().includes(q) || n.folder.toLowerCase().includes(q);
}
function filter() {
  const shown = nodes.filter(visible).length;
  document.getElementById('stats').textContent = shown + ' / ' + nodes.length + ' ${esc(t('notes'))} · ' + edges.length + ' ${esc(t('links'))}';
}
function step() {
  if (alpha < 0.005) return;
  const vis = nodes.filter(visible);
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const a = vis[i], b = vis[j]; let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy || 1;
    if (d2 > 250000) continue;
    const f = 900 / d2 * alpha; dx *= f; dy *= f; a.vx -= dx; a.vy -= dy; b.vx += dx; b.vy += dy;
  }
  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to); if (!visible(a) || !visible(b)) continue;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 70) * 0.02 * alpha;
    a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
  }
  for (const n of vis) { if (n === drag) continue; n.vx -= n.x * 0.012 * alpha; n.vy -= n.y * 0.012 * alpha; n.x += n.vx; n.y += n.vy; n.vx *= 0.6; n.vy *= 0.6; }
  alpha *= 0.985;
}
function radius(n) { return 4 + Math.min(10, Math.sqrt(n.links) * 2); }
function draw() {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  ctx.translate(w / 2 + view.x, h / 2 + view.y); ctx.scale(view.k, view.k);
  const near = hover ? new Set(edges.filter(e => e.from === hover.id || e.to === hover.id).flatMap(e => [e.from, e.to])) : null;
  ctx.lineWidth = 1 / view.k;
  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to); if (!visible(a) || !visible(b)) continue;
    ctx.strokeStyle = near && near.has(a.id) && near.has(b.id) ? css('--vscode-focusBorder') : css('--vscode-editorIndentGuide-background') || '#8884';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.font = (11 / view.k) + 'px ' + css('--vscode-font-family');
  for (const n of nodes) {
    if (!visible(n)) continue;
    const dim = near && !near.has(n.id) && n !== hover;
    ctx.globalAlpha = dim ? 0.25 : 1;
    ctx.fillStyle = n.missing ? css('--vscode-descriptionForeground') : css('--vscode-charts-blue') || '#3b82f6';
    ctx.beginPath(); ctx.arc(n.x, n.y, radius(n), 0, Math.PI * 2);
    if (n.missing) { ctx.strokeStyle = ctx.fillStyle; ctx.setLineDash([2 / view.k, 2 / view.k]); ctx.stroke(); ctx.setLineDash([]); } else ctx.fill();
    if (view.k > 0.6 || n === hover || (near && near.has(n.id))) { ctx.fillStyle = css('--vscode-foreground'); ctx.fillText(n.name, n.x + radius(n) + 3, n.y + 4); }
  }
  ctx.globalAlpha = 1;
}
// Zoom and centre so every visible node (with its label) fits the canvas
function fit() {
  const vis = nodes.filter(visible); if (!vis.length) return;
  const xs = vis.map(n => n.x), ys = vis.map(n => n.y);
  const minX = Math.min(...xs) - 20, maxX = Math.max(...xs) + 120, minY = Math.min(...ys) - 20, maxY = Math.max(...ys) + 20;
  const w = cv.clientWidth, h = cv.clientHeight;
  view.k = Math.min(2, Math.max(0.1, Math.min(w / (maxX - minX), h / (maxY - minY))));
  view.x = -(minX + maxX) / 2 * view.k; view.y = -(minY + maxY) / 2 * view.k;
}
function tick() { step(); if (autoFit) fit(); draw(); requestAnimationFrame(tick); }
document.getElementById('fit').onclick = () => { autoFit = true; fit(); };
function toWorld(ev) { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left - r.width / 2 - view.x) / view.k, y: (ev.clientY - r.top - r.height / 2 - view.y) / view.k }; }
function hit(p) { let best = null, bd = 1e9; for (const n of nodes) { if (!visible(n)) continue; const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2; if (d < bd && d < (radius(n) + 4) ** 2) { bd = d; best = n; } } return best; }
let pan = null, moved = false;
cv.addEventListener('mousedown', ev => { const n = hit(toWorld(ev)); moved = false; if (!n) autoFit = false; if (n) { drag = n; alpha = Math.max(alpha, .3); } else pan = { x: ev.clientX - view.x, y: ev.clientY - view.y }; cv.style.cursor = 'grabbing'; });
addEventListener('mousemove', ev => {
  if (drag) { const p = toWorld(ev); drag.x = p.x; drag.y = p.y; drag.vx = drag.vy = 0; moved = true; alpha = Math.max(alpha, .3); }
  else if (pan) { view.x = ev.clientX - pan.x; view.y = ev.clientY - pan.y; moved = true; }
  else { hover = hit(toWorld(ev)); cv.style.cursor = hover ? 'pointer' : 'grab'; cv.title = hover ? hover.name + (hover.folder ? ' (' + hover.folder + ')' : '') : ''; }
});
addEventListener('mouseup', ev => { if (drag && !moved) vscode.postMessage({ type: 'open', id: drag.id, name: drag.name }); drag = null; pan = null; cv.style.cursor = 'grab'; });
cv.addEventListener('wheel', ev => { ev.preventDefault(); autoFit = false; const f = Math.exp(-ev.deltaY * 0.0015); view.k = Math.min(4, Math.max(0.1, view.k * f)); }, { passive: false });
document.getElementById('q').addEventListener('input', () => { filter(); alpha = Math.max(alpha, .5); });
document.getElementById('orphans').addEventListener('change', () => { filter(); alpha = Math.max(alpha, .5); });
addEventListener('message', ev => { if (ev.data.type === 'data') load(ev.data.data); });
tick();`, n);
  panel.webview.postMessage({ type: 'data', data: data() });
  return { panel, update: () => panel.webview.postMessage({ type: 'data', data: data() }) };
}

// ---------------------------------------------------------------- Kanban
async function showKanban(file) {
  const doneColumn = cfg().get('kanban.doneColumn');
  const key = `kanban:${file.toLowerCase()}`;
  const write = async (newText) => {
    const doc = await vscode.workspace.openTextDocument(file);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), newText);
    await vscode.workspace.applyEdit(edit);
    await doc.save();
  };
  const { panel, created } = getPanel(key, `${t('Board')}: ${path.basename(file, path.extname(file))}`, async (m) => {
    const doc = await vscode.workspace.openTextDocument(file);
    const text = doc.getText();
    if (m.type === 'move') await write(moveCard(text, m.line, m.to, { doneColumn }));
    if (m.type === 'toggle') {
      const lines = text.split(/\r?\n/);
      const next = toggleTaskLine(lines[m.line], cfg().get('tasks.stampCompletion') ? today() : null);
      if (next !== null) { lines[m.line] = next; await write(lines.join(text.includes('\r\n') ? '\r\n' : '\n')); }
    }
    if (m.type === 'add' && m.text.trim()) {
      const cols = parseBoard(text);
      const col = cols[m.col];
      const lines = text.split(/\r?\n/);
      const last = col.cards[col.cards.length - 1];
      let at = last ? last.endLine + 1 : col.line + 1;
      if (!last && col.line >= 0 && lines[at] !== undefined && lines[at].trim() === '') at++;
      lines.splice(Math.max(0, at), 0, `- [ ] ${m.text.trim()}`);
      await write(lines.join(text.includes('\r\n') ? '\r\n' : '\n'));
    }
    if (m.type === 'addColumn' && m.text.trim()) {
      const sep = text.endsWith('\n') ? '' : '\n';
      await write(`${text}${sep}\n## ${m.text.trim()}\n`);
    }
    if (m.type === 'open') await openAt(file, m.line, 0, vscode.ViewColumn.Beside);
  });
  const n = nonce();
  if (created) panel.webview.html = page(panel.webview, t('Board'), `
<div class="bar"><h1>${esc(path.basename(file, path.extname(file)))}</h1>
  <span class="muted">${esc(t('Columns are ## headings; cards are - [ ] tasks. Drag cards between columns.'))}</span>
  <form id="newcol" style="margin-left:auto;display:flex;gap:6px"><input name="t" placeholder="${esc(t('New column'))}" aria-label="${esc(t('New column name'))}"><button>${esc(t('Add column'))}</button></form></div>
<div id="board" style="display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding-bottom:12px"></div>
<style>
  .col { flex: 0 0 260px; background: var(--vscode-sideBar-background, var(--vscode-editorWidget-background)); border: 1px solid var(--vscode-panel-border, transparent); border-radius: 6px; padding: 8px; }
  .col.over { outline: 2px dashed var(--vscode-focusBorder); }
  .col h2 { font-size: 1em; margin: 2px 4px 8px; display: flex; justify-content: space-between; }
  .card { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border, #8883); border-radius: 4px; padding: 6px 8px; margin-bottom: 6px; cursor: grab; display: flex; gap: 6px; align-items: flex-start; }
  .card.done span { text-decoration: line-through; color: var(--vscode-descriptionForeground); }
  .card span { flex: 1; word-break: break-word; }
  .card .open { visibility: hidden; padding: 0 4px; }
  .card:hover .open, .card:focus-within .open { visibility: visible; }
  .add { display: flex; gap: 4px; margin-top: 4px; } .add input { flex: 1; min-width: 0; }
  .chip { display: inline-block; margin-top: 3px; padding: 0 5px; border-radius: 3px; font-size: .85em; text-decoration: none; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .chip.overdue { background: var(--vscode-inputValidation-errorBackground, #a1260d); color: var(--vscode-foreground); }
  .chip.stamp { background: transparent; color: var(--vscode-descriptionForeground); padding: 0; }
</style>`, `
const board = document.getElementById('board');
const today = '${today()}';
let dragLine = null;
function render(cols) {
  board.textContent = '';
  cols.forEach((c, ci) => {
    const col = document.createElement('section'); col.className = 'col'; col.setAttribute('aria-label', c.title);
    const h = document.createElement('h2'); h.textContent = c.title;
    const cnt = document.createElement('span'); cnt.className = 'muted'; cnt.textContent = c.cards.length; h.append(cnt); col.append(h);
    for (const card of c.cards) {
      const el = document.createElement('div'); el.className = 'card' + (card.done ? ' done' : ''); el.draggable = true; el.tabIndex = 0;
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = card.done; cb.setAttribute('aria-label', card.text);
      cb.addEventListener('change', () => vscode.postMessage({ type: 'toggle', line: card.line }));
      const s = document.createElement('span');
      s.textContent = card.label;
      for (const [cls, label] of [card.due && !card.done ? ['due' + (card.due < today ? ' overdue' : ''), '📅 ' + card.due] : null, card.doneOn ? ['stamp', '✓ ' + card.doneOn] : null].filter(Boolean)) {
        const b = document.createElement('small'); b.className = 'chip ' + cls; b.textContent = label; s.append(document.createElement('br'), b);
      }
      const o = document.createElement('button'); o.className = 'open'; o.textContent = '↗'; o.title = '${esc(t('Open in editor'))}';
      o.addEventListener('click', () => vscode.postMessage({ type: 'open', line: card.line }));
      el.append(cb, s, o);
      el.addEventListener('dragstart', ev => { dragLine = card.line; ev.dataTransfer.effectAllowed = 'move'; });
      // Keyboard: Alt+Left/Right moves the card to the neighbouring column
      el.addEventListener('keydown', ev => {
        if (!ev.altKey || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return;
        const to = ci + (ev.key === 'ArrowRight' ? 1 : -1);
        if (to >= 0 && to < cols.length) vscode.postMessage({ type: 'move', line: card.line, to });
      });
      col.append(el);
    }
    const f = document.createElement('form'); f.className = 'add';
    const i = document.createElement('input'); i.placeholder = '${esc(t('Add a card…'))}'; i.setAttribute('aria-label', '${esc(t('Add a card to'))} ' + c.title);
    const b = document.createElement('button'); b.textContent = '+'; b.title = '${esc(t('Add card'))}';
    f.append(i, b); f.addEventListener('submit', ev => { ev.preventDefault(); vscode.postMessage({ type: 'add', col: ci, text: i.value }); i.value = ''; });
    col.append(f);
    col.addEventListener('dragover', ev => { ev.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', ev => { ev.preventDefault(); col.classList.remove('over'); if (dragLine !== null) vscode.postMessage({ type: 'move', line: dragLine, to: ci }); dragLine = null; });
    board.append(col);
  });
}
document.getElementById('newcol').addEventListener('submit', ev => { ev.preventDefault(); const i = ev.target.t; vscode.postMessage({ type: 'addColumn', text: i.value }); i.value = ''; });
addEventListener('message', ev => { if (ev.data.type === 'board') render(ev.data.columns); });`, n);
  const update = async () => {
    const doc = await vscode.workspace.openTextDocument(file);
    // Due dates and completion stamps are shown as labels, not as raw text on the card
    const columns = parseBoard(doc.getText(), t('Tasks')).map(c => ({
      ...c,
      cards: c.cards.map(card => {
        const due = /@due\((\d{4}-\d{2}-\d{2})\)/.exec(card.text);
        const stamp = /✓\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(card.text);
        const label = card.text.replace(/\s*@due\([^)]*\)/, '').replace(/\s*✓\s*\d{4}-\d{2}-\d{2}\s*$/, '').trim();
        return { ...card, label, due: due ? due[1] : null, doneOn: stamp ? stamp[1] : null };
      })
    }));
    panel.webview.postMessage({ type: 'board', columns });
  };
  if (created) {
    const sub = vscode.workspace.onDidChangeTextDocument(e => { if (e.document.uri.fsPath.toLowerCase() === file.toLowerCase()) update(); });
    panel.onDidDispose(() => sub.dispose());
  }
  await update();
  return { panel, update };
}

// ---------------------------------------------------------------- Calendar
function showCalendar(index) {
  const state = { year: new Date().getFullYear(), month: new Date().getMonth() };
  const dailyFile = (d) => path.join(root(), cfg().get('daily.folder'), `${formatDate(d, cfg().get('daily.fileNameFormat'))}.md`);
  const { panel, created } = getPanel('calendar', t('Notes Calendar'), async (m) => {
    if (m.type === 'nav') { state.month += m.delta; if (m.delta === 0) { state.year = new Date().getFullYear(); state.month = new Date().getMonth(); } update(); }
    if (m.type === 'day') {
      const [y, mo, d] = m.date.split('-').map(Number);
      await vscode.commands.executeCommand('notesExplorer.openDailyFor', new Date(y, mo - 1, d));
    }
    if (m.type === 'task') await openAt(m.file, m.line, 0);
  });
  const update = () => {
    const d = new Date(state.year, state.month, 1);
    state.year = d.getFullYear(); state.month = d.getMonth();
    const weekStart = cfg().get('calendar.weekStart') === 'sunday' ? 0 : 1;
    const due = new Map();
    for (const x of index.openTasks()) if (x.due) (due.get(x.due) || due.set(x.due, []).get(x.due)).push({ text: x.text, file: x.file, line: x.line });
    const iso = (dt) => formatDate(dt, 'YYYY-MM-DD');
    const weeks = monthGrid(state.year, state.month, weekStart).map(w => w.map(dt => dt && ({
      date: iso(dt), day: dt.getDate(), hasNote: fs.existsSync(dailyFile(dt)), tasks: due.get(iso(dt)) || []
    })));
    const names = Array.from({ length: 7 }, (_, i) => formatDate(new Date(2024, 0, 7 + weekStart + i), 'ddd'));
    panel.webview.postMessage({ type: 'month', title: formatDate(d, 'MMMM YYYY'), weeks, names, today: today() });
  };
  const n = nonce();
  if (created) panel.webview.html = page(panel.webview, t('Notes Calendar'), `
<div class="bar"><button id="prev" aria-label="${esc(t('Previous month'))}">‹</button><button id="today">${esc(t('Today'))}</button><button id="next" aria-label="${esc(t('Next month'))}">›</button>
<h1 id="title" aria-live="polite"></h1><span class="muted">${esc(t('● daily note · click a day to open or create its note'))}</span></div>
<table id="cal" role="grid" style="width:100%;border-collapse:collapse;table-layout:fixed"></table>
<style>
  th { font-weight: 600; text-align: left; padding: 4px 6px; color: var(--vscode-descriptionForeground); }
  td { vertical-align: top; height: 92px; border: 1px solid var(--vscode-panel-border, #8883); padding: 4px 6px; cursor: pointer; }
  td:hover { background: var(--vscode-list-hoverBackground); }
  td.empty { cursor: default; background: transparent; }
  td.today .num { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border-radius: 10px; padding: 0 6px; }
  .num { font-weight: 600; } .dot { color: var(--vscode-charts-blue, #3b82f6); margin-left: 4px; }
  .task { display: block; text-decoration: none; font-size: .9em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; padding: 1px 4px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .task.overdue { background: var(--vscode-inputValidation-errorBackground, #a1260d); color: var(--vscode-foreground); }
</style>`, `
const cal = document.getElementById('cal');
document.getElementById('prev').onclick = () => vscode.postMessage({ type: 'nav', delta: -1 });
document.getElementById('next').onclick = () => vscode.postMessage({ type: 'nav', delta: 1 });
document.getElementById('today').onclick = () => vscode.postMessage({ type: 'nav', delta: 0 });
addEventListener('message', ev => {
  const m = ev.data; if (m.type !== 'month') return;
  document.getElementById('title').textContent = m.title;
  cal.textContent = '';
  const head = cal.createTHead().insertRow();
  for (const n of m.names) { const th = document.createElement('th'); th.textContent = n; head.append(th); }
  const body = cal.createTBody();
  for (const w of m.weeks) {
    const tr = body.insertRow();
    for (const c of w) {
      const td = tr.insertCell();
      if (!c) { td.className = 'empty'; continue; }
      td.className = c.date === m.today ? 'today' : '';
      td.tabIndex = 0;
      td.setAttribute('aria-label', c.date + (c.hasNote ? ', ${esc(t('has a daily note'))}' : '') + (c.tasks.length ? ', ' + c.tasks.length + ' ${esc(t('tasks due'))}' : ''));
      const num = document.createElement('span'); num.className = 'num'; num.textContent = c.day; td.append(num);
      if (c.hasNote) { const d = document.createElement('span'); d.className = 'dot'; d.textContent = '●'; td.append(d); }
      for (const x of c.tasks.slice(0, 3)) {
        const s = document.createElement('a'); s.className = 'task' + (c.date < m.today ? ' overdue' : ''); s.textContent = x.text; s.title = x.text; s.href = '#';
        s.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); vscode.postMessage({ type: 'task', file: x.file, line: x.line }); };
        td.append(s);
      }
      if (c.tasks.length > 3) { const more = document.createElement('span'); more.className = 'muted'; more.textContent = '+' + (c.tasks.length - 3); td.append(more); }
      const open = () => vscode.postMessage({ type: 'day', date: c.date });
      td.onclick = open; td.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } };
    }
  }
});`, n);
  update();
  return { panel, update };
}

const isOpen = (key) => panels.has(key);
module.exports = { showGraph, showKanban, showCalendar, isOpen, isUnderRoot };
