/**
 * Offline render smoke test.
 *
 * Renders the panel, the composer chips, and the settings section to a string
 * with `react-dom/server`. This catches render-time mistakes (bad hooks, missing
 * references, invalid props) without needing a browser, so a blank panel is
 * caught before it reaches the GUI.
 *
 *   node scripts/render-smoke.mjs   (bundles this file with esbuild and runs it)
 *
 * @module dsh-plugin-github-issues/scripts/render-smoke
 */

import { renderToString } from 'react-dom/server'

import { GitHubDock } from '../src/client/views/Dock.tsx'
import { GitHubIcon } from '../src/client/views/Icon.tsx'
import { GitHubDropZone } from '../src/client/views/DropZone.tsx'
import { GitHubPage } from '../src/client/views/Page.tsx'
import { GitHubPendingChip } from '../src/client/views/Pending.tsx'
import { GitHubSettings } from '../src/client/views/Settings.tsx'
import { GitHubSidebar } from '../src/client/views/Sidebar.tsx'
import type { PanelActions, PanelSnapshot } from '../src/client/viewmodel.ts'
import type { Translate } from '../src/client/context.ts'
import type { IssueCardVM, IssueDetailVM, Prefs } from '../src/vm.ts'

/** A translate function that names the keys it was asked for. */
const t: Translate = (key, vars) => (vars === undefined ? key : `${key}(${Object.values(vars).join(',')})`)

/** No-op panel actions; the smoke test only exercises rendering. */
const actions = new Proxy({} as PanelActions, {
  get: (_target, property) => (...args: unknown[]) => {
    void property
    void args
    return undefined
  },
})

/** A card with every field filled. */
function card(number = 2469): IssueCardVM {
  return {
    id: `I_${String(number)}`,
    repo: 'one2x-ai/mesh',
    number,
    title: 'CUJ 历史采样缺失与低流量静默阻断告警外发',
    url: `https://github.com/one2x-ai/mesh/issues/${String(number)}`,
    state: 'OPEN',
    stateReason: null,
    isPrivate: true,
    issueType: { name: 'Bug', color: 'RED' },
    labels: [{ name: 'P1', color: 'fbca04' }, { name: 'status/in-progress', color: '1d76db' }],
    milestone: { title: 'v2.1', dueOn: '2026-11-02', state: 'OPEN', progress: 82.6 },
    assignees: [{ login: 'ckanner', avatarUrl: 'https://avatars.githubusercontent.com/u/1?s=32' }],
    updatedAt: '2026-10-27T12:50:56Z',
    commentCount: 8,
    bodyExcerpt: '登录态在刷新后丢失',
    priority: { source: 'label', name: 'P1', color: 'fbca04' },
    projectStatus: { name: 'In progress', color: 'YELLOW' },
    linkedPRs: [{
      number: 2527,
      title: 'fix session restore',
      url: 'https://github.com/one2x-ai/mesh/pull/2527',
      state: 'MERGED',
      isDraft: false,
      merged: true,
      reviewDecision: 'APPROVED',
      checks: 'SUCCESS',
      author: 'alice',
    }],
    sessionLinks: [{ sessionId: 'session-1', at: Date.now() }],
  }
}

/** The detail view model. */
const detail: IssueDetailVM = { ...card(), body: '## 摘要\n\n- 出问题\n- 影响', mentionedPRs: [] }

/** The preferences a real install carries. */
const prefs: Prefs = {
  org: 'one2x-ai',
  projectId: 'PVT_1',
  repo: 'one2x-ai/mesh',
  assignee: '@me',
  state: 'open',
  handoffMode: 'draft',
  promptTemplate: '{{repo}}#{{number}}',
  pinned: { repo: 'one2x-ai/mesh', number: 2469 },
}

/** One panel snapshot. */
function snapshot(overrides: Partial<PanelSnapshot> = {}): PanelSnapshot {
  return {
    status: {
      mode: 'gh',
      ghInstalled: true,
      signedIn: true,
      login: 'ckanner',
      host: 'github.com',
      tokenSource: 'keyring',
      scopes: ['repo', 'read:project'],
      missingProjectScope: false,
      config: { authMode: 'gh', host: 'github.com', handoffMode: 'draft', pollSeconds: 90 },
    },
    catalog: {
      viewer: { login: 'ckanner' },
      orgs: [{ login: 'one2x-ai' }, { login: 'b3log' }],
      repos: [{ nameWithOwner: 'ckanner/dsh-plugin-github-issues', isPrivate: false, isFork: false }],
      projectsBlocked: false,
    },
    orgProjects: [{ id: 'PVT_1', number: 3, title: 'mce', url: 'https://github.com/orgs/one2x-ai/projects/3', owner: 'one2x-ai' }],
    orgRepos: {
      items: [{ nameWithOwner: 'one2x-ai/mesh', isPrivate: true, isFork: false }],
      totalCount: 331,
      hasNextPage: false,
      endCursor: null,
    },
    list: {
      items: [card(2469), card(2530)],
      totalCount: 25,
      pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
      rateLimit: { cost: 1, remaining: 4999 },
    },
    loading: false,
    loadingMore: false,
    scopeLoading: false,
    prefs,
    detailLoading: false,
    projectsBlocked: false,
    milestoneOptions: [
      { title: 'v2.1', number: 1 },
      { title: 'KAIROS 正式商用前 APPI 合规', number: 2 },
    ],
    links: [{ repo: 'one2x-ai/mesh', number: 2469, sessionId: 'session-1', at: Date.now() }],
    linkCards: { 'one2x-ai/mesh#2469': card() },
    toast: 'panel.toast.copied',
    ...overrides,
  }
}

/** Resolve one session for the views. */
function resolveSession(sessionId: string) {
  return {
    sessionId,
    title: '处理 mesh 告警',
    workspaceTitle: 'mesh',
    available: true,
    at: Date.now(),
  }
}

/** Render one element and assert it produced markup (or an explicit empty render). */
function expectMarkup(name: string, element: React.ReactElement, allowEmpty = false): void {
  const html = renderToString(element)
  if (html.length < 40 && !allowEmpty) throw new Error(`${name}: rendered only ${String(html.length)} characters`)
  if (allowEmpty && html.length !== 0) throw new Error(`${name}: expected an empty render, got ${String(html.length)} characters`)
  console.log(`ok ${name} (${String(html.length)} chars)`)
}

expectMarkup('page: initial snapshot (no catalog, loading)', (
  <GitHubPage
    snapshot={{
      loading: true,
      loadingMore: false,
      scopeLoading: false,
      detailLoading: false,
      prefs: {
        org: undefined,
        projectId: undefined,
        repo: undefined,
        assignee: '@me',
        state: 'open',
        handoffMode: 'draft',
        promptTemplate: '{{repo}}',
        pinned: undefined,
      },
      projectsBlocked: false,
      links: [],
      linkCards: {},
    }}
    actions={actions}
    t={t}
    resolveSession={resolveSession}
  />
))
expectMarkup('page: list', <GitHubPage snapshot={snapshot()} actions={actions} t={t} resolveSession={resolveSession} />)
expectMarkup('page: detail', (
  <GitHubPage
    snapshot={snapshot({ selected: card(), detail })}
    actions={actions}
    t={t}
    resolveSession={resolveSession}
  />
))
expectMarkup('page: empty', (
  <GitHubPage
    snapshot={snapshot({ list: { items: [], totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null } } })}
    actions={actions}
    t={t}
    resolveSession={resolveSession}
  />
))
expectMarkup('page: projects blocked', (
  <GitHubPage
    snapshot={snapshot({ projectsBlocked: true, orgProjects: [], projectsError: 'needs read:project' })}
    actions={actions}
    t={t}
    resolveSession={resolveSession}
  />
))
expectMarkup('dock: linked chips', (
  <GitHubDock
    t={t}
    chips={[
      { card: card(2530), state: 'linked', sessions: [resolveSession('session-1')] },
      { card: { ...card(2579), title: '' }, state: 'degraded', sessions: [] },
    ]}
    onRemoveChip={() => {}}
    onOpenChip={() => {}}
  />
))
expectMarkup('dock: no chips (renders nothing)', (
  <GitHubDock
    snapshot={snapshot()}
    actions={actions}
    t={t}
    resolveSession={resolveSession}
    composerReady
    onInsert={() => {}}
    onSend={() => {}}
    onDropIssue={() => {}}
    onDropText={() => {}}
    chips={[]}
    onRemoveChip={() => {}}
    onOpenChip={() => {}}
  />
), true)
expectMarkup('sidebar: list', <GitHubSidebar snapshot={snapshot()} actions={actions} t={t} />)
expectMarkup('sidebar: loading', (
  <GitHubSidebar snapshot={snapshot({ list: undefined, loading: true })} actions={actions} t={t} />
))
expectMarkup('sidebar: dragging row', (
  <GitHubSidebar snapshot={snapshot({ dragging: card() })} actions={actions} t={t} />
))
expectMarkup('drop zone: hidden', <GitHubDropZone dragging={undefined} t={t} onDrop={() => {}} onCancel={() => {}} />, true)
expectMarkup('drop zone: visible', (
  <GitHubDropZone dragging={card()} t={t} onDrop={() => {}} onCancel={() => {}} />
))
expectMarkup('settings', <GitHubSettings snapshot={snapshot()} actions={actions} t={t} resolveSession={resolveSession} />)
expectMarkup('icon', <GitHubIcon size={16} active />)
const linked = renderToString(
  <GitHubDock
    t={t}
    chips={[{ card: card(), state: 'linked', sessions: [resolveSession('session-1')] }]}
    onRemoveChip={() => {}}
    onOpenChip={() => {}}
  />,
)
if (!linked.includes('one2x-ai/mesh#2469')) {
  throw new Error('the linked chip must show the organization/repository and number')
}
console.log('ok chip label (organization/repository#number)')
console.log('render smoke passed')
