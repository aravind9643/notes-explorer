// Runs the integration suite inside a real VS Code (downloaded on first run, cached in .vscode-test/).
// Uses a throwaway notes folder and user-data dir, so your own settings and notes are never touched.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { runTests } = require('@vscode/test-electron');

// When launched from a terminal inside VS Code, this variable makes Code.exe start as plain Node
delete process.env.ELECTRON_RUN_AS_NODE;

(async () => {
  const notes = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-it-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-it-user-'));
  fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'User', 'settings.json'), JSON.stringify({
    'notesExplorer.rootPath': notes,
    'notesExplorer.links.updateOnRename': 'always',
    'notesExplorer.reminders': false,
    'notesExplorer.pasteImages.enabled': false,
    'workbench.startupEditor': 'none',
    'security.workspace.trust.enabled': false
  }, null, 2));
  try {
    await runTests({
      version: process.env.VSCODE_TEST_VERSION || 'stable',
      extensionDevelopmentPath: path.resolve(__dirname, '..', '..'),
      extensionTestsPath: path.resolve(__dirname, 'suite.js'),
      extensionTestsEnv: { NOTES_IT_ROOT: notes },
      launchArgs: ['--disable-extensions', `--user-data-dir=${userData}`, '--skip-welcome', '--skip-release-notes']
    });
  } catch (err) {
    console.error('Integration tests failed:', err);
    process.exitCode = 1;
  } finally {
    fs.rmSync(notes, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
})();
