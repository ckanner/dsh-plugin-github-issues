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
import { normalizeRequest } from './github/list-request.ts'
import type { PrefsStore } from './github/state.ts'
import type {
  GitHubStatus, IssueBodyVM, IssueCardVM, IssueDetailVM, IssueLinkRecord, IssueListPage,
  LinkedCardsRequest, LinkedPRVM, Prefs,
  ProjectRefVM, RepoMilestoneVM, RepoPageVM, ScopeCatalog,
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

/**
 * Validate the dock's linked-card refresh input from the wire.
 * @param input - untrusted Remote argument.
 * @returns at most 20 repositories with up to 50 positive numbers each.
 */
function normalizeLinkedCards(input: unknown): LinkedCardsRequest[] {
  if (!Array.isArray(input)) return []
  const groups: LinkedCardsRequest[] = []
  for (const entry of input.slice(0, 20)) {
    if (typeof entry !== 'object' || entry === null) continue
    const raw = entry as Record<string, unknown>
    const repo = typeof raw.repo === 'string' && raw.repo.includes('/') ? raw.repo : undefined
    const numbers = Array.isArray(raw.numbers)
      ? raw.numbers.filter((number): number is number => typeof number === 'number' && Number.isInteger(number) && number > 0).slice(0, 50)
      : []
    if (repo === undefined || numbers.length === 0) continue
    groups.push({ repo, numbers })
  }
  return groups
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

  /**
   * Refresh the dock's linked-issue chips.
   * @param groups - repositories and issue numbers from recorded links.
   * @returns current cards for issues that still exist.
   */
  @Remote
  async linkedCards(groups: unknown): Promise<IssueCardVM[]> {
    return this.withApi(api => api.linkedCards(normalizeLinkedCards(groups)))
  }

  /** One repository's milestones, for the picker and its list filter. */
  @Remote
  async repoMilestones(repo: string): Promise<{ milestones: RepoMilestoneVM[] }> {
    return this.withApi(api => api.repoMilestones(repo))
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
