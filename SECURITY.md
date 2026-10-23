# Security policy

## Reporting a vulnerability

Please report security problems privately through [GitHub's private vulnerability reporting](https://github.com/aravind9643/notes-explorer/security/advisories/new), not in a public issue. You'll get a reply within a week, and a fix is released as soon as possible, normally within 30 days.

## Supported versions

Only the latest release receives fixes.

## How Notes Explorer handles your notes

- Notes are read and written only on your computer. The extension makes no network requests and collects no telemetry.
- **Encrypted notes** (`.mdenc`) use AES-256-GCM with a key derived from your password by scrypt (N=32768, r=8, p=1). Passwords are kept in memory only, until you choose *Lock Encrypted Notes* or close the window. A forgotten password cannot be recovered.
  - While an encrypted note is open, its text is in VS Code's memory. If you close VS Code with unsaved changes, VS Code's hot exit may keep a backup of the unsaved text on disk until you reopen it.
- **Masking** only hides matching text on screen; the file itself is not encrypted.
- **Exports** remove scripts and event handlers from the HTML, and include a Content Security Policy that blocks scripts.
