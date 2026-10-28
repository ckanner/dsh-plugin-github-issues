# Changelog

## 0.3.0 (unreleased)

- Co-visible right-column `Issues` tab: the same cascade-filtered list beside the
  Conversation; a header button or the right column's own add menu opens it.
- Drag an issue row from the right column into the composer to hand it to the
  current Session (the window accepts the drop; the right column itself cancels).
  The one-click handoff and the drop share one path.
- The composer chip moved to the compact dock under the input, names the
  organization (`org/repo#number`), and opens a detail popover with milestone,
  priority, linked PR, handling Session, and the open/unlink actions.
- The cascade toolbar is one aligned five-column grid; the repository count lives
  in the field placeholder.
- A persisted link now draws its chip immediately (degraded until the issue detail
  arrives) instead of waiting for the GitHub request.

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
- Reliability: client services are read through a lazy `ctx.get` bridge (a Cordis
  context property read for an undeclared service threw and blanked the panel);
  clearing a filter over the Remote wire uses `null`, and an orphan project id is
  dropped on load. An offline `react-dom/server` render smoke test now covers the
  panel, dock, sidebar and drop target.

## 0.1.0

- First working version: GitHub panel (assigned/created/open/repo/project views,
  issue detail with milestone, labels, priority, assignees, linked and mentioned
  pull-request status), composer handoff strip with drag-and-drop, GitHub settings
  page (auth status, handoff behavior, prompt template).
- Host half reads the token from the `gh` CLI, talks GitHub GraphQL, and exposes
  the data over a self-mounted Typert Remote namespace; the browser never sees a
  token.
- Read-only by design.
