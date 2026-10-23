// Loads the extension against a stubbed `vscode` module: catches broken requires, typos in wiring,
// and commands declared in package.json but never registered (or the reverse).
const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const path = require('path');

function makeVscodeStub(registered) {
  const noop = () => {};
  const disposable = { dispose: noop };
  // Any unknown property is a callable, constructible no-op that returns another stub
  const anything = () => new Proxy(function () {}, {
    get: (target, prop) => (prop === 'then' ? undefined : prop === Symbol.toPrimitive ? () => '' : anything()),
    apply: () => anything(),
    construct: () => anything()
  });
  class EventEmitter { constructor() { this.event = () => disposable; } fire() {} dispose() {} }
  const config = { get: (k) => ({ hiddenFolders: [], templatesFolder: '.templates', 'mask.patterns': [], rootPath: '' }[k]), update: async () => {} };
  const stub = {
    EventEmitter,
    ThemeIcon: class { constructor(id) { this.id = id; } },
    ThemeColor: class { constructor(id) { this.id = id; } },
    TreeItem: class { constructor(label) { this.label = label; } },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ConfigurationTarget: { Global: 1 },
    Uri: { file: (p) => ({ fsPath: p, scheme: 'file' }), parse: (s) => ({ toString: () => s }) },
    l10n: { t: (m) => m },
    commands: { registerCommand: (id) => { registered.push(id); return disposable; }, executeCommand: async () => {} },
    window: new Proxy({
      createTreeView: () => ({ dispose: noop, reveal: async () => {}, visible: true, onDidChangeVisibility: () => disposable }),
      registerTreeDataProvider: () => disposable,
      createStatusBarItem: () => ({ show: noop, hide: noop, dispose: noop }),
      createTextEditorDecorationType: () => disposable,
      onDidChangeActiveTextEditor: () => disposable,
      onDidChangeVisibleTextEditors: () => disposable,
      visibleTextEditors: [],
      activeTextEditor: undefined
    }, { get: (t, p) => (p in t ? t[p] : anything()) }),
    workspace: new Proxy({
      getConfiguration: () => config,
      workspaceFolders: undefined
    }, { get: (t, p) => (p in t ? t[p] : (p.startsWith('on') ? () => disposable : anything())) }),
    languages: new Proxy({
      createDiagnosticCollection: () => ({ clear: noop, set: noop, dispose: noop })
    }, { get: (t, p) => (p in t ? t[p] : () => disposable) })
  };
  return new Proxy(stub, { get: (t, p) => (p in t ? t[p] : anything()) });
}

test('activate registers exactly the commands declared in package.json', async () => {
  const registered = [];
  const vscode = makeVscodeStub(registered);
  const origLoad = Module._load;
  Module._load = function (request, ...rest) { return request === 'vscode' ? vscode : origLoad.call(this, request, ...rest); };
  try {
    const ext = require('../src/extension');
    const subscriptions = [];
    const state = new Map();
    ext.activate({
      subscriptions,
      globalState: { get: (k, d) => (state.has(k) ? state.get(k) : d), update: async (k, v) => state.set(k, v), setKeysForSync: () => {} }
    });
    await new Promise(r => setTimeout(r, 50)); // let the first async re-index settle

    const declared = require('../package.json').contributes.commands.map(c => c.command);
    const unregistered = declared.filter(c => !registered.includes(c));
    const undeclared = registered.filter(c => !declared.includes(c));
    assert.deepStrictEqual(unregistered, [], 'declared in package.json but not registered');
    assert.deepStrictEqual(undeclared, [], 'registered but not declared in package.json');
    assert.ok(subscriptions.length > registered.length, 'views, providers and listeners are disposed with the extension');
    for (const d of subscriptions) d && d.dispose && d.dispose();
  } finally {
    Module._load = origLoad;
  }
});

test('every %key% in package.json has an English string', () => {
  const pkg = JSON.stringify(require('../package.json'));
  const nls = require('../package.nls.json');
  const missing = [...pkg.matchAll(/%([\w.]+)%/g)].map(m => m[1]).filter(k => !(k in nls));
  assert.deepStrictEqual(missing, []);
});

test('menu entries only reference declared commands', () => {
  const c = require('../package.json').contributes;
  const declared = new Set(c.commands.map(x => x.command));
  const used = Object.values(c.menus).flat().map(m => m.command).concat(c.keybindings.map(k => k.command));
  assert.deepStrictEqual(used.filter(x => !declared.has(x)), []);
  void path;
});
