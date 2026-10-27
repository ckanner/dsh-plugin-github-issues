# Changelog

## 0.2.0 (unreleased)

- Cascade scope: organization → project/repository → assignee → state, with the
  organization, project and repository remembered across restarts.
- Organizations are the union of GraphQL and `/user/orgs`, so private
  memberships appear; organization repositories load on demand (all of them,
  forks included).
- Projects v2 items are filtered by GitHub's own filter DSL (open/closed,
  assignee) instead of scanning the first page locally, and the project `Status`
  field is shown on cards.
- Issue ↔ session handoff links: a staged prompt becomes a recorded handoff when
  it is submitted; the composer shows attachment-like chips with the issue, and
  the panel shows which session is handling an issue with a button to open it.

## 0.1.0

- First working version: GitHub panel (assigned/created/open/repo/project views,
  issue detail with milestone, labels, priority, assignees, linked and mentioned
  pull-request status), composer handoff strip with drag-and-drop, GitHub settings
  page (auth status, handoff behavior, prompt template).
- Host half reads the token from the `gh` CLI, talks GitHub GraphQL, and exposes
  the data over a self-mounted Typert Remote namespace; the browser never sees a
  token.
- Read-only by design.
