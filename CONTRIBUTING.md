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
3. Publish with Microsoft Entra ID (no personal access token; global PATs stop working on 1 December 2026):
   - Once per machine: install the Azure CLI and run `az login --tenant <tenant-id> --allow-no-subscriptions`, completing MFA in the browser.
   - Once per publisher: the Azure DevOps user ID of that sign-in must be a member of the publisher. Find it with
     `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798` and the profile API
     (`https://app.vssps.visualstudio.com/_apis/profile/profiles/me`), then add it as *Contributor* under the publisher's **Members**.
     With a personal Microsoft account this ID differs from the one the Marketplace website uses.
   - `npm run publish:check` confirms access; `npm run publish` publishes.
