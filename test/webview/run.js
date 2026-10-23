// Drives the real Graph, Board and Calendar pages in headless Edge/Chrome through the DevTools protocol:
// drag & drop, keyboard moves, clicks, wheel zoom and panning, checking the messages each page sends back
// to the extension. Run: npm run test:webview
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { buildPages, findBrowser, cleanup } = require('../../scripts/render-webviews');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Minimal DevTools protocol client over the WebSocket built into Node 22+. */
class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    };
    return this;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text}`);
    return r.result.value;
  }
  close() { this.ws.close(); }
}

async function launch(browser) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-webview-test-'));
  const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, '--window-size=1100,700', 'about:blank'];
  spawn(browser, args, { stdio: 'ignore', detached: process.platform !== 'win32' }).unref();
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await sleep(100);
  const port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
  const base = `http://127.0.0.1:${port}`;
  let page;
  for (let i = 0; i < 50 && !page; i++) { page = (await (await fetch(`${base}/json/list`)).json()).find(t => t.type === 'page'); if (!page) await sleep(100); }
  const version = await (await fetch(`${base}/json/version`)).json();
  return { page: await new Cdp(page.webSocketDebuggerUrl).open(), browserWs: version.webSocketDebuggerUrl, profile };
}

async function load(cdp, file) {
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: pathToFileURL(file).href });
  for (let i = 0; i < 100; i++) { if (await cdp.eval('document.readyState') === 'complete') break; await sleep(50); }
  await sleep(300);
}
const sent = (cdp) => cdp.eval('window.__sent.splice(0)');

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(`  ✔ ${name}`); }
  catch (err) { results.push(`  ✖ ${name}\n      ${err.message}`); process.exitCode = 1; }
}

(async () => {
  const browser = findBrowser();
  if (!browser) { console.log('No Edge or Chrome found: skipping webview tests.'); return; }
  const pages = Object.fromEntries((await buildPages()).map(p => [p.name, p]));
  const { page: cdp, browserWs, profile } = await launch(browser);
  try {
    // ---------------- Board
    await load(cdp, pages.board.file);
    await step('board renders columns and cards from the note', async () => {
      const cols = await cdp.eval(`[...document.querySelectorAll('.col')].map(c => [c.querySelector('h2').firstChild.textContent, c.querySelectorAll('.card').length])`);
      assert.deepStrictEqual(cols, [['Backlog', 3], ['In progress', 2], ['Review', 1], ['Done', 2]]);
      const chip = await cdp.eval(`[...document.querySelectorAll('.card')].find(c => /Cookie banner/.test(c.textContent)).querySelector('.chip').textContent`);
      assert.match(chip, /^📅 \d{4}-\d{2}-\d{2}$/);
    });
    await step('dragging a card onto another column asks the extension to move it', async () => {
      await cdp.eval(`(() => {
        const card = [...document.querySelectorAll('.card')].find(c => /Compress hero images/.test(c.textContent));
        const target = document.querySelectorAll('.col')[2];
        const dt = new DataTransfer();
        card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      })()`);
      assert.deepStrictEqual(await sent(cdp), [{ type: 'move', line: 5, to: 2 }]);
    });
    await step('Alt+Right moves the focused card to the next column', async () => {
      await cdp.eval(`[...document.querySelectorAll('.card')].find(c => /Accessibility audit/.test(c.textContent)).focus()`);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 1 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 1 });
      assert.deepStrictEqual(await sent(cdp), [{ type: 'move', line: 11, to: 2 }]);
    });
    await step('ticking a card and adding a card send the right messages', async () => {
      await cdp.eval(`[...document.querySelectorAll('.card')].find(c => /Blog template/.test(c.textContent)).querySelector('input').click()`);
      await cdp.eval(`(() => { const f = document.querySelectorAll('.col')[0].querySelector('form'); f.querySelector('input').value = 'New card'; f.requestSubmit(); })()`);
      assert.deepStrictEqual(await sent(cdp), [{ type: 'toggle', line: 15 }, { type: 'add', col: 0, text: 'New card' }]);
    });

    // ---------------- Graph
    await load(cdp, pages.graph.file);
    await sleep(2500); // let the layout settle
    const nodeOnScreen = (name) => cdp.eval(`(() => {
      const n = nodes.find(x => x.name === ${JSON.stringify(name)}), r = cv.getBoundingClientRect();
      return { x: r.left + r.width / 2 + view.x + n.x * view.k, y: r.top + r.height / 2 + view.y + n.y * view.k, k: view.k };
    })()`);
    await step('graph fits every note inside the canvas', async () => {
      const out = await cdp.eval(`(() => { const r = cv.getBoundingClientRect(); return nodes.filter(visible).filter(n => {
        const x = r.width / 2 + view.x + n.x * view.k, y = r.height / 2 + view.y + n.y * view.k; return x < 0 || y < 0 || x > r.width || y > r.height; }).map(n => n.name); })()`);
      assert.deepStrictEqual(out, []);
    });
    await step('clicking a note in the graph opens it', async () => {
      const p = await nodeOnScreen('Website');
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
        await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
      const msgs = await sent(cdp);
      assert.strictEqual(msgs.length, 1);
      assert.strictEqual(msgs[0].type, 'open');
      assert.match(msgs[0].id, /Website\.md$/);
    });
    await step('wheel zooms and dragging the background pans (without opening anything)', async () => {
      const before = await cdp.eval('({ ...view })');
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: -400 });
      await sleep(100);
      const zoomed = await cdp.eval('({ ...view, autoFit })');
      assert.ok(zoomed.k > before.k, `zoom ${before.k} → ${zoomed.k}`);
      assert.strictEqual(zoomed.autoFit, false, 'user zoom stops auto-fit');
      // pan from a spot on the canvas that has no note under it
      const empty = await cdp.eval(`(() => {
        const r = cv.getBoundingClientRect();
        for (let y = r.top + 20; y < r.bottom - 20; y += 15) for (let x = r.left + 20; x < r.right - 120; x += 15)
          if (!hit(toWorld({ clientX: x, clientY: y }))) return { x, y };
      })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: empty.x, y: empty.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: empty.x + 100, y: empty.y + 50, button: 'left' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: empty.x + 100, y: empty.y + 50, button: 'left', clickCount: 1 });
      const panned = await cdp.eval('({ ...view })');
      assert.ok(Math.abs(panned.x - zoomed.x - 100) < 1 && Math.abs(panned.y - zoomed.y - 50) < 1, `pan by (100,50): got (${panned.x - zoomed.x}, ${panned.y - zoomed.y})`);
      assert.deepStrictEqual(await sent(cdp), []);
    });
    await step('filter box narrows the graph; Fit restores auto-fit', async () => {
      await cdp.eval(`(() => { const q = document.getElementById('q'); q.value = 'book'; q.dispatchEvent(new Event('input')); })()`);
      assert.deepStrictEqual(await cdp.eval('nodes.filter(visible).map(n => n.name)'), ['Book notes']);
      await cdp.eval(`document.getElementById('fit').click()`);
      assert.strictEqual(await cdp.eval('autoFit'), true);
    });

    // ---------------- Calendar
    await load(cdp, pages.calendar.file);
    await step("calendar marks daily notes and today's due task", async () => {
      const today = await cdp.eval(`document.querySelector('td.today').getAttribute('aria-label')`);
      assert.match(today, /has a daily note/);
      assert.match(today, /1 tasks due/);
    });
    await step('clicking a day, a task, and the month buttons send messages', async () => {
      await cdp.eval(`document.querySelector('td.today').click()`);
      await cdp.eval(`document.querySelector('td.today a.task').click()`);
      await cdp.eval(`document.getElementById('next').click(); document.getElementById('prev').click(); document.getElementById('today').click()`);
      const msgs = await sent(cdp);
      assert.strictEqual(msgs[0].type, 'day');
      assert.match(msgs[0].date, /^\d{4}-\d{2}-\d{2}$/);
      assert.strictEqual(msgs[1].type, 'task');
      assert.match(msgs[1].file, /Weekly sync\.md$/);
      assert.deepStrictEqual(msgs.slice(2), [{ type: 'nav', delta: 1 }, { type: 'nav', delta: -1 }, { type: 'nav', delta: 0 }]);
    });
  } finally {
    cdp.close();
    try { const b = await new Cdp(browserWs).open(); await b.send('Browser.close').catch(() => {}); } catch { /* already gone */ }
    console.log(['', 'Notes Explorer webview tests', ...results, ''].join('\n'));
    // The browser can hold its profile for a moment after closing; leftovers in the temp folder are harmless
    await sleep(1000);
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* still locked */ }
    cleanup();
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
