// Starter notes for a new, empty notes folder: a few folders and example notes that show the main features.
// Offered once when an empty folder is chosen, and available any time as "Create Starter Notes".
// Existing files are never overwritten. No `vscode` import, so it can be unit-tested with plain Node.
const fs = require('fs/promises');
const path = require('path');

/** Relative path → content. Folders are created from the paths; `{{today}}` and `{{in3days}}` are filled in. */
const STARTER = {
  'Welcome.md': `# Welcome to Notes Explorer

This folder was set up with a few examples. Keep them, change them or delete them: they're ordinary Markdown files.

## Where things go

| Folder / note | For |
| --- | --- |
| [[Inbox]] | Quick thoughts to sort later (\`Ctrl+Alt+C\` adds a line) |
| \`Daily/\` | One note per day (\`Ctrl+Alt+D\`) |
| \`Projects/\` | One note per project, see [[Example project]] |
| \`Meetings/\` | Meeting notes, see [[Example meeting]] |
| \`Reference/\` | How-tos and things to look up, see [[Using Notes Explorer]] |
| \`Archive/\` | Finished projects and old notes |

## Try it

- [ ] Open today's note with \`Ctrl+Alt+D\`
- [ ] Tick this task, then look at the **Tasks** view
- [ ] Right-click [[Example project]] in the tree → *Show as Board*
- [ ] Type \`[[\` in a note to link to another one
- [ ] Open the \`…\` menu → *Show Graph*

#start-here
`,

  'Inbox.md': `# Inbox

Anything you want to remember, to sort into a project or reference note later.

- Idea: a shared glossary for the team #idea
- Read the article Alex sent about faster builds
`,

  'Projects/Example project.md': `# Example project

**Started:** {{today}}
**Status:** In progress

## Goal

Show how a project note works. Each \`##\` section below is a column when you choose *Show as Board*.

## Backlog

- [ ] Collect requirements #example
- [ ] Draft a plan

## In progress

- [ ] Kick-off with the team @due({{in3days}})

## Done

- [x] Create the project note ✓ {{today}}

## Links

- [[Example meeting]]
`,

  'Meetings/Example meeting.md': `# Example meeting

**Date:** {{today}}
**Attendees:** you, the team

## Notes

- Agreed the first steps for [[Example project]]

## Action items

- [ ] Share the plan with the team @due({{in3days}})
`,

  'Reference/Using Notes Explorer.md': `# Using Notes Explorer

## Keyboard shortcuts

| Keys | Does |
| --- | --- |
| \`Ctrl+Alt+D\` | Today's note |
| \`Ctrl+Alt+N\` | Open a note by name |
| \`Ctrl+Alt+F\` | Search all notes |
| \`Ctrl+Alt+C\` | Quick capture to [[Inbox]] |
| \`Ctrl+Alt+T\` | Add a task; "tomorrow" or "by friday" sets the due date |

On macOS use \`Cmd+Alt\` instead of \`Ctrl+Alt\`.

## Writing notes

- **Tasks:** \`- [ ] Send the report @due(2026-12-01)\` appears in the Tasks view, with a reminder on the day
- **Repeating tasks:** add \`@every(week)\`, \`@every(month)\` or \`@every(monday)\`
- **Links:** \`[[Note name]]\` or \`[[Note name#Heading]]\`
- **Tags:** \`#anything\`, then filter the tree by tag
- **Templates:** *New Note* offers templates for meetings, projects, bug reports and more

## Keeping things safe

- Right-click a note → *Encrypt with Password…* for sensitive notes
- Right-click a note → *Show Note History* to restore an earlier version
`,

  'Daily/.gitkeep': '',
  'Archive/.gitkeep': ''
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** True when a folder has no files or folders other than hidden ones (.git, .DS_Store …) and desktop.ini. */
async function isEmptyFolder(dir) {
  try {
    const entries = await fs.readdir(dir);
    return entries.every(e => e.startsWith('.') || /^desktop\.ini$/i.test(e));
  } catch { return false; }
}

/**
 * Writes the starter notes into `root`, skipping any file that already exists.
 * Returns the relative paths that were created.
 */
async function createStarter(root, now = new Date()) {
  const later = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3);
  const created = [];
  for (const [rel, content] of Object.entries(STARTER)) {
    const file = path.join(root, ...rel.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      await fs.writeFile(file, content.replace(/\{\{today\}\}/g, iso(now)).replace(/\{\{in3days\}\}/g, iso(later)), { flag: 'wx' });
      created.push(rel);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  return created;
}

module.exports = { STARTER, createStarter, isEmptyFolder };
