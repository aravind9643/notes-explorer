// Templates that ship with the extension. A file with the same name in the templates folder
// (for example ".templates/Meeting.md") replaces the built-in one, so any of them can be customised.
// Placeholders: {{title}} {{date}} {{time}} {{datetime}} {{date:FORMAT}} {{cursor}}. No `vscode` import.
//
// Each template carries short example lines (in italics, starting with "e.g.") that show what belongs in
// a section; they are meant to be overwritten.

const BUILTIN = [
  {
    name: 'Meeting', icon: 'organization', description: 'Agenda, notes, decisions and action items',
    body: `# {{title}}

**Date:** {{date}} {{time}}
**Attendees:** _e.g. Priya, Sam, Alex_
**Goal:** _e.g. agree the launch date and owners_

## Agenda

1. {{cursor}}_e.g. Status of the beta_
2. _e.g. Launch date options_
3. _e.g. Open questions_

## Notes

- _e.g. Beta has 120 users; 3 open bugs, none blocking_
- _e.g. Marketing needs two weeks' notice before launch_

## Decisions

- _e.g. Launch on the 15th, with a fallback of the 22nd_

## Action items

- [ ] _e.g. Sam: fix the login timeout bug_ @due(YYYY-MM-DD)
- [ ] _e.g. Priya: send the launch plan to marketing_ @due(YYYY-MM-DD)

## Next meeting

_e.g. same time next week, to review the bug fixes_
`
  },
  {
    name: 'Daily', icon: 'calendar', description: 'Top 3 for the day, schedule, notes, end-of-day review',
    body: `# {{date:dddd, DD MMMM YYYY}}

## Top 3 today

- [ ] {{cursor}}_e.g. Finish the quarterly report draft_
- [ ] _e.g. Review Sam's pull request_
- [ ] _e.g. Book the team offsite venue_

## Schedule

- _e.g. 09:30 Standup_
- _e.g. 14:00 Design review with Priya_

## Notes

- _e.g. Report numbers are in the shared sheet, tab "Q3"_

## End of day

- **Done:** _e.g. report draft, PR review_
- **Carry over:** _e.g. offsite booking, waiting for prices_
- **Tomorrow first:** _e.g. send the report for feedback_
`
  },
  {
    name: 'Weekly review', icon: 'history', description: 'Wins, lessons and next week\'s priorities',
    body: `# Week of {{date:DD MMMM YYYY}}

## Wins

- {{cursor}}_e.g. Shipped the new search page_
- _e.g. Closed 9 support tickets_

## What didn't go well

- _e.g. Too many meetings on Tuesday; no deep work_

## Lessons

- _e.g. Block mornings for focused work before accepting invites_

## Next week's priorities

- [ ] _e.g. Start the payments integration_
- [ ] _e.g. Write the onboarding guide_
- [ ] _e.g. 1-on-1s with the two new hires_

## Notes to self

_e.g. Ask for feedback on the search page from the support team_

#weekly-review
`
  },
  {
    name: 'Project', icon: 'project', description: 'Goal, scope, milestones and a task board',
    body: `# {{title}}

**Started:** {{date}}
**Owner:** _e.g. you_
**Status:** Planning / In progress / Done

## Goal

{{cursor}}_e.g. Let customers pay by card in the app, so we can stop sending invoices by email._

## Scope

- **In:** _e.g. card payments, receipts by email_
- **Out:** _e.g. refunds, other currencies (later)_

## Milestones

- [ ] _e.g. Payment provider chosen_ @due(YYYY-MM-DD)
- [ ] _e.g. Checkout works in test mode_
- [ ] _e.g. Live for 10% of customers_

## Backlog

- [ ] _e.g. Compare Stripe and Adyen fees_ #research
- [ ] _e.g. Design the checkout screen_

## In progress

- [ ] _e.g. Set up the test account_

## Done

## Risks

- _e.g. Provider approval can take two weeks_

## Links

- _e.g. [[Payments research]]_

#project
`
  },
  {
    name: '1-on-1', icon: 'person', description: 'Running agenda for one-to-one meetings',
    body: `# 1-on-1: {{title}}

_Add a new dated section at the top for each meeting; keep older ones below._

## {{date}}

### Their topics

- {{cursor}}_e.g. Wants to lead the next feature_
- _e.g. Unsure about the on-call rota_

### My topics

- _e.g. Feedback on last week's demo_
- _e.g. Training budget for the conference_

### Feedback

- _e.g. Demo was clear; next time show the numbers first_

### Follow-ups

- [ ] _e.g. Me: check if the conference fits the budget_ @due(YYYY-MM-DD)
- [ ] _e.g. Them: draft a plan for the new feature_
`
  },
  {
    name: 'Standup', icon: 'comment-discussion', description: 'Yesterday, today and blockers',
    body: `# Standup {{date}}

## Yesterday

- {{cursor}}_e.g. Finished the API for saved searches_
- _e.g. Reviewed two pull requests_

## Today

- [ ] _e.g. Connect the saved-search API to the UI_
- [ ] _e.g. Pair with Alex on the flaky test_

## Blockers

- _e.g. Waiting for design sign-off on the empty state_
`
  },
  {
    name: 'Bug report', icon: 'bug', description: 'Steps, expected vs actual, environment',
    body: `# Bug: {{title}}

**Reported:** {{date}}
**Reported by:** _e.g. customer support, ticket #4821_
**Severity:** Low / Medium / High

## Summary

{{cursor}}_e.g. Users are logged out after 5 minutes instead of 8 hours._

## Steps to reproduce

1. _e.g. Log in with "Remember me" ticked_
2. _e.g. Leave the tab idle for 5 minutes_
3. _e.g. Click any link_

## Expected

_e.g. Still logged in._

## Actual

_e.g. Redirected to the login page._

## Environment

- **Version:** _e.g. 2.14.0_
- **OS / browser:** _e.g. Windows 11, Edge 130_

## Notes and logs

\`\`\`text
e.g. 401 Unauthorized at /api/session (token expired at 10:05:12)
\`\`\`

## Fix

- [ ] Reproduce
- [ ] Find the cause _e.g. session timeout read in seconds instead of minutes_
- [ ] Fix and add a test
- [ ] Confirm with the reporter

#bug
`
  },
  {
    name: 'Decision record', icon: 'law', description: 'Context, options and the decision (ADR)',
    body: `# Decision: {{title}}

**Date:** {{date}}
**Status:** Proposed / Accepted / Superseded by [[…]]
**Deciders:** _e.g. Priya, Sam_

## Context

{{cursor}}_e.g. Our nightly reports take 3 hours and often fail. We need them ready by 7am._

## Options

1. **e.g. Keep the current database, add indexes**
   - Pros: _no migration, cheap_
   - Cons: _only a 30% speed-up in tests_
2. **e.g. Move reports to a separate analytics database**
   - Pros: _10× faster, doesn't slow the app_
   - Cons: _new service to run, one-off migration_

## Decision

_e.g. Option 2: a separate analytics database, starting with the two slowest reports._

## Consequences

- _e.g. Reports are about an hour behind live data_
- _e.g. Someone must own the new service_

#decision
`
  },
  {
    name: 'Retrospective', icon: 'sync', description: 'What went well, what to improve, actions',
    body: `# Retrospective: {{title}}

**Date:** {{date}}
**Period:** _e.g. Sprint 14, 1–14 October_

## What went well

- {{cursor}}_e.g. Releases went out every week without issues_
- _e.g. Good teamwork on the outage_

## What could be better

- _e.g. Tickets were often unclear when work started_
- _e.g. Code reviews waited more than a day_

## Ideas

- _e.g. Add acceptance criteria before a ticket enters the sprint_
- _e.g. Daily 15-minute review slot_

## Actions

- [ ] _e.g. Priya: add an acceptance-criteria checklist to the ticket template_ @due(YYYY-MM-DD)
- [ ] _e.g. Team: try the review slot for two weeks_

#retro
`
  },
  {
    name: 'How-to', icon: 'book', description: 'Step-by-step instructions you want to remember',
    body: `# How to {{title}}

**Last checked:** {{date}}

## When to use this

{{cursor}}_e.g. When a customer asks for an export of all their data._

## Before you start

- _e.g. Admin access to the production dashboard_

## Steps

1. _e.g. Find the customer's account ID in the dashboard_
2. _e.g. Run the export command below with that ID_
3. _e.g. Upload the zip to the shared drive and send the link_

## Commands

\`\`\`sh
# e.g.
./scripts/export-account --id 12345 --out export.zip
\`\`\`

## Troubleshooting

- **e.g. "Permission denied":** _ask for the export role in #it-help_

## References

- _e.g. [[Data retention policy]]_
`
  },
  {
    name: 'Reading notes', icon: 'bookmark', description: 'Notes on a book, article, talk or course',
    body: `# {{title}}

**Author / source:** _e.g. Cal Newport_
**Link:** _e.g. https://…_
**Read on:** {{date}}
**Rating:** _e.g. 4/5_

## Summary

{{cursor}}_e.g. Focused, uninterrupted work produces most of the value; protect time for it._

## Key ideas

- _e.g. Schedule deep work in blocks of 90+ minutes_
- _e.g. Batch shallow work like email into fixed slots_

## Quotes

> _e.g. "Clarity about what matters provides clarity about what does not."_

## How I'll use this

- [ ] _e.g. Block 9–11am for deep work, three days a week_

## Related

- _e.g. [[Weekly review]]_

#reading
`
  },
  {
    // Offers to encrypt the new note straight away (see capture.newNote)
    name: 'Credentials', icon: 'key', description: 'Logins, API keys and accounts, grouped by environment', encrypt: true,
    body: `# {{title}}

> Keep this note encrypted: right-click it → *Encrypt with Password…*. To hide values on screen as well, add
> \`(?:password|secret|token|key)\\s*:\\s*(\\S+)\` to the \`notesExplorer.mask.patterns\` setting.

**Last reviewed:** {{date}}

## Production

### {{cursor}}_e.g. Admin portal_

- **URL:** _e.g. https://admin.example.com_
- **Username:** _e.g. admin@example.com_
- **Password:** _e.g. (paste it here)_
- **2FA:** _e.g. authenticator app on my phone_
- **Notes:** _e.g. shared with the support team; rotate every 90 days_

## QA / Staging

### _e.g. Staging site_

- **URL:** _e.g. https://staging.example.com_
- **Username:** _e.g. qa-tester_
- **Password:** _e.g. (paste it here)_

## Development

### _e.g. Local database_

- **Host:** _e.g. localhost:5432_
- **Username:** _e.g. dev_
- **Password:** _e.g. (paste it here)_

## API keys

| Service | Key name | Where it's used | Expires |
| --- | --- | --- | --- |
| _e.g. Payments_ | _e.g. live secret key_ | _e.g. checkout service_ | _e.g. 2027-01-31_ |

- **Key:** _e.g. (paste the value here, not in the table)_

## Recovery

- **Recovery codes:** _e.g. printed copy in the office safe_
- **Account owner:** _e.g. IT, it-help@example.com_

#credentials
`
  },
  {
    name: 'Checklist', icon: 'checklist', description: 'A reusable list of steps to tick off',
    body: `# {{title}}

_e.g. a release, onboarding, travel or month-end checklist. Copy this note each time you use it._

- [ ] {{cursor}}_e.g. Update the version number_
- [ ] _e.g. Run all tests_
- [ ] _e.g. Write the release notes_
- [ ] _e.g. Tag and publish_
- [ ] _e.g. Announce in the team channel_
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
