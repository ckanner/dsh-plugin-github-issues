# Changelog

## 0.4.0 (unreleased)

- One-click handoff now opens a fresh Session instead of using the on-screen one.
  The Workspace is resolved by: source Session > a Session already linked to the
  same repository > directory/title matching the repository name > Host default.
- The pending handoff appears as an attachment-like bar above the composer
  (`pending · org/repo#number · title · open in panel · remove`), which is also
  visible in a blank new Session where the composer dock row below the input is
  not rendered. It is stamped with its target Session so no other composer can
  steal it.
- Only an observed send records the link; clearing or removing the pending bar
  withdraws it without writing anything.
- Dragging from the right column still stages into the current Session and shows
  the same pending bar.

## 0.3.1 (unreleased)

- Fix: clearing the composer no longer records a handoff. Only an observed send
  (the composer entering `submitting`/`adjudicating` with the issue marker in the
  draft) links the issue to the Session; emptying or replacing the draft now just
  withdraws the pending chip and writes no link.
- Fix: a pending handoff can be stamped with its target Session (the drag drop
  path does), so only that Session's composer can consume it.
- The one-click handoff still lands in the on-screen Session; the earlier attempt
  to open a new Session was reverted because a blank Session does not render the
  composer dock, leaving the pending chip invisible.

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
