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
  DEFAULT_PREFS, type GitHubStatus, type IssueCardVM, type IssueDetailVM, type IssueLinkRecord,
  type IssueListPage, type IssueListRequest, type Prefs, type ProjectRefVM, type RepoPageVM,
  type ScopeCatalog,
} from '../vm.ts'
import type { ClientContext } from './context.ts'
import { RemoteRefusal, unwrap, type RemoteResult } from './result.ts'
import type { PanelActions, PanelError, PanelSnapshot } from './viewmodel.ts'

/** How long the store waits for its own Remote namespace before giving up. */
const REMOTE_WAIT_MS = 15_000

/** How often the wait checks for the namespace. */
const REMOTE_POLL_MS = 250

/** The Cordis service key the Gateway publishes this plugin's namespace under. */
const REMOTE_KEY = `remote.${REMOTE_NAMESPACE}`

/** How long a confirmation stays on screen. */
const TOAST_MS = 2_500

/** The Remote surface as the Gateway actually resolves it. */
interface RemoteApi {
  status(): Promise<RemoteResult<GitHubStatus>>
  catalog(): Promise<RemoteResult<ScopeCatalog>>
  orgProjects(org: string): Promise<RemoteResult<{ projects: ProjectRefVM[]; blocked: boolean; error?: string }>>
  orgRepos(org: string): Promise<RemoteResult<RepoPageVM>>
  listIssues(request: IssueListRequest): Promise<RemoteResult<IssueListPage>>
  issueDetail(repo: string, number: number): Promise<RemoteResult<IssueDetailVM>>
  loadPrefs(): Promise<RemoteResult<Prefs>>
  savePrefs(patch: Partial<Prefs>): Promise<RemoteResult<Prefs>>
  refresh(): Promise<RemoteResult<{ ok: true }>>
  links(): Promise<RemoteResult<IssueLinkRecord[]>>
  linkIssue(repo: string, number: number, sessionId: string): Promise<RemoteResult<IssueLinkRecord[]>>
  unlinkIssue(repo: string, number: number, sessionId?: string): Promise<RemoteResult<IssueLinkRecord[]>>
}

/** One organization's lazily loaded scope lists. */
interface OrgScope {
  projects: ProjectRefVM[]
  repos: RepoPageVM
  blocked: boolean
  error?: string
}

/** One uniform error for the panel. */
function asPanelError(error: unknown): PanelError {
  if (error instanceof RemoteRefusal) {
    return { message: error.message, ...error.code === undefined ? {} : { code: error.code } }
  }
  return { message: error instanceof Error ? error.message : String(error) }
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
    links: [],
    linkCards: {},
  }

  private readonly listeners = new Set<() => void>()
  private readonly orgScopes = new Map<string, OrgScope>()
  private remote: RemoteApi | undefined
  private started = false
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private toastTimer: ReturnType<typeof setTimeout> | undefined
  private listSeq = 0

  /**
   * @param ctx - the browser plugin context.
   * @param mounting - settles when the hand-written Remote namespace is mounted.
   */
  constructor(private readonly ctx: ClientContext, private readonly mounting: Promise<string | undefined>) {
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
    void this.bootstrap()
  }

  /** Stop every timer this store owns. */
  stop(): void {
    this.started = false
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
      const [status, prefs] = await Promise.all([
        remote.status().then(result => unwrap(result)),
        remote.loadPrefs().then(result => unwrap(result)),
      ])
      this.update({
        status,
        prefs,
        projectsBlocked: status.missingProjectScope,
        loading: false,
      })
      void this.loadCatalog()
      void this.loadLinks()
      if (prefs.org !== undefined) void this.loadOrgScope(prefs.org)
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
    if (prefs.projectId !== undefined) request.projectId = prefs.projectId
    if (prefs.repo !== undefined) request.repos = [prefs.repo]
    return request
  }

  /** Fetch the first page of the current cascade. */
  private async reloadList(quiet = false): Promise<void> {
    const seq = ++this.listSeq
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
      this.update({
        catalog,
        projectsBlocked: this.snapshot.status?.missingProjectScope === true || catalog.projectsBlocked,
      })
    } catch (error) {
      this.update({ error: asPanelError(error) })
    }
  }

  /**
   * Load the projects and repositories of one organization, once per session.
   * A Projects v2 permission failure degrades to `projectsBlocked` while the
   * repository list still works.
   */
  private async loadOrgScope(org: string): Promise<void> {
    const cached = this.orgScopes.get(org)
    if (cached !== undefined) {
      this.update({
        orgProjects: cached.projects,
        orgRepos: cached.repos,
        projectsBlocked: cached.blocked || this.snapshot.status?.missingProjectScope === true,
        ...cached.error === undefined ? { projectsError: undefined } : { projectsError: cached.error },
      })
      return
    }
    this.update({ scopeLoading: true })
    try {
      const remote = await this.api()
      const [projects, repos] = await Promise.all([
        remote.orgProjects(org).then(result => unwrap(result)),
        remote.orgRepos(org).then(result => unwrap(result)),
      ])
      const scope: OrgScope = {
        projects: projects.projects,
        repos,
        blocked: projects.blocked || this.snapshot.status?.missingProjectScope === true,
        ...projects.error === undefined ? {} : { error: projects.error },
      }
      this.orgScopes.set(org, scope)
      this.update({
        orgProjects: scope.projects,
        orgRepos: scope.repos,
        projectsBlocked: scope.blocked,
        ...scope.error === undefined ? { projectsError: undefined } : { projectsError: scope.error },
        scopeLoading: false,
      })
    } catch (error) {
      this.update({ scopeLoading: false, error: asPanelError(error) })
    }
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

  /** Fetch the pinned issue when it is not in the current list. */
  private async hydratePinned(): Promise<void> {
    const pinned = this.snapshot.prefs.pinned
    if (pinned === undefined || this.snapshot.pinnedCard !== undefined) return
    try {
      const remote = await this.api()
      const detail = await remote.issueDetail(pinned.repo, pinned.number).then(result => unwrap(result))
      this.update({ pinnedCard: detail })
    } catch {
      // A deleted or inaccessible pinned issue simply leaves the dock empty.
    }
  }

  // ── PanelActions ────────────────────────────────────────────────────────────

  refresh(): void {
    void (async () => {
      try {
        const remote = await this.api()
        await remote.refresh()
        const status = await remote.status().then(result => unwrap(result))
        this.orgScopes.clear()
        this.update({
          status,
          catalog: undefined,
          orgProjects: undefined,
          orgRepos: undefined,
          projectsBlocked: status.missingProjectScope,
          projectsError: undefined,
        })
      } catch (error) {
        this.update({ error: asPanelError(error) })
        return
      }
      const org = this.snapshot.prefs.org
      if (org !== undefined) void this.loadOrgScope(org)
      await this.reloadList()
      void this.loadCatalog()
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
      } catch (error) {
        this.update({ loadingMore: false, error: asPanelError(error) })
      }
    })()
  }

  setOrg(org: string | undefined): void {
    // A new organization invalidates the project and repository selected inside
    // the previous one.
    void this.savePrefs({ org, projectId: undefined, repo: undefined }, async saved => {
      this.update({ orgProjects: undefined, orgRepos: undefined })
      if (saved.org !== undefined) await this.loadOrgScope(saved.org)
    })
  }

  setProject(projectId: string | undefined): void {
    void this.savePrefs({ projectId })
  }

  setRepo(repo: string | undefined): void {
    void this.savePrefs({ repo })
  }

  setAssignee(assignee: string): void {
    void this.savePrefs({ assignee })
  }

  setStateFilter(state: Prefs['state']): void {
    void this.savePrefs({ state })
  }

  selectIssue(card: IssueCardVM): void {
    this.update({ selected: card, detail: undefined, detailLoading: true })
    void (async () => {
      try {
        const remote = await this.api()
        const detail = await remote.issueDetail(card.repo, card.number).then(result => unwrap(result))
        this.update({ detail, detailLoading: false })
      } catch (error) {
        this.update({ detailLoading: false, error: asPanelError(error) })
      }
    })()
  }

  closeDetail(): void {
    this.update({ selected: undefined, detail: undefined, detailLoading: false })
  }

  async savePrefs(
    patch: Partial<Prefs>,
    after?: (saved: Prefs) => Promise<void> | void,
  ): Promise<void> {
    try {
      const remote = await this.api()
      const saved = await remote.savePrefs(patch).then(result => unwrap(result))
      const affectsList = ['org', 'projectId', 'repo', 'assignee', 'state'].some(key => key in patch)
      this.update({ prefs: saved })
      if (affectsList) {
        await this.reloadList()
        this.refreshPinnedCard()
      } else if ('handoffMode' in patch || 'promptTemplate' in patch) {
        this.toast('settings.saved')
      }
      if (after !== undefined) await after(saved)
    } catch (error) {
      this.update({ error: asPanelError(error) })
    }
  }

  pin(card: IssueCardVM): void {
    this.update({ pinnedCard: card })
    this.toast('panel.toast.pinned')
    void this.savePrefs({ pinned: { repo: card.repo, number: card.number } })
  }

  unpin(): void {
    this.update({ pinnedCard: undefined, pendingHandoff: undefined })
    void this.savePrefs({ pinned: undefined })
  }

  handoff(card: IssueCardVM): void {
    this.pin(card)
    this.update({ pendingHandoff: card })
    // Selecting the Conversation mounts its composer; the dock consumes the
    // pending handoff when it renders and writes the prompt into the draft.
    this.ctx.layout?.selectPanel(null)
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
      void this.ensureCards(links)
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
    try {
      const remote = await this.api()
      const cards: Record<string, IssueCardVM> = {}
      for (const [key, target] of [...missing.entries()].slice(0, 10)) {
        try {
          const detail = await remote.issueDetail(target.repo, target.number).then(result => unwrap(result))
          cards[key] = detail
        } catch {
          // A deleted or inaccessible issue just has no chip.
        }
      }
      if (Object.keys(cards).length === 0) return
      this.update({ linkCards: { ...this.snapshot.linkCards, ...cards } })
    } catch {
      // ignore: chips appear once the list or a later load resolves the card
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

  /** Open (navigate to) one Session. */
  openSession(sessionId: string): void {
    this.ctx.uiWorkspace?.openSession(sessionId)
  }

  /** Open the GitHub panel focused on one issue. */
  openInPanel(card: IssueCardVM): void {
    this.update({ selected: card, detail: undefined, detailLoading: true })
    this.ctx.layout?.selectPanel('github')
    void (async () => {
      try {
        const remote = await this.api()
        const detail = await remote.issueDetail(card.repo, card.number).then(result => unwrap(result))
        this.update({ detail, detailLoading: false })
      } catch (error) {
        this.update({ detailLoading: false, error: asPanelError(error) })
      }
    })()
  }

  /** Take the pending handoff, if any. Exactly one caller receives it. */
  consumeHandoff(): IssueCardVM | undefined {
    const card = this.snapshot.pendingHandoff
    if (card !== undefined) this.update({ pendingHandoff: undefined })
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
