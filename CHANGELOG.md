# Changelog

## 1.2.0

### Added
- **Add Task** (`Ctrl+Alt+T`): type a task in plain words, pick the note (Tasks, Todos, today's note, Inbox, pinned or any note) and the section.
- **Natural due dates**: "tomorrow", "by friday", "next week", "in 3 days", "end of month", "30 oct", "5/11" become `@due(...)`.
- **Carry over**: the first time you open the day's note, bring unfinished tasks from the previous daily note (move, copy, or turn off).
- **Today view**: today's note, overdue tasks and tasks due today at the top of the sidebar.
- **Quick Capture target**: the Inbox, today's note, or ask each time.
- **Tasks grouped by section**: notes with several `##` sections show them as groups in the Tasks view.
- **Encrypted notes**: password-protect a note (AES-256-GCM); it opens with the password and is saved encrypted.
- **Several notes folders**: add folders and switch between them.
- **Recurring tasks** with `@every(day|week|month|year|weekday|N days|monday…)`.
- **Headings** in the tree, and `[[Note#Heading]]` links with completion.
- **Show Note History** opens the note's saved versions in the Timeline.
- **Exclude patterns** (`.gitignore` syntax, plus the notes folder's own `.gitignore`) and a file limit for very large folders.
- **Getting-started walkthrough** (Help → Welcome).
- **13 built-in templates**: Meeting, Daily, Weekly review, Project, 1-on-1, Standup, Bug report, Decision record, Retrospective, How-to, Reading notes, Credentials (offers to encrypt itself) and Checklist. Each comes with example lines showing what goes where; copy one to your templates folder to customise it.
- **Starter notes** for an empty folder: Welcome, Inbox, Daily, Projects, Meetings, Reference and Archive, with example notes (also *Create Starter Notes*).
- Also published to **Open VSX** for VSCodium, Cursor, Windsurf and other editors.

### Changed
- The extension is bundled into a single file, so it loads faster and the package is smaller.
- Exported HTML and PDF no longer run scripts from notes: scripts and event handlers are removed and a Content Security Policy blocks the rest.
- Views have their own icons when moved to another sidebar or panel.

### Fixed
- `[[links]]` and `#tags` written inside `inline code` are no longer treated as real links or tags.

## 1.0.0

First public release.

- **Notes sidebar** in every VS Code window: browse, create, rename, move (drag & drop) and delete notes in any folder, without opening it as a workspace.
- **Quick Access**: pinned and recently opened notes.
- **Find**: Quick Open by name; full-text search with match case, whole word, regex, folder and tag scope.
- **Daily notes** and a **calendar** of daily notes and due tasks.
- **Quick Capture** to an inbox note without leaving your current file.
- **Templates** with `{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}` and `{{cursor}}`.
- **Tasks** from every note: filters, sort by due date, `@due()` reminders, completion dates, archiving finished tasks, and a status bar count.
- **Boards**: any note's `##` sections as Kanban columns.
- **Links**: `[[wiki links]]` with completion, hover previews, missing-link quick fixes, backlinks, a graph view, and links that follow renamed notes.
- **Tags**: `#tags`, tag filter and Rename Tag.
- **Notes for code**: link notes to code files and project folders.
- **Paste images** into notes.
- **Export** notes or folders to HTML or PDF.
- **Hide sensitive values** on screen with your own patterns (off by default).
- Works in Remote SSH, WSL, Dev Containers and Codespaces windows; translatable; screen-reader labels throughout.
