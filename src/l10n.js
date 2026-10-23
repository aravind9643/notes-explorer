// Translatable runtime strings. Use {0}, {1}… placeholders. Translations live in l10n/bundle.l10n.<locale>.json;
// menu and setting text is translated through package.nls.<locale>.json.
const vscode = require('vscode');

const t = (message, ...args) => (vscode.l10n
  ? vscode.l10n.t(message, ...args)
  : message.replace(/\{(\d+)\}/g, (m, i) => (args[i] !== undefined ? String(args[i]) : m)));

module.exports = { t };
