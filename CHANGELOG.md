# Changelog

## 0.7.0 (2026-10-29)

- Fixed the milestone filter never reaching GitHub: the Host's Remote wire
  validator (`normalizeRequest`) whitelisted request fields but not `milestone` /
  `milestoneNumber`, so the client's filters were silently dropped before the
  list query. The validator now accepts both (and has regression tests).
- The detail pane renders the **complete** issue body as sanitized GitHub-flavored
  Markdown (headings, lists, task lists, code blocks, tables, links, images)
  instead of a fixed-height box of raw text; the pane is wider (420px) and
  scrolls independently.
- Faster interactions:
  - filter changes update the select and start the list request immediately, while
    the preference save runs in parallel (one round trip instead of two);
  - bootstrap reads status, preferences and the scope catalog concurrently and
    picks default organization/repository without extra list requests;
  - the detail body and its mentioned-PR timeline are fetched in parallel, so the
    pane shows as soon as the body arrives.
- Dependencies `marked` and `dompurify` are build-time dev dependencies bundled
  into the browser half; the published package still installs nothing extra.

## 0.6.0 (2026-10-29)

- The project filter is gone. The cascade is now **organization → repository →
  milestone → assignee → state**: the organization and repository are required,
  the first organization and its first repository are selected automatically, and
  the repository is a plain dropdown (no searchable "all repositories" state).
- The repository dropdown only lists repositories of the selected organization, and
  the milestone dropdown is loaded from that repository (open and closed
  milestones). Changing organization or repository resets the dependent choices.
- Listing now uses the repository's exact `issues` connection with server-side
  `filterBy`, instead of the global search. State, assignee and milestone filters
  are applied by GitHub, `totalCount` is authoritative, and `@me` is resolved to
  the viewer's login. This fixes the milestone filter not narrowing the list: the
  connection wants the milestone *number* (`filterBy.milestoneNumber`), not its
  title; a title-only request falls back to the search qualifier.
- Removed the Projects v2 scope warning from Settings and the project-related
  documentation.
- The fixed toolbar / independent list and detail scrolling from 0.5.0 are
  unchanged.

## 0.5.0 (2026-10-29)

- The panel's cascade toolbar is now a fixed strip: the page title, the six-field
  filter row (organization / project / repository / milestone / assignee / state)
  and the search stay in place while only the issue list scrolls. The detail pane
  is a second, independently scrollable column.
- The six filters are one weighted grid row at normal widths (the repository and
  milestone fields are wider); narrow windows fall back to wrapping.
- New milestone filter: a dropdown populated from the selected repository's
  milestone list (or accumulated from loaded issues in an all-repositories scope).
  It is persisted with the other filters and sent as a `milestone:"..."` search
  qualifier (or the repo-issues `filterBy.milestone` filter). Projects v2 boards
  have no milestone filter, so the control is disabled there.
- A headless render check of the panel layout keeps the toolbar fixed and verifies
  that list and detail scroll separately (development aid, not shipped).

## 0.4.7 (2026-10-28)

First public release. Earlier numbered entries were development snapshots before the package was published.

- Redesigned the detail pane's action and session areas. Primary actions are now
  two real buttons with icons and equal height ("open session" primary, "new
  session" outlined); "open on GitHub" and "copy prompt" moved to subtle inline
  actions on the right. The linked-session list explains itself and gives each
  entry a status dot, title/workspace, an "open" button and an "unlink" button
  with a tooltip that unlinking never deletes the Session. The pane close control
  is now named "close detail" so it cannot be confused with unlinking.

## 0.4.6

- The linked issue chip under the composer shows the issue state as a colored dot
  (green open, red closed) instead of the "open/closed" words.
- Issue detail is split into a fast body request plus a lazy cross-referenced-PR
  request. The pane renders title/milestone/labels/assignees/linked PRs straight
  from the list card while the body loads; the mentioned-PR section shows a
  loading hint. Measured on mesh#2469: full detail cold ~5.0s -> body-only cold
  ~2.4s / warm ~0.6s; the timeline leg (~3.6s cold) loads after the pane is
  visible. Chips no longer trigger a detail request each (list lookup or
  placeholder instead).
- The detail pane now offers both actions when the issue is already linked:
  "enter Session" (most recent link) and "new Session for this issue". The
  handling-session list still lets you enter any linked Session; multiple links
  per issue are allowed (up to 20).

## 0.4.5

- The in-composer issue card now shows only the GitHub icon, `org/repo#number`
  and the remove control; the issue state ("open") belongs to the linked chip
  below and was redundant inside the card.
- Fix: sending could fail to record the issue link when the composer skipped the
  transient submitting phase (fast send). The intercepted send now confirms the
  draft cleared after submitting and records the link from that result; the phase
  observation stays as a backup (the link write is idempotent).

## 0.4.4

- The in-composer issue card no longer shows the redundant "pending" badge: the
  card itself is the pending state. It now shows only the issue icon,
  `org/repo#number`, the issue state (open/closed) and the remove control.

## 0.4.3

- The pending issue card now *is* the prompt: the composer stays empty (only an
  invisible placeholder keeps the native send enabled), the user may type extra
  instructions, and clicking send or pressing Enter converts the card into the
  rendered issue prompt plus the user's text and submits it. The card disappears
  and the linked chip appears below once the send is observed.
- Clearing the input or removing the card still withdraws the handoff and writes
  no link.
- `composeHandoffPrompt` is a pure, unit-tested helper; the send gesture is
  intercepted at the native submit button and the editor's Enter key.

## 0.4.2

- The pending issue now renders as a small chip inside the composer card itself
  (the `conversation.input.overlay` floating layer), matching the attachment-row
  style: `[issue icon] org/repo#number state pending x`. The prompt starts on the
  line below so nothing overlaps. The official attachment rail is untouched, so
  images/files keep their thumbnails, upload progress and drag-drop.
- Linked chips stay in the dock under the composer and still show logo, state,
  organization/repository and number with a detail popover.

## 0.4.1

- The pending handoff is now a proper attachment-style issue card above the
  composer: issue logo, state, `org/repo#number`, title, a pending badge, an open
  in panel action and remove. The prompt template is written into the input, so
  the user can append instructions before sending.
- The linked chip under the composer now carries the issue logo, its state label
  (open/closed), the organization/repository and the issue number; clicking it
  still opens the detail popover.
- If the issue is already linked, the panel's button is "enter Session" and no
  card is staged; the linked chip appears in that Session's composer dock.

## 0.4.0

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

## 0.3.1

- Fix: clearing the composer no longer records a handoff. Only an observed send
  (the composer entering `submitting`/`adjudicating` with the issue marker in the
  draft) links the issue to the Session; emptying or replacing the draft now just
  withdraws the pending chip and writes no link.
- Fix: a pending handoff can be stamped with its target Session (the drag drop
  path does), so only that Session's composer can consume it.
- The one-click handoff still lands in the on-screen Session; the earlier attempt
  to open a new Session was reverted because a blank Session does not render the
  composer dock, leaving the pending chip invisible.

## 0.3.0

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

## 0.2.0

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
