# dsh-plugin-github-issues

Browse GitHub issues and hand one to the agent — inside DeepSeek Harness.

This plugin adds a **GitHub panel** to the DSH Web GUI: pick a repository or a
Projects v2 board, read the issues assigned to you (or created by you, or all
open), and see each issue's state, milestone, labels, priority, assignees, and
linked pull-request status. Open the `Issues` tab in the right column and drag
an issue into the composer — or use the one-click handoff — to give the agent a
well-formed task prompt. A one-click handoff opens a new Session in the matching
Workspace; dragging from the right column stages into the current Session.

It is **read-only**: the plugin never writes to GitHub.

## What you get

| Surface | Where | What |
|---|---|---|
| GitHub panel | left rail icon → `main` panel | filter, list, detail (body, milestone progress, labels, priority, assignees, linked/mentioned PRs with checks and review state) |
| Handoff chip | above the composer (pending) and in the composer dock (linked) | the pending issue bar shows `org/repo#number` with open/remove; linked issues sit in the dock below with a detail popover |
| Issues right column | right sidebar tab | the same filtered issue list beside the Conversation; drag a row into the composer to hand it over |
| GitHub settings | Settings → GitHub | `gh` auth status and scopes, handoff behavior, prompt template |

## Requirements

- DSH Desktop with a Web GUI (developed against 0.2.1-rc.3).
- A `gh` CLI authenticated for the GitHub host you use:
  `gh auth login` (the token stays in the OS keychain).
- Projects v2 support additionally needs the `read:project` scope, once:
  `gh auth refresh -h github.com -s read:project`

  Without it the panel still works; the project picker explains what is missing.

## Install

```sh
# from a checkout (a linked install: edits need a rebuild + restart)
dsh plugin --profile desktop add /path/to/dsh-plugin-github-issues
```

Or install the same directory through Settings → Plugins → Add plugin, passing
the absolute path. Restart DSH and reload the page.

Uninstall:

```sh
dsh plugin --profile desktop remove dsh-plugin-github-issues
```

## Use

1. Click the GitHub icon in the left rail.
2. Pick **Assigned to me** / **Created by me** / **All open**, or a repository, or
   a project.
3. Click a row to read the issue beside the list; click `owner/repo#123` to open
   it on GitHub.
4. To hand it to the agent:
   - **Hand to agent** on the issue opens the Conversation with the prompt in the
     composer (review, then send).
   - **Drag** the row and drop it on the composer (native text drop) or on the
     strip under the composer.
   - The strip re-inserts the pinned issue any time: *Fill draft* or *Send now*.
5. Settings → GitHub: check auth and scopes, choose draft-vs-send handoff, edit the
   prompt template.

The prompt template supports `{{repo}}`, `{{number}}`, `{{title}}`, `{{url}}`,
`{{state}}`, `{{milestone}}`, `{{priority}}`, `{{assignees}}`, `{{labels}}`, and
`{{prs}}`.

## Privacy and tokens

- The GitHub token is read from `gh` on the Host process for each short session
  and never reaches the page, the plugin configuration, or any log.
- Issue data is fetched from GitHub by the Host process and forwarded to the
  browser as plain view models.
- Only UI preferences (selected repository/project, pinned issue, template) are
  stored, under `$DSH_HOME/github-issues/state.json`.

## Limits (v0.1)

- Read-only: no comments, label edits, assignment, or state changes.
- Projects v2 requires the `read:project` scope; the priority field falls back to
  organization issue fields and then to `P0`–`P4` labels.
- Lists poll every 60–120 s while visible; use Refresh for an immediate update.
- A docked right-sidebar tab is planned; drag currently targets the composer.

## Development

```sh
npm install
npm run typecheck     # whole repo, including the browser half
npm test              # node --test (queries, VM mapping, prompt, state)
npm run build         # Host half (tsc) + browser bundle (esbuild)
npm run verify:client # asserts the bundle's loader contract and slot entries
```

Architecture: a Host plugin reads the token and talks GraphQL; the browser half
mounts its own hand-written Typert Remote namespace (`ctx.remote.$mount`) and
calls it through `ctx.get('remote.githubIssues')`. The browser bundle imports
only React from the page's module table — no Harness client package — so a DSH
upgrade cannot break it through an internal component signature.

## License

MIT
