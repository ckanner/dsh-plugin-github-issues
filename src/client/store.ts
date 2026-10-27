/**
 * The panel's state owner.
 *
 * One store is shared by the full-page panel, the composer dock, and the settings
 * page: they show the same issue, the same prefs, and the same error. The store
 * owns every call into the Host Remote namespace and every poll timer, so the
 * renderers stay pure and the data flow is reviewable in one file.
 *
 * @module dsh-plugin-github-issues/client/store
 */

import { renderPrompt } from '../prompt.ts'
import { REMOTE_NAMESPACE } from '../remote-methods.ts'
import {
  DEFAULT_PREFS, type GitHubStatus, type IssueCardVM, type IssueDetailVM, type IssueListPage,
  type IssueListRequest, type Prefs, type ScopeCatalog,
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
  listIssues(request: IssueListRequest): Promise<RemoteResult<IssueListPage>>
  issueDetail(repo: string, number: number): Promise<RemoteResult<IssueDetailVM>>
  loadPrefs(): Promise<RemoteResult<Prefs>>
  savePrefs(patch: Partial<Prefs>): Promise<RemoteResult<Prefs>>
  refresh(): Promise<RemoteResult<{ ok: true }>>
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
    detailLoading: false,
    prefs: DEFAULT_PREFS,
    projectsBlocked: false,
  }

  private readonly listeners = new Set<() => void>()
  private remote: RemoteApi | undefined
  private started = false
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private toastTimer: ReturnType<typeof setTimeout> | undefined
  private listSeq = 0
  private remoteError: string | undefined

  /**
   * @param ctx - the browser plugin context.
   * @param mounting - settles when the hand-written Remote namespace is mounted.
   */
  constructor(private readonly ctx: ClientContext, private readonly mounting: Promise<string | undefined>) {
    void mounting.then(refused => {
      if (refused !== undefined) this.remoteError = `the GitHub service could not be mounted: ${refused}`
    })
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

  /** Load prefs, auth facts, the catalog, and the first list page. */
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

  /** Build the list request the current preferences describe. */
  private request(after: string | null): IssueListRequest {
    const prefs = this.snapshot.prefs
    const base: IssueListRequest = { view: prefs.view, state: prefs.state, first: 30, after }
    if (prefs.view === 'repo' && prefs.repo !== undefined) return { ...base, repos: [prefs.repo] }
    if (prefs.view === 'project' && prefs.projectId !== undefined) {
      return { ...base, projectId: prefs.projectId, ...prefs.org === undefined ? {} : { org: prefs.org } }
    }
    return base
  }

  /** Fetch the first page of the current view. */
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
        // `projectsBlocked` is an authorization fact (status + catalog), never a
        // list notice: an empty project view legitimately carries "select a
        // project" as its notice, and polling must not turn that into a scope
        // warning.
        projectsBlocked: this.snapshot.projectsBlocked,
      })
      this.refreshPinnedCard()
    } catch (error) {
      if (seq !== this.listSeq) return
      this.update({ loading: false, loadingMore: false, error: asPanelError(error) })
    }
  }

  /** Load the repository/project pickers lazily. */
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
        this.update({
          status,
          catalog: undefined,
          projectsBlocked: status.missingProjectScope,
        })
      } catch (error) {
        this.update({ error: asPanelError(error) })
        return
      }
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

  setView(view: Prefs['view']): void {
    void this.savePrefs({ view })
  }

  setRepo(repo: string | undefined): void {
    void this.savePrefs({ repo })
  }

  setProject(projectId: string | undefined): void {
    void this.savePrefs({ projectId })
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

  savePrefs(patch: Partial<Prefs>): Promise<void> {
    return (async () => {
      try {
        const remote = await this.api()
        const saved = await remote.savePrefs(patch).then(result => unwrap(result))
        const affectsList = ['view', 'repo', 'projectId', 'org', 'state'].some(key => key in patch)
        this.update({ prefs: saved })
        if (affectsList) {
          await this.reloadList()
          this.refreshPinnedCard()
        } else if ('handoffMode' in patch || 'promptTemplate' in patch) {
          this.toast('settings.saved')
        }
      } catch (error) {
        this.update({ error: asPanelError(error) })
      }
    })()
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
