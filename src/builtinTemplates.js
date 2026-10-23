// Templates that ship with the extension. A file with the same name in the templates folder
// (for example ".templates/Meeting.md") replaces the built-in one, so any of them can be customised.
// Placeholders: {{title}} {{date}} {{time}} {{datetime}} {{date:FORMAT}} {{cursor}}. No `vscode` import.

const BUILTIN = [
  {
    name: 'Meeting', icon: 'organization', description: 'Agenda, notes and action items',
    body: `# {{title}}

**Date:** {{date}} {{time}}
**Attendees:**

## Agenda

- {{cursor}}

## Notes

## Decisions

## Action items

- [ ] Owner: task @due({{date}})
`
  },
  {
    name: 'Daily', icon: 'calendar', description: 'Plan for the day, notes and a short review',
    body: `# {{date:dddd, DD MMMM YYYY}}

## Top 3 today

- [ ] {{cursor}}
- [ ]
- [ ]

## Schedule

## Notes

## End of day

- Done:
- Carry over:
`
  },
  {
    name: 'Weekly review', icon: 'history', description: 'Wins, lessons and next week\'s priorities',
    body: `# Week of {{date:DD MMMM YYYY}}

## Wins

- {{cursor}}

## What didn't go well

## Lessons

## Next week's priorities

- [ ]
- [ ]
- [ ]

#weekly-review
`
  },
  {
    name: 'Project', icon: 'project', description: 'Goal, scope, milestones and a task board',
    body: `# {{title}}

**Started:** {{date}}
**Status:** Planning

## Goal

{{cursor}}

## Scope

- In:
- Out:

## Milestones

- [ ] Milestone 1 @due({{date}})

## Backlog

- [ ]

## In progress

## Done

## Links

#project
`
  },
  {
    name: '1-on-1', icon: 'person', description: 'Running agenda for one-to-one meetings',
    body: `# 1-on-1: {{title}}

## {{date}}

### Their topics

- {{cursor}}

### My topics

-

### Feedback

### Follow-ups

- [ ]
`
  },
  {
    name: 'Standup', icon: 'comment-discussion', description: 'Yesterday, today and blockers',
    body: `# Standup {{date}}

## Yesterday

- {{cursor}}

## Today

- [ ]

## Blockers

-
`
  },
  {
    name: 'Bug report', icon: 'bug', description: 'Steps, expected vs actual, environment',
    body: `# Bug: {{title}}

**Reported:** {{date}}
**Severity:** Low / Medium / High

## Summary

{{cursor}}

## Steps to reproduce

1.
2.
3.

## Expected

## Actual

## Environment

- Version:
- OS / browser:

## Notes and logs

\`\`\`text

\`\`\`

## Fix

- [ ] Reproduce
- [ ] Fix
- [ ] Test

#bug
`
  },
  {
    name: 'Decision record', icon: 'law', description: 'Context, options and the decision (ADR)',
    body: `# Decision: {{title}}

**Date:** {{date}}
**Status:** Proposed / Accepted / Superseded

## Context

{{cursor}}

## Options

1. **Option A**: pros, cons
2. **Option B**: pros, cons

## Decision

## Consequences

#decision
`
  },
  {
    name: 'Retrospective', icon: 'sync', description: 'What went well, what to improve, actions',
    body: `# Retrospective: {{title}}

**Date:** {{date}}

## What went well

- {{cursor}}

## What could be better

-

## Ideas

-

## Actions

- [ ] Owner: action @due({{date}})

#retro
`
  },
  {
    name: 'How-to', icon: 'book', description: 'Step-by-step instructions you want to remember',
    body: `# How to {{title}}

**Last checked:** {{date}}

## When to use this

{{cursor}}

## Steps

1.
2.
3.

## Commands

\`\`\`sh

\`\`\`

## Troubleshooting

## References
`
  },
  {
    name: 'Reading notes', icon: 'bookmark', description: 'Notes on a book, article, talk or course',
    body: `# {{title}}

**Author / source:**
**Link:**
**Read on:** {{date}}

## Summary

{{cursor}}

## Key ideas

-

## Quotes

>

## How I'll use this

#reading
`
  },
  {
    name: 'Checklist', icon: 'checklist', description: 'A reusable list of steps to tick off',
    body: `# {{title}}

- [ ] {{cursor}}
- [ ]
- [ ]
- [ ]
`
  }
];

/** Built-in templates merged with the user's own files; user files win when the names match. */
function mergeTemplates(userFiles) {
  const key = (n) => n.toLowerCase().replace(/\.(md|markdown|txt)$/i, '');
  const user = new Map(userFiles.map(f => [key(f), f]));
  const builtins = BUILTIN.map(b => (user.has(key(b.name)) ? { ...b, overriddenBy: user.get(key(b.name)) } : b));
  const extra = userFiles.filter(f => !BUILTIN.some(b => key(b.name) === key(f)));
  return { builtins, extra };
}

const builtinByName = (name) => BUILTIN.find(b => b.name.toLowerCase() === String(name).toLowerCase().replace(/\.(md|markdown|txt)$/i, ''));

module.exports = { BUILTIN, mergeTemplates, builtinByName };
