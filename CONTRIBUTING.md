# Contributing

## Development

- `npm install`, then press `F5` with this folder open to launch an Extension Development Host.
- `npm test`: unit tests plus an activation check against a stubbed VS Code API (plain Node, no VS Code needed).
- `npm run test:integration`: end-to-end checks inside a real VS Code (downloaded to `.vscode-test/` on first run) with a temporary notes folder and profile. CI runs it on every push.
- `npm run screenshots`: regenerates the images in `docs/` (needs Edge or Chrome).
- `npm run package`: builds the `.vsix`.

## Translations

Menu and setting text lives in `package.nls.json`; messages in code use `t('…')` and are collected into `l10n/bundle.l10n.json` by `npm run l10n`. To add a language, copy those files as `package.nls.<locale>.json` and `l10n/bundle.l10n.<locale>.json` (for example `de`, `ja`, `pt-br`) and translate the values.

## Releasing

1. Bump `version` in `package.json` and add a section to `CHANGELOG.md`.
2. `git tag vX.Y.Z && git push --tags`. CI builds the `.vsix` and attaches it to a GitHub Release.
3. Publish: `npx @vscode/vsce login <publisher>` (once, with an Azure DevOps token that has the *Marketplace → Manage* scope), then `npm run publish`.
