/**
 * The browser's way into GitHub.
 *
 * Everything that needs a credential happens here or below: the token is resolved
 * on the Host, cached briefly in memory, and used only in an `Authorization`
 * header. The browser half receives JSON view models and never a token.
 *
 * One `GitHubApi` is created lazily on the first call and re-created after a
 * 401 (the machine's `gh` token may have been refreshed or revoked between
 * sessions) or when the settings page asks for a refresh.
 *
 * @module dsh-plugin-github-issues/controller
 */

import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import type { GitHubApi, GitHubApiOptions, GhProbe, ResolvedAuth } from './github/types.ts'
import { GitHubApiError } from './github/types.ts'
import type { PrefsStore } from './github/state.ts'
import type {
  GitHubStatus, IssueBodyVM, IssueCardVM, IssueDetailVM, IssueLinkRecord, IssueListPage,
  LinkedPRVM, Prefs,
  ProjectRefVM, RepoPageVM, ScopeCatalog,
} from './vm.ts'

/** How long one resolved token is reused before asking `gh` again. */
const TOKEN_TTL_MS = 5 * 60 * 1_000

/** The Host-side collaborators the controller forwards to. */
export interface ControllerOptions {
  /** Probe `gh auth status` without exposing the token. */
  probeGh: (config: { host: string; ghPath?: string }, signal?: AbortSignal) => Promise<GhProbe>
  /** Resolve the token from the machine's `gh` CLI. */
  resolveToken: (config: { host: string; ghPath?: string }, signal?: AbortSignal) => Promise<ResolvedAuth>
  /** Create one API session for a token. */
  createApi: (options: GitHubApiOptions) => GitHubApi
  /** Persisted preferences. */
  prefs: PrefsStore
  /** Deployment configuration as the loader resolved it. */
  config: { authMode: string; host: string; ghPath: string; handoffMode: string; pollSeconds: number }
}

/** Validate a list request that came over the wire. */
function normalizeRequest(input: unknown): {
  view?: 'assigned' | 'created' | 'open' | 'repo' | 'project'
  repos?: string[]
  projectId?: string
  org?: string
  assignee: string
  author?: string
  state: 'open' | 'closed' | 'all'
  first: number
  after: string | null
} {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const views = ['assigned', 'created', 'open', 'repo', 'project'] as const
  const view = typeof raw.view === 'string' && (views as readonly string[]).includes(raw.view)
    ? raw.view as (typeof views)[number]
    : undefined
  const states = ['open', 'closed', 'all'] as const
  const state = typeof raw.state === 'string' && (states as readonly string[]).includes(raw.state)
    ? raw.state as (typeof states)[number]
    : 'open'
  const repos = Array.isArray(raw.repos)
    ? raw.repos.filter((entry): entry is string => typeof entry === 'string' && entry.includes('/')).slice(0, 10)
    : undefined
  const first = typeof raw.first === 'number' && Number.isFinite(raw.first)
    ? Math.min(Math.max(Math.trunc(raw.first), 1), 50)
    : 30
  const after = typeof raw.after === 'string' && raw.after !== '' ? raw.after : null
  const assignee = typeof raw.assignee === 'string' && raw.assignee !== ''
    ? raw.assignee
    : view === 'assigned' ? '@me' : 'all'
  const author = typeof raw.author === 'string' && raw.author !== ''
    ? raw.author
    : view === 'created' ? '@me' : undefined
  return {
    ...view === undefined ? {} : { view },
    state,
    first,
    after,
    assignee,
    ...author === undefined ? {} : { author },
    ...repos === undefined || repos.length === 0 ? {} : { repos },
    ...typeof raw.projectId === 'string' && raw.projectId !== '' ? { projectId: raw.projectId } : {},
    ...typeof raw.org === 'string' && raw.org !== '' ? { org: raw.org } : {},
  }
}

/** Remote owner of the GitHub Issues surface, namespace `githubIssues`. */
export class GitHubIssuesController extends TypertRemoteService {
  private api: GitHubApi | undefined
  private tokenAt = 0
  private token: ResolvedAuth | undefined

  /**
   * @param ctx - the plugin context this service lives and dies with.
   * @param options - the Host collaborators.
   */
  constructor(ctx: unknown, private readonly options: ControllerOptions) {
    super(ctx, 'githubIssuesController', { namespace: 'githubIssues' })
  }

  /** Resolve one API session, reusing the token briefly. */
  private async apiNow(signal?: AbortSignal): Promise<GitHubApi> {
    if (this.api !== undefined && this.token !== undefined && Date.now() - this.tokenAt < TOKEN_TTL_MS) {
      return this.api
    }
    const authConfig = this.authConfig()
    const auth = await this.options.resolveToken(authConfig, signal)
    this.token = auth
    this.tokenAt = Date.now()
    this.api = this.options.createApi({ token: auth.token, host: auth.host })
    return this.api
  }

  /** Forget the cached token and session, so the next call re-resolves them. */
  private forgetAuth(): void {
    this.api = undefined
    this.token = undefined
    this.tokenAt = 0
  }

  private ghPath(): string | undefined {
    return this.options.config.ghPath === '' ? undefined : this.options.config.ghPath
  }

  /** The membership the auth helpers accept, with no `undefined`-valued key. */
  private authConfig(): { host: string; ghPath?: string } {
    const ghPath = this.ghPath()
    return ghPath === undefined
      ? { host: this.options.config.host }
      : { host: this.options.config.host, ghPath }
  }

  /** Run one API operation, retrying once after a 401 with a freshly resolved token. */
  private async withApi<T>(operation: (api: GitHubApi) => Promise<T>, signal?: AbortSignal): Promise<T> {
    try {
      return await operation(await this.apiNow(signal))
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 401) {
        this.forgetAuth()
        return await operation(await this.apiNow(signal))
      }
      throw error
    }
  }

  /** Auth facts for the settings page: no token, only what `gh auth status` reports. */
  @Remote
  async status(): Promise<GitHubStatus> {
    let probe: GhProbe
    try {
      probe = await this.options.probeGh(this.authConfig())
    } catch (error) {
      probe = {
        installed: false,
        signedIn: false,
        scopes: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
    const scopes = probe.scopes
    return {
      mode: 'gh',
      ghInstalled: probe.installed,
      ...probe.path === undefined ? {} : { ghPath: probe.path },
      signedIn: probe.signedIn,
      ...probe.login === undefined ? {} : { login: probe.login },
      host: this.options.config.host,
      ...probe.tokenSource === undefined ? {} : { tokenSource: probe.tokenSource },
      scopes,
      missingProjectScope: !scopes.some(scope => scope === 'project' || scope === 'read:project'),
      config: {
        authMode: this.options.config.authMode,
        host: this.options.config.host,
        handoffMode: this.options.config.handoffMode,
        pollSeconds: this.options.config.pollSeconds,
      },
      ...probe.error === undefined ? {} : { error: probe.error },
    }
  }

  /** Repositories, organizations, projects, and the viewer. */
  @Remote
  async catalog(): Promise<ScopeCatalog> {
    return await this.withApi(api => api.scopes())
  }

  /** Attach the recorded session links to one card. */
  private decorate<T extends IssueCardVM>(card: T): T {
    const links = this.options.prefs.linksFor(card.repo, card.number)
    return links.length === 0 ? card : { ...card, sessionLinks: links }
  }

  /** One page of the list. */
  @Remote
  async listIssues(request: unknown): Promise<IssueListPage> {
    const page = await this.withApi(api => api.listIssues(normalizeRequest(request)))
    return { ...page, items: page.items.map(card => this.decorate(card)) }
  }

  /** Projects v2 of one organization; empty and `blocked` without `read:project`. */
  @Remote
  async orgProjects(org: string): Promise<{ projects: ProjectRefVM[]; blocked: boolean; error?: string }> {
    return await this.withApi(api => api.orgProjects(org))
  }

  /** One organization's repositories, loaded when the organization is chosen. */
  @Remote
  async orgRepos(org: string): Promise<RepoPageVM> {
    return await this.withApi(api => api.orgRepos(org))
  }

  /** One issue with body and linked PRs. */
  @Remote
  async issueDetail(repo: string, number: number): Promise<IssueBodyVM> {
    return this.withApi(api => api.issueDetail(repo, number))
  }

  /** The issue's cross-referenced pull requests; fetched after the detail shows. */
  @Remote
  async issueMentionedPRs(repo: string, number: number): Promise<{ mentionedPRs: LinkedPRVM[] }> {
    return this.withApi(api => api.issueMentionedPRs(repo, number))
  }

  /** Every recorded issue → session link (the dock resolves its own session). */
  @Remote
  async links(): Promise<IssueLinkRecord[]> {
    return this.options.prefs.links()
  }

  /** Record that an issue was handed to one session. */
  @Remote
  async linkIssue(repo: string, number: number, sessionId: string): Promise<IssueLinkRecord[]> {
    if (typeof repo !== 'string' || repo === '' || !Number.isInteger(number) || number <= 0 || typeof sessionId !== 'string' || sessionId === '') {
      throw new Error('linkIssue: repo, a positive number, and sessionId are required')
    }
    return this.options.prefs.link(repo, number, sessionId)
  }

  /** Remove one issue → session link, or all links of the issue. */
  @Remote
  async unlinkIssue(repo: string, number: number, sessionId?: string): Promise<IssueLinkRecord[]> {
    return this.options.prefs.unlink(repo, number, sessionId)
  }

  /** Preferences persisted on the Host. */
  @Remote
  async loadPrefs(): Promise<Prefs> {
    return this.options.prefs.load()
  }

  /** Merge one preference patch and persist it. */
  @Remote
  async savePrefs(patch: unknown): Promise<Prefs> {
    return this.options.prefs.save(patch)
  }

  /**
   * Drop cached GitHub responses and the resolved token so the next request
   * refetches. The token is re-resolved too: the user may have just granted a
   * scope (`gh auth refresh -s read:project`) and the Host must see it at once,
   * not after the five-minute token TTL.
   */
  @Remote
  async refresh(): Promise<{ ok: true }> {
    this.forgetAuth()
    return { ok: true }
  }
}
