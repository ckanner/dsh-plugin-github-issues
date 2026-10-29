/**
 * The panel's state owner.
 *
 * One store is shared by the full-page panel, the composer dock, and the settings
 * page: they show the same issue, the same prefs, and the same error. The store
 * owns every call into the Host Remote namespace and every poll timer, so the
 * renderers stay pure and the data flow is reviewable in one file.
 *
 * The list is one cascade: organization → (project | repository) → assignee →
 * state. `Prefs` is the single source of truth for that cascade, so the same
 * filter comes back after a restart and the pickers survive navigation.
 *
 * @module dsh-plugin-github-issues/client/store
 */

import { renderPrompt } from '../prompt.ts'
import { REMOTE_NAMESPACE } from '../remote-methods.ts'
import {
  DEFAULT_PREFS, type GitHubStatus, type IssueBodyVM, type IssueCardVM, type IssueDetailVM,
  type IssueLinkRecord, type IssueListPage, type IssueListRequest, type LinkedCardsRequest,
  type Prefs, type PrefsPatch, type RepoMilestoneVM, type RepoPageVM, type ScopeCatalog,
} from '../vm.ts'
import type {
  ClientContext, ClientRuntime, SnapshotSource, UiSessionService, WorkspaceEntrySnapshot,
  WorkspacesSnapshot,
} from './context.ts'
import { RemoteRefusal, unwrap, type RemoteResult } from './result.ts'
import type { PanelActions, PanelError, PanelSnapshot } from './viewmodel.ts'
import { resolveHandoffWorkspace, type WorkspaceCandidate } from '../workspace.ts'

/** How long the store waits for its own Remote namespace before giving up. */
const REMOTE_WAIT_MS = 15_000

/** How often the wait checks for the namespace. */
const REMOTE_POLL_MS = 250

/** The Cordis service key the Gateway publishes this plugin's namespace under. */
const REMOTE_KEY = `remote.${REMOTE_NAMESPACE}`

/** The right-sidebar page kind this plugin owns. */
const SIDEBAR_KIND = 'github-issues'

/** How long a confirmation stays on screen. */
const TOAST_MS = 2_500

/** The Remote surface as the Gateway actually resolves it. */
interface RemoteApi {
  status(): Promise<RemoteResult<GitHubStatus>>
  catalog(): Promise<RemoteResult<ScopeCatalog>>
  orgRepos(org: string): Promise<RemoteResult<RepoPageVM>>
  listIssues(request: IssueListRequest): Promise<RemoteResult<IssueListPage>>
  repoMilestones(repo: string): Promise<RemoteResult<{ milestones: RepoMilestoneVM[] }>>
  linkedCards(groups: readonly LinkedCardsRequest[]): Promise<RemoteResult<IssueCardVM[]>>
  issueDetail(repo: string, number: number): Promise<RemoteResult<IssueBodyVM>>
  issueMentionedPRs(repo: string, number: number): Promise<RemoteResult<{ mentionedPRs: IssueDetailVM['mentionedPRs'] }>>
  loadPrefs(): Promise<RemoteResult<Prefs>>
  savePrefs(patch: PrefsPatch): Promise<RemoteResult<Prefs>>
  refresh(): Promise<RemoteResult<{ ok: true }>>
  links(): Promise<RemoteResult<IssueLinkRecord[]>>
  linkIssue(repo: string, number: number, sessionId: string): Promise<RemoteResult<IssueLinkRecord[]>>
  unlinkIssue(repo: string, number: number, sessionId?: string): Promise<RemoteResult<IssueLinkRecord[]>>
}

/** One organization's lazily loaded repository page. */
interface OrgScope {
  repos: RepoPageVM
}

/** One uniform error for the panel. */
function asPanelError(error: unknown): PanelError {
  if (error instanceof RemoteRefusal) {
    return { message: error.message, ...error.code === undefined ? {} : { code: error.code } }
  }
  return { message: error instanceof Error ? error.message : String(error) }
}

/**
 * Apply a preference patch locally, mirroring the Host's `null` clearing rule.
 *
 * Optimistic so a select changes and its list request start together: the Host
 * persists in parallel, and the returned (validated) preferences replace these.
 * @param current - the preferences currently rendered.
 * @param patch - the patch about to be sent.
 * @returns the preferences after the patch.
 */
function applyPrefsPatchLocally(current: Prefs, patch: PrefsPatch): Prefs {
  const next: Prefs = { ...current }
  if ('org' in patch) next.org = patch.org ?? undefined
  if ('projectId' in patch) next.projectId = patch.projectId ?? undefined
  if ('repo' in patch) next.repo = patch.repo ?? undefined
  if ('milestone' in patch) next.milestone = patch.milestone ?? undefined
  if ('assignee' in patch && patch.assignee !== null) next.assignee = patch.assignee
  if ('state' in patch && patch.state !== null) next.state = patch.state
  if ('handoffMode' in patch && patch.handoffMode !== null) next.handoffMode = patch.handoffMode
  if ('promptTemplate' in patch && patch.promptTemplate !== null) next.promptTemplate = patch.promptTemplate
  if ('pinned' in patch) next.pinned = patch.pinned ?? undefined
  return next
}

/** Read the namespace once it is published, waiting for the async mount to settle. */
async function waitForRemote(ctx: ClientContext): Promise<RemoteApi> {
  const deadline = Date.now() + REMOTE_WAIT_MS
  for (;;) {
    const namespace = ctx.get(REMOTE_KEY) as RemoteApi | undefined
    if (typeof namespace?.listIssues === 'function') return namespace
    if (Date.now() >= deadline) {
      throw new Error('the GitHub service is not reachable from this window; reload the window and try again')
    }
    await new Promise<void>(resolve => { setTimeout(resolve, REMOTE_POLL_MS) })
  }
}

/** The browser half's single source of panel state. */
export class GitHubStore implements PanelActions {
  private snapshot: PanelSnapshot = {
    loading: false,
    loadingMore: false,
    scopeLoading: false,
    detailLoading: false,
    prefs: DEFAULT_PREFS,
    projectsBlocked: false,
    milestoneOptions: [],
    links: [],
    linkCards: {},
  }

  private readonly listeners = new Set<() => void>()
  private readonly orgScopes = new Map<string, OrgScope>()
  private remote: RemoteApi | undefined
  private started = false
  private readonly onWindowFocus = (): void => {
    void this.refreshLinkedCards()
  }
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private toastTimer: ReturnType<typeof setTimeout> | undefined
  private listSeq = 0

  /**
   * @param ctx - the browser plugin context.
   * @param mounting - settles when the hand-written Remote namespace is mounted.
   */
  constructor(
    private readonly ctx: ClientContext,
    private readonly runtime: ClientRuntime,
    private readonly mounting: Promise<string | undefined>,
  ) {
    void mounting.then(() => undefined)
  }

  /** Subscribe one renderer to state changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** The current immutable snapshot. */
  getSnapshot = (): PanelSnapshot => this.snapshot

  /** Start loading and polling. Idempotent. */
  start(): void {
    if (this.started) return
    this.started = true
    // The composer dock's dot must follow an issue closed in another tab: refresh
    // the linked cards when the window regains focus, not only on the poll timer.
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', this.onWindowFocus)
    }
    void this.bootstrap()
  }

  /** Stop every timer this store owns. */
  stop(): void {
    this.started = false
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('focus', this.onWindowFocus)
    }
    if (this.pollTimer !== undefined) clearInterval(this.pollTimer)
    if (this.toastTimer !== undefined) clearTimeout(this.toastTimer)
    this.pollTimer = undefined
    this.toastTimer = undefined
  }

  /** Load prefs, auth facts, the catalog, the saved scope, and the first page. */
  private async bootstrap(): Promise<void> {
    this.update({ loading: true, error: undefined })
    try {
      const remote = await this.api()
      const catalogLoading = this.loadCatalog()
      const [status, prefs] = await Promise.all([
        remote.status().then(result => unwrap(result)),
        remote.loadPrefs().then(result => unwrap(result)),
      ])
      // The panel is repository-scoped now: Projects v2 is gone, so a stale
      // project id is dropped and the organization/repository are chosen for the
      // user before the first page is requested.
      this.update({
        status,
        prefs: { ...prefs, projectId: undefined },
        projectsBlocked: status.missingProjectScope,
        loading: false,
      })
      if (prefs.projectId !== undefined) void this.savePrefs({ projectId: null })
      void this.loadLinks()
      await catalogLoading
      await this.ensureScopeSelection()
      await this.reloadList()
      this.schedulePolling(status.config.pollSeconds)
      void this.hydratePinned()
    } catch (error) {
      this.update({ loading: false, error: asPanelError(error) })
    }
  }

  /** Poll only while the page is visible, at the configured cadence. */
  private schedulePolling(configuredSeconds: number): void {
    const seconds = Number.isFinite(configuredSeconds) ? Math.min(Math.max(configuredSeconds, 30), 600) : 90
    if (this.pollTimer !== undefined) clearInterval(this.pollTimer)
    this.pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (this.snapshot.loading || this.snapshot.loadingMore) return
      void this.reloadList(true)
      void this.refreshLinkedCards()
    }, seconds * 1_000)
  }

  /** Resolve the Remote namespace, or throw the mount's own refusal. */
  private async api(): Promise<RemoteApi> {
    if (this.remote !== undefined) return this.remote
    const refused = await this.mounting
    if (refused !== undefined) throw new Error(`the GitHub service could not be mounted: ${refused}`)
    this.remote = await waitForRemote(this.ctx)
    return this.remote
  }

  /** Merge one snapshot patch and notify renderers. */
  private update(patch: Partial<PanelSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  /** Show one transient confirmation. */
  private toast(text: string): void {
    this.update({ toast: text })
    if (this.toastTimer !== undefined) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => { this.update({ toast: undefined }) }, TOAST_MS)
  }

  /** Build the list request the current cascade describes. */
  private request(after: string | null): IssueListRequest {
    const prefs = this.snapshot.prefs
    const request: IssueListRequest = {
      state: prefs.state,
      assignee: prefs.assignee,
      first: 30,
      after,
    }
    if (prefs.org !== undefined) request.org = prefs.org
    if (prefs.repo !== undefined) request.repos = [prefs.repo]
    if (prefs.milestone !== undefined) {
      request.milestone = prefs.milestone
      const option = this.snapshot.milestoneOptions.find(item => item.title === prefs.milestone)
      if (option !== undefined) request.milestoneNumber = option.number
    }
    return request
  }

  /** Fetch the first page of the current cascade. */
  private async reloadList(quiet = false): Promise<void> {
    const seq = ++this.listSeq
    if (this.snapshot.prefs.repo === undefined) {
      this.update({ list: undefined, loading: false, loadingMore: false })
      return
    }
    if (!quiet) this.update({ loading: true, error: undefined })
    try {
      const remote = await this.api()
      const page = await remote.listIssues(this.request(null)).then(result => unwrap(result))
      if (seq !== this.listSeq) return
      this.update({
        list: page,
        loading: false,
        loadingMore: false,
        error: undefined,
      })
      this.syncLinkedCardsFromList()
      this.refreshPinnedCard()
    } catch (error) {
      if (seq !== this.listSeq) return
      this.update({ loading: false, loadingMore: false, error: asPanelError(error) })
    }
  }

  /** Load the viewer/organization catalog once. */
  async loadCatalog(): Promise<void> {
    if (this.snapshot.catalog !== undefined) return
    try {
      const remote = await this.api()
      const catalog = await remote.catalog().then(result => unwrap(result))
      this.update({ catalog })
    } catch (error) {
      this.update({ error: asPanelError(error) })
    }
  }

  /** Load one organization's repositories, once per session. */
  private async loadOrgScope(org: string): Promise<void> {
    const cached = this.orgScopes.get(org)
    if (cached !== undefined) {
      this.update({ orgRepos: cached.repos, scopeLoading: false })
      return
    }
    this.update({ scopeLoading: true })
    try {
      const remote = await this.api()
      const repos = await remote.orgRepos(org).then(result => unwrap(result))
      this.orgScopes.set(org, { repos })
      this.update({ orgRepos: repos, scopeLoading: false })
    } catch (error) {
      this.update({ scopeLoading: false, error: asPanelError(error) })
    }
  }

  /**
   * Choose an organization when none is restored (or the saved one vanished).
   * @returns completion once its repository page is loaded.
   */
  private async ensureOrgSelection(): Promise<void> {
    const orgs = this.snapshot.catalog?.orgs ?? []
    if (orgs.length === 0) return
    const current = this.snapshot.prefs.org
    const chosen = current !== undefined && orgs.some(org => org.login === current)
      ? current
      : orgs[0]?.login
    if (chosen === undefined) return
    if (chosen !== current) {
      this.resetMilestoneOptions()
      this.update({
        prefs: { ...this.snapshot.prefs, org: chosen, repo: undefined, milestone: undefined, projectId: undefined },
        orgRepos: undefined,
      })
      await this.persistPrefs({ org: chosen, projectId: null, repo: null, milestone: null })
    }
    await this.loadOrgScope(chosen)
    await this.ensureRepoSelection()
  }

  /**
   * Choose a repository when none is restored (or it does not belong to the
   * organization). The repository picker has no "all repositories" state.
   * @returns completion once the milestone list is loaded.
   */
  private async ensureRepoSelection(): Promise<void> {
    const repos = this.snapshot.orgRepos?.items ?? []
    if (repos.length === 0) return
    const current = this.snapshot.prefs.repo
    const valid = current !== undefined && repos.some(repo => repo.nameWithOwner === current)
    const chosen = valid ? current : repos[0]?.nameWithOwner
    if (chosen === undefined) return
    if (chosen !== current) {
      this.resetMilestoneOptions()
      this.update({ prefs: { ...this.snapshot.prefs, repo: chosen, milestone: undefined } })
      await this.persistPrefs({ repo: chosen, milestone: null })
    }
    await this.loadRepoMilestones(chosen)
    await this.pruneMilestone(chosen)
  }

  /** The default scope selection used by bootstrap. */
  private async ensureScopeSelection(): Promise<void> {
    await this.ensureOrgSelection()
  }

  /** Keep the dock's copy of the pinned issue in sync with the loaded list. */
  private refreshPinnedCard(): void {
    const pinned = this.snapshot.prefs.pinned
    if (pinned === undefined) {
      if (this.snapshot.pinnedCard !== undefined) this.update({ pinnedCard: undefined })
      return
    }
    const found = this.snapshot.list?.items.find(item => item.repo === pinned.repo && item.number === pinned.number)
    if (found !== undefined && this.snapshot.pinnedCard?.id !== found.id) this.update({ pinnedCard: found })
  }

  /** A card for one issue from the loaded list, or a minimal placeholder. */
  private cardFor(repo: string, number: number): IssueCardVM {
    const found = this.snapshot.list?.items.find(item => item.repo === repo && item.number === number)
    if (found !== undefined) return found
    return {
      id: `${repo}#${String(number)}`,
      repo,
      number,
      title: '',
      url: `https://github.com/${repo}/issues/${String(number)}`,
      state: 'OPEN',
      stateReason: null,
      isPrivate: false,
      labels: [],
      assignees: [],
      updatedAt: '',
      commentCount: 0,
      linkedPRs: [],
      sessionLinks: [],
    }
  }

  /** The pinned issue's card, when the loaded list carries it. */
  private async hydratePinned(): Promise<void> {
    const pinned = this.snapshot.prefs.pinned
    if (pinned === undefined || this.snapshot.pinnedCard !== undefined) return
    const found = this.snapshot.list?.items.find(item => item.repo === pinned.repo && item.number === pinned.number)
    if (found !== undefined) this.update({ pinnedCard: found })
  }

  // ── PanelActions ────────────────────────────────────────────────────────────

  refresh(): void {
    void (async () => {
      try {
        const remote = await this.api()
        await remote.refresh()
        const status = await remote.status().then(result => unwrap(result))
        this.orgScopes.clear()
        this.resetMilestoneOptions()
        this.update({
          status,
          catalog: undefined,
          orgRepos: undefined,
          projectsBlocked: false,
          projectsError: undefined,
        })
      } catch (error) {
        this.update({ error: asPanelError(error) })
        return
      }
      await this.loadCatalog()
      await this.ensureScopeSelection()
      await this.reloadList()
      void this.refreshLinkedCards()
    })()
  }

  loadMore(): void {
    const page = this.snapshot.list
    if (page === undefined || !page.pageInfo.hasNextPage || this.snapshot.loadingMore) return
    this.update({ loadingMore: true })
    void (async () => {
      try {
        const remote = await this.api()
        const next = await remote.listIssues(this.request(page.pageInfo.endCursor)).then(result => unwrap(result))
        this.update({
          loadingMore: false,
          list: {
            ...page,
            items: [...page.items, ...next.items.filter(item => !page.items.some(existing => existing.id === item.id))],
            pageInfo: next.pageInfo,
            ...next.totalCount === undefined ? {} : { totalCount: next.totalCount },
          },
        })
        this.syncLinkedCardsFromList()
      } catch (error) {
        this.update({ loadingMore: false, error: asPanelError(error) })
      }
    })()
  }

  setOrg(org: string): void {
    if (org === this.snapshot.prefs.org) return
    this.resetMilestoneOptions()
    // A new organization invalidates the repository and milestone chosen inside
    // the previous one. `null` clears over the wire.
    void this.savePrefs({ org, projectId: null, repo: null, milestone: null }, async saved => {
      this.update({ orgRepos: undefined })
      if (saved.org !== undefined) {
        await this.loadOrgScope(saved.org)
        await this.ensureRepoSelection()
        await this.reloadList()
      }
    })
  }

  setRepo(repo: string): void {
    if (repo === this.snapshot.prefs.repo) return
    // A milestone belongs to a repository, so a repository change clears it.
    this.resetMilestoneOptions()
    void this.savePrefs({ repo, milestone: null }, async saved => {
      if (saved.repo !== undefined) {
        await this.loadRepoMilestones(saved.repo)
        await this.pruneMilestone(saved.repo)
      }
    })
  }

  setMilestone(milestone: string | undefined): void {
    void this.savePrefs({ milestone: milestone ?? null })
  }

  /** Clear the milestone picker's options for a new scope. */
  private resetMilestoneOptions(): void {
    if (this.snapshot.milestoneOptions.length !== 0) this.update({ milestoneOptions: [] })
  }

  /** Drop a milestone that the selected repository no longer lists. */
  private async pruneMilestone(repo: string): Promise<void> {
    const selected = this.snapshot.prefs.milestone
    if (selected === undefined || this.snapshot.prefs.repo !== repo) return
    const options = this.snapshot.milestoneOptions
    if (options.length === 0) return
    if (options.some(option => option.title === selected)) return
    await this.savePrefs({ milestone: null })
  }

  /** Seed the picker from the selected repository's full milestone list. */
  private async loadRepoMilestones(repo: string): Promise<void> {
    try {
      const remote = await this.api()
      const result = await remote.repoMilestones(repo).then(response => unwrap(response))
      if (this.snapshot.prefs.repo !== repo) return
      const options = [...this.snapshot.milestoneOptions]
      const seen = new Set(options.map(option => option.title))
      for (const option of result.milestones) {
        if (option.title === '' || seen.has(option.title)) continue
        seen.add(option.title)
        options.push(option)
      }
      this.update({ milestoneOptions: options })
    } catch {
      // A missing milestone list only narrows the picker's suggestions.
    }
  }

  setAssignee(assignee: string): void {
    void this.savePrefs({ assignee })
  }

  setStateFilter(state: Prefs['state']): void {
    void this.savePrefs({ state })
  }

  selectIssue(card: IssueCardVM): void {
    this.update({ selected: card, detail: undefined, detailLoading: true, mentionedLoading: false })
    void (async () => {
      try {
        const remote = await this.api()
        // The body and the timeline are independent GitHub reads; start both so
        // the pane shows as soon as the body arrives instead of waiting for one
        // then the other.
        const bodyLoading = remote.issueDetail(card.repo, card.number).then(result => unwrap(result))
        const mentionedLoading = remote.issueMentionedPRs(card.repo, card.number)
          .then(result => unwrap(result))
          .then(result => result.mentionedPRs, () => [])
        const body = await bodyLoading
        this.update({
          detail: { ...card, body: body.body, mentionedPRs: [] },
          detailLoading: false,
          mentionedLoading: true,
        })
        const mentioned = await mentionedLoading
        const current = this.snapshot.detail
        if (current === undefined || current.repo !== card.repo || current.number !== card.number) return
        const closing = new Set(current.linkedPRs.map(pr => pr.number))
        this.update({
          detail: { ...current, mentionedPRs: mentioned.filter(pr => !closing.has(pr.number)) },
          mentionedLoading: false,
        })
      } catch (error) {
        this.update({ detailLoading: false, mentionedLoading: false, error: asPanelError(error) })
      }
    })()
  }

  closeDetail(): void {
    this.update({ selected: undefined, detail: undefined, detailLoading: false, mentionedLoading: false })
  }

  async savePrefs(
    patch: PrefsPatch,
    after?: (saved: Prefs) => Promise<void> | void,
  ): Promise<void> {
    const previous = this.snapshot.prefs
    const affectsList = ['org', 'repo', 'assignee', 'state', 'milestone'].some(key => key in patch)
    // Optimistic update: the list request carries the filters explicitly, so it
    // can start while the Host persists the same patch. One round trip, not two.
    this.update({ prefs: applyPrefsPatchLocally(previous, patch) })
    let saveError: unknown
    try {
      const remote = await this.api()
      const save = remote.savePrefs(patch).then(result => unwrap(result))
      const reload = affectsList ? this.reloadList() : Promise.resolve()
      const [saved] = await Promise.all([save, reload])
      this.update({ prefs: saved })
      if (affectsList) this.refreshPinnedCard()
      else if ('handoffMode' in patch || 'promptTemplate' in patch) this.toast('settings.saved')
      if (after !== undefined) await after(saved)
    } catch (error) {
      saveError = error
      this.update({ prefs: previous, error: asPanelError(error) })
    }
    void saveError
  }

  /**
   * Persist a preference patch without touching the list.
   *
   * Scope normalization (picking the default organization/repository) uses this
   * so bootstrapping issues exactly one list request instead of one per default.
   * @param patch - validated preference patch.
   * @returns the saved preferences, or `undefined` when persistence failed.
   */
  private async persistPrefs(patch: PrefsPatch): Promise<Prefs | undefined> {
    try {
      const remote = await this.api()
      const saved = await remote.savePrefs(patch).then(result => unwrap(result))
      this.update({ prefs: saved })
      return saved
    } catch (error) {
      this.update({ error: asPanelError(error) })
      return undefined
    }
  }

  pin(card: IssueCardVM): void {
    this.update({ pinnedCard: card })
    this.toast('panel.toast.pinned')
    void this.savePrefs({ pinned: { repo: card.repo, number: card.number } })
  }

  unpin(): void {
    this.update({ pinnedCard: undefined, pendingHandoff: undefined })
    void this.savePrefs({ pinned: null })
  }

  /** Start a drag from the right-sidebar list; the composer shows the target. */
  dragIssue(card: IssueCardVM): void {
    this.update({ dragging: card })
  }

  /** End a drag without a handoff. */
  endDrag(): void {
    if (this.snapshot.dragging !== undefined) this.update({ dragging: undefined })
  }

  /**
   * Drop the dragged issue on the composer of the Session it was dragged into:
   * the dock that mounts with this Session consumes the pending handoff and
   * writes the prompt. No new Session is created for a drag.
   */
  dropHandoff(sessionId?: string): void {
    const card = this.snapshot.dragging
    this.update({
      dragging: undefined,
      ...card === undefined
        ? {}
        : {
            pendingHandoff: card,
            ...sessionId === undefined ? {} : { pendingHandoffSession: sessionId },
          },
    })
  }

  /** Open the co-visible right-sidebar tab for the on-screen Session. */
  openInSidebar(): void {
    this.service<{ selectPanel(id: string | null): void }>('layout')?.selectPanel(null)
    // The column names its on-screen Session from the panel selection, so let
    // that selection land before asking the page to open.
    setTimeout(() => {
      this.service<{ openTab(kind: string): void }>('sidebarRight')?.openTab(SIDEBAR_KIND)
    }, 80)
  }

  /** The Workspace a new handoff Session should open in, per the agreed priority. */
  private workspaceForHandoff(repo: string): string | undefined {
    const workspaces = (this.runtime.getService('workspaces') as
      | { list?: SnapshotSource<WorkspacesSnapshot> }
      | undefined)?.list?.getSnapshot()
    const items: WorkspaceCandidate[] = []
    for (const item of workspaces?.items ?? []) {
      const entry = item as WorkspaceEntrySnapshot
      if (entry.workspaceId === undefined) continue
      items.push({
        workspaceId: entry.workspaceId,
        ...entry.path === undefined ? {} : { path: entry.path },
        ...entry.title === undefined || entry.title === null ? {} : { title: entry.title },
        sessionIds: item.sessionIds ?? [],
      })
    }
    const currentSessionId = (this.runtime.getService('uiSession') as UiSessionService | undefined)
      ?.adapter?.current?.getSnapshot()?.key
    const linkedSessionIds = this.snapshot.links
      .filter(link => link.repo === repo)
      .map(link => link.sessionId)
    return resolveHandoffWorkspace({
      repo,
      ...currentSessionId === undefined ? {} : { currentSessionId },
      linkedSessionIds,
      workspaces: items,
    })
  }

  handoff(card: IssueCardVM): void {
    this.pin(card)
    type Ui = {
      startSession(workspaceId?: string, options?: {
        prompt?: string
        whenDraftExists?: 'keep' | 'replace' | 'append'
        clearPreviousDraft?: boolean
      }): void
      connectWorkspace(workspaceId?: string): Promise<string>
    }
    const uiWorkspace = this.service<Ui>('uiWorkspace')
    if (uiWorkspace === undefined) {
      // A composition without the workspace service: hand to the on-screen Session.
      this.update({ pendingHandoff: card, pendingHandoffSession: undefined })
      this.service<{ selectPanel(id: string | null): void }>('layout')?.selectPanel(null)
      return
    }
    // A handoff gets its own Session so the issue's work does not take over the
    // conversation on screen. Resolve the blank Session first so the pending
    // chip can be stamped with its id; only that Session's composer consumes it.
    const workspaceId = this.workspaceForHandoff(card.repo)
    const prompt = this.promptFor(card)
    void (async () => {
      try {
        const sessionId = await uiWorkspace.connectWorkspace(workspaceId)
        this.update({ pendingHandoff: card, pendingHandoffSession: sessionId })
        uiWorkspace.startSession(workspaceId, { prompt, whenDraftExists: 'replace' })
      } catch (error) {
        this.update({ error: asPanelError(error) })
      }
    })()
  }

  copyPrompt(card: IssueCardVM): void {
    this.copyText(renderPrompt(card, this.snapshot.prefs.promptTemplate))
    this.toast('panel.toast.promptCopied')
  }

  /** The prompt text this profile hands to the agent for one issue. */
  promptText(card: IssueCardVM): string {
    return renderPrompt(card, this.snapshot.prefs.promptTemplate)
  }

  copyText(text: string): void {
    try {
      void navigator.clipboard?.writeText(text)
    } catch {
      // Clipboard permissions are the browser's business; nothing to clean up.
    }
    this.toast('panel.toast.copied')
  }

  clearToast(): void {
    if (this.toastTimer !== undefined) clearTimeout(this.toastTimer)
    this.toastTimer = undefined
    this.update({ toast: undefined })
  }

  /** The issue key used by the link map. */
  private keyOf(repo: string, number: number): string {
    return `${repo}#${String(number)}`
  }

  /** Load every recorded link and resolve the linked issues to cards. */
  async loadLinks(): Promise<void> {
    try {
      const remote = await this.api()
      const links = await remote.links().then(result => unwrap(result))
      this.update({ links })
      this.decorateLoadedCards(links)
      this.ensureCards(links)
      void this.refreshLinkedCards()
    } catch {
      // The dock simply shows no chips when links cannot be read.
    }
  }

  /** Fetch the cards of linked issues that are not in the current list yet. */
  async ensureCards(links: readonly IssueLinkRecord[]): Promise<void> {
    const missing = new Map<string, { repo: string; number: number }>()
    for (const link of links) {
      const key = this.keyOf(link.repo, link.number)
      if (this.snapshot.linkCards[key] !== undefined) continue
      missing.set(key, { repo: link.repo, number: link.number })
    }
    if (missing.size === 0) return
    const cards: Record<string, IssueCardVM> = {}
    for (const [key, target] of missing.entries()) cards[key] = this.cardFor(target.repo, target.number)
    if (Object.keys(cards).length === 0) return
    this.update({ linkCards: { ...this.snapshot.linkCards, ...cards } })
  }

  /** Update linked chips whose issues are present in the freshly loaded list. */
  private syncLinkedCardsFromList(): void {
    const items = this.snapshot.list?.items
    if (items === undefined || items.length === 0) return
    const byKey = new Map(items.map(item => [this.keyOf(item.repo, item.number), item]))
    let changed = false
    const next = { ...this.snapshot.linkCards }
    for (const link of this.snapshot.links) {
      const key = this.keyOf(link.repo, link.number)
      const card = byKey.get(key)
      if (card === undefined || next[key] === card) continue
      next[key] = this.withSessionLinks(card)
      changed = true
    }
    if (changed) this.update({ linkCards: next })
  }

  /** Add the recorded session links to one card. */
  private withSessionLinks<T extends IssueCardVM>(card: T): T {
    const records = this.snapshot.links.filter(link => link.repo === card.repo && link.number === card.number)
    if (records.length === 0) return card
    return {
      ...card,
      sessionLinks: records.map(record => ({ sessionId: record.sessionId, at: record.at })),
    }
  }

  /**
   * Refresh the dock chips from GitHub.
   *
   * A linked issue can be closed long after the handoff and no longer match the
   * panel's filters, so its card is not in the list; without this the chip's state
   * dot would stay green forever.
   */
  async refreshLinkedCards(): Promise<void> {
    const links = this.snapshot.links
    if (links.length === 0) return
    const grouped = new Map<string, number[]>()
    for (const link of links) {
      const numbers = grouped.get(link.repo) ?? []
      if (!numbers.includes(link.number)) numbers.push(link.number)
      grouped.set(link.repo, numbers)
    }
    const groups: LinkedCardsRequest[] = [...grouped.entries()].map(([repo, numbers]) => ({ repo, numbers }))
    try {
      const remote = await this.api()
      const cards = await remote.linkedCards(groups).then(result => unwrap(result))
      if (cards.length === 0) return
      const next = { ...this.snapshot.linkCards }
      let changed = false
      for (const card of cards) {
        const key = this.keyOf(card.repo, card.number)
        const current = next[key]
        next[key] = this.withSessionLinks(card)
        if (current === undefined || current.state !== card.state || current.stateReason !== card.stateReason || current.title !== card.title) {
          changed = true
        }
      }
      if (changed || Object.keys(this.snapshot.linkCards).length !== Object.keys(next).length) {
        this.update({ linkCards: next })
      }
    } catch {
      // A stale chip is better than an error banner in the composer.
    }
  }

  /** Attach resolved session links to every card the snapshot currently holds. */
  private decorateLoadedCards(links: readonly IssueLinkRecord[]): void {
    const byKey = new Map<string, IssueLinkRecord[]>()
    for (const link of links) {
      const key = this.keyOf(link.repo, link.number)
      byKey.set(key, [...byKey.get(key) ?? [], link])
    }
    const decorate = <T extends IssueCardVM>(card: T): T => {
      const records = byKey.get(this.keyOf(card.repo, card.number))
      if (records === undefined) return card
      return {
        ...card,
        sessionLinks: records.map(record => ({ sessionId: record.sessionId, at: record.at })),
      }
    }
    const list = this.snapshot.list
    this.update({
      ...list === undefined ? {} : {
        list: { ...list, items: list.items.map(card => decorate(card)) },
      },
      ...this.snapshot.selected === undefined ? {} : { selected: decorate(this.snapshot.selected) },
      ...this.snapshot.detail === undefined ? {} : { detail: decorate(this.snapshot.detail) },
      ...this.snapshot.pinnedCard === undefined ? {} : { pinnedCard: decorate(this.snapshot.pinnedCard) },
    })
  }

  /** Record that a session received this issue (send confirmed). */
  async linkIssue(card: IssueCardVM, sessionId: string): Promise<void> {
    try {
      const remote = await this.api()
      const links = await remote.linkIssue(card.repo, card.number, sessionId).then(result => unwrap(result))
      this.update({
        links,
        linkCards: { ...this.snapshot.linkCards, [this.keyOf(card.repo, card.number)]: card },
      })
      this.decorateLoadedCards(links)
    } catch {
      // A failed link is not worth an error banner; the chip stays a draft.
    }
  }

  /** Remove one issue → session link (or every link of the issue). */
  async unlinkSession(card: IssueCardVM, sessionId?: string): Promise<void> {
    try {
      const remote = await this.api()
      const links = await remote.unlinkIssue(card.repo, card.number, sessionId).then(result => unwrap(result))
      this.update({ links })
      const without = <T extends IssueCardVM>(target: T): T => {
        const remaining = (target.sessionLinks ?? []).filter(link => sessionId === undefined || link.sessionId !== sessionId)
        return { ...target, sessionLinks: remaining }
      }
      const list = this.snapshot.list
      this.update({
        ...list === undefined ? {} : { list: { ...list, items: list.items.map(card2 => without(card2)) } },
        ...this.snapshot.selected === undefined ? {} : { selected: without(this.snapshot.selected) },
        ...this.snapshot.detail === undefined ? {} : { detail: without(this.snapshot.detail) },
        ...this.snapshot.pinnedCard === undefined ? {} : { pinnedCard: without(this.snapshot.pinnedCard) },
      })
    } catch (error) {
      this.update({ error: asPanelError(error) })
    }
  }

  /** Read one optional client service without tripping the context proxy. */
  private service<T>(name: string): T | undefined {
    return this.runtime.getService(name) as T | undefined
  }

  /** Open (navigate to) one Session. */
  openSession(sessionId: string): void {
    this.service<{ openSession(id: string): void }>('uiWorkspace')?.openSession(sessionId)
  }

  /** Open the GitHub panel focused on one issue. */
  openInPanel(card: IssueCardVM): void {
    this.update({ selected: card, detail: undefined, detailLoading: true })
    this.service<{ selectPanel(id: string | null): void }>('layout')?.selectPanel('github')
    void (async () => {
      try {
        const remote = await this.api()
        const body = await remote.issueDetail(card.repo, card.number).then(result => unwrap(result))
        this.update({
          detail: { ...card, body: body.body, mentionedPRs: [] },
          detailLoading: false,
          mentionedLoading: true,
        })
        const mentioned = await remote.issueMentionedPRs(card.repo, card.number).then(result => unwrap(result))
        const current = this.snapshot.detail
        if (current === undefined || current.repo !== card.repo || current.number !== card.number) return
        const closing = new Set(current.linkedPRs.map(pr => pr.number))
        this.update({
          detail: { ...current, mentionedPRs: mentioned.mentionedPRs.filter(pr => !closing.has(pr.number)) },
          mentionedLoading: false,
        })
      } catch (error) {
        this.update({ detailLoading: false, error: asPanelError(error) })
      }
    })()
  }

  /**
   * Take the pending handoff when it belongs to this Session.
   * @param sessionId - the Session whose dock asks; a handoff stamped for a
   * different Session is left for that one.
   * @returns the issue to stage, or `undefined`.
   */
  consumeHandoff(sessionId?: string): IssueCardVM | undefined {
    const card = this.snapshot.pendingHandoff
    if (card === undefined) return undefined
    const target = this.snapshot.pendingHandoffSession
    if (target !== undefined && sessionId !== undefined && target !== sessionId) return undefined
    this.update({ pendingHandoff: undefined, pendingHandoffSession: undefined })
    return card
  }

  /** Render the profile's handoff prompt for one issue. */
  promptFor(card: IssueCardVM): string {
    return renderPrompt(card, this.snapshot.prefs.promptTemplate)
  }

  /** Insert one issue into the composer, per the configured handoff behavior. */
  async insertIntoComposer(
    card: IssueCardVM,
    inputActions: { setDraft(text: string): void; submit(): void } | undefined,
  ): Promise<void> {
    if (inputActions === undefined) return
    const text = this.promptFor(card)
    if (text === '') return
    inputActions.setDraft(text)
    if (this.snapshot.prefs.handoffMode === 'send') inputActions.submit()
  }
}
