# Changelog

## 0.1.0

- First working version: GitHub panel (assigned/created/open/repo/project views,
  issue detail with milestone, labels, priority, assignees, linked and mentioned
  pull-request status), composer handoff strip with drag-and-drop, GitHub settings
  page (auth status, handoff behavior, prompt template).
- Host half reads the token from the `gh` CLI, talks GitHub GraphQL, and exposes
  the data over a self-mounted Typert Remote namespace; the browser never sees a
  token.
- Read-only by design.
