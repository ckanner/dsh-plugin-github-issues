/**
 * The Host-side GitHub GraphQL client.
 *
 * This is the only module that talks to api.github.com (or a GHES equivalent).
 * It owns four concerns that the rest of the plugin should not have to know
 * about:
 *
 * - **The credential.** The token lives in this closure and appears only in an
 *   `Authorization` header; it is never logged and never placed in an error.
 * - **Failure taxonomy.** GitHub answers GraphQL failures with HTTP 200 plus an
 *   `errors[]` array, and transport failures with 401/403/404/429; both are
 *   classified into a small set of codes so the UI can say what to fix.
 * - **Scoping quirks.** Projects v2 need `read:project`, which a machine's `gh`
 *   token may not have. That is a blocked picker, not a broken plugin, so it
 *   degrades to `projectsBlocked` and a notice.
 * - **Caching.** The panel polls, so responses are kept briefly in memory; a
 *   refresh drops them. GraphQL has no conditional requests to rely on.
 *
 * The interface itself is defined in `types.ts`; this module only implements it.
 *
 * @module dsh-plugin-github-issues/github/client
 */

import type {
  IssueCardVM, IssueDetailVM, IssueListPage, IssueListRequest, ListView, OrgRefVM,
  ProjectRefVM, RepoPageVM, RepoRefVM, ScopeCatalog,
} from '../vm.ts'
import {
  buildIssueDetailQuery, buildOrgProjectsQuery, buildOrgReposQuery, buildProjectItemsQuery,
  buildRepoIssuesQuery, buildScopeQuery, buildSearchIssuesQuery, projectItemsFilterFor,
  searchStringForFilters, statesForView,
} from './queries.ts'
import type { GitHubGraphQLRequest } from './queries.ts'
import { GitHubApiError, splitRepo } from './types.ts'
import type { GitHubApi, GitHubApiOptions } from './types.ts'
import { toIssueCardVM, toIssueDetailVM, toProjectItemCardVM } from './vm.ts'
import type { RawIssue, RawProjectItem, RawTimelineItem } from './vm.ts'

/** The `User-Agent` GitHub asks every API client to send. */
const USER_AGENT = 'dsh-plugin-github-issues'

/** One request's wall-clock budget. */
const REQUEST_TIMEOUT_MS = 20_000

/** How long the scope catalog is reused; the picker need not be real-time. */
const SCOPES_TTL_MS = 5 * 60 * 1_000

/** How long one list page is reused; the panel polls explicitly. */
const LIST_TTL_MS = 60 * 1_000

/** How long one issue detail is reused. */
const DETAIL_TTL_MS = 30 * 1_000

/** The list page size used when a caller does not supply one. */
const DEFAULT_PAGE_SIZE = 30

/** Repositories are fetched from at most two pages, so the picker stays cheap. */
const MAX_SCOPE_REPOS = 200

/** Organizations queried for projects; each alias costs points. */
const PROJECT_SCOPE_LIMIT = 25

/** The part of `Response` this client uses, so it compiles without DOM types. */
interface GitHubResponse {
  status: number
  headers: HeaderReader
  text(): Promise<string>
}

/** The part of `Headers` this client reads. */
interface HeaderReader {
  get(name: string): string | null
}

/** The part of `fetch` this client uses. */
type GitHubFetch = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body: string
    signal: AbortSignal
  },
) => Promise<GitHubResponse>

/** One GraphQL error, keeping only the fields used for classification. */
interface RawGraphQLError {
  /** GitHub's machine type, e.g. `INSUFFICIENT_SCOPES` or `RATE_LIMITED`. */
  type?: string
  /** Human text; safe to preserve and show (it never contains the token). */
  message?: string
}

/** One parsed GraphQL response. */
interface GraphQLResult {
  data?: unknown
  errors: RawGraphQLError[]
  status: number
}

/** A cached value with the moment it was fetched. */
interface Timed<T> {
  at: number
  data: T
}

/** A list request after validation and defaulting; also the cache key's input. */
interface NormalizedListRequest {
  /** Legacy view, kept so older callers and tests keep one meaning. */
  view?: ListView
  repos: string[]
  state: 'open' | 'closed' | 'all'
  assignee: string
  author?: string
  first: number
  after: string | null
  projectId?: string
  org?: string
}

/** One page of GraphQL pagination. */
interface RawPageInfo {
  hasNextPage?: boolean | null
  endCursor?: string | null
}

/** The `rateLimit` selection every list document carries. */
interface RawRateLimit {
  cost?: number | null
  remaining?: number | null
}

/** A repository node in the scope query. */
interface RawRepoRef {
  nameWithOwner?: string | null
  isPrivate?: boolean | null
  isFork?: boolean | null
  pushedAt?: string | null
}

/** The repository connection of the scope query. */
interface RawRepoPage {
  totalCount?: number | null
  pageInfo?: RawPageInfo | null
  nodes?: (RawRepoRef | null)[] | null
}

/** One organization node in the scope query. */
interface RawOrgRef {
  login?: string | null
  name?: string | null
}

/** The response of one organization's project discovery. */
interface RawOrgProjectsData {
  organization?: { projectsV2?: RawProjectConnection | null } | null
}

/** The response of one organization's repository page. */
interface RawOrgReposData {
  organization?: { repositories?: RawRepoPage | null } | null
}

/** The scope catalog response. */
interface RawScopeData {
  viewer?: {
    login?: string | null
    avatarUrl?: string | null
    repositories?: RawRepoPage | null
    organizations?: { nodes?: (RawOrgRef | null)[] | null } | null
  } | null
  rateLimit?: RawRateLimit | null
}

/** One project node in the project-discovery query. */
interface RawProjectRefNode {
  id?: string | null
  number?: number | null
  title?: string | null
  url?: string | null
}

/** A project connection in the project-discovery query. */
interface RawProjectConnection {
  nodes?: (RawProjectRefNode | null)[] | null
}

/** The project-discovery response: a viewer connection plus one alias per org. */
interface RawProjectsData {
  viewer?: { projectsV2?: RawProjectConnection | null } | null
  [alias: string]: unknown
}

/** An issue connection in the search or repository response. */
interface RawIssuePage {
  totalCount?: number | null
  pageInfo?: RawPageInfo | null
  nodes?: (RawIssue | null)[] | null
}

/** The search response. */
interface RawSearchData {
  search?: {
    issueCount?: number | null
    pageInfo?: RawPageInfo | null
    nodes?: (RawIssue | null)[] | null
  } | null
  rateLimit?: RawRateLimit | null
}

/** The single-repository response. */
interface RawRepoData {
  repository?: { issues?: RawIssuePage | null } | null
  rateLimit?: RawRateLimit | null
}

/** A detail node: the card fields plus the cross-reference timeline. */
interface RawIssueDetail extends RawIssue {
  timelineItems?: { nodes?: (RawTimelineItem | null)[] | null } | null
}

/** The detail response. */
interface RawDetailData {
  repository?: { issue?: RawIssueDetail | null } | null
}

/** The project-items response. */
interface RawProjectItemsData {
  node?: {
    items?: {
      totalCount?: number | null
      pageInfo?: RawPageInfo | null
      nodes?: (RawProjectItem | null)[] | null
    } | null
  } | null
  rateLimit?: RawRateLimit | null
}

/**
 * The GraphQL endpoint for one host.
 * github.com uses the dedicated API host; every GitHub Enterprise Server host
 * serves GraphQL under its own `/api/graphql` path.
 * @param host - configured host, e.g. `github.com` or `ghe.example.com`.
 * @returns the absolute GraphQL endpoint.
 */
export function endpointFor(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, '')
  if (trimmed === '' || trimmed === 'github.com' || trimmed === 'api.github.com') {
    return 'https://api.github.com/graphql'
  }
  if (/^https?:\/\//i.test(trimmed)) return `${trimmed}/api/graphql`
  return `https://${trimmed}/api/graphql`
}

/** Read the global `fetch` at call time, so a test can substitute it. */
function globalFetch(): GitHubFetch | undefined {
  const candidate = (globalThis as { fetch?: unknown }).fetch
  return typeof candidate === 'function' ? candidate as GitHubFetch : undefined
}

/** Build an abort error whose name `AbortError` matches fetch's convention. */
function abortReason(signal: AbortSignal | undefined): Error {
  const reason = signal?.reason
  if (reason instanceof Error) return reason
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

/** Turn an unknown thrown value into a message that is safe to display. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Parse a body, returning `undefined` rather than throwing on malformed JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Keep the fields of `errors[]` the classifier reads. */
function rawErrorsOf(value: unknown): RawGraphQLError[] {
  if (!Array.isArray(value)) return []
  const errors: RawGraphQLError[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as { type?: unknown; message?: unknown }
    errors.push({
      ...typeof record.type === 'string' ? { type: record.type } : {},
      ...typeof record.message === 'string' ? { message: record.message } : {},
    })
  }
  return errors
}

/** The first non-empty error message, preserving GitHub's wording. */
function firstMessage(errors: readonly RawGraphQLError[]): string | undefined {
  for (const error of errors) {
    if (typeof error.message === 'string' && error.message !== '') return error.message
  }
  return undefined
}

/** Whether an error means the token lacks a required scope. */
function isScopeError(error: RawGraphQLError): boolean {
  return error.type === 'INSUFFICIENT_SCOPES'
    || /INSUFFICIENT_SCOPES|required scopes|not been granted the required scopes/i.test(error.message ?? '')
}

/** Whether an error means a primary or secondary rate limit was hit. */
function isRateLimitError(error: RawGraphQLError): boolean {
  return error.type === 'RATE_LIMITED'
    || /rate limit|secondary rate|abuse detection/i.test(error.message ?? '')
}

/** Whether an error means the addressed object does not exist or is inaccessible. */
function isNotFoundError(error: RawGraphQLError): boolean {
  return error.type === 'NOT_FOUND'
}

/** Whether an error means the request was not authorized. */
function isUnauthorizedError(error: RawGraphQLError): boolean {
  return error.type === 'UNAUTHORIZED'
}

/**
 * Classify an HTTP failure that arrived without a usable GraphQL body.
 * Rate limits are checked first because GitHub reports them as a plain 403 with
 * a `Retry-After` header, which would otherwise look like a permission problem.
 */
function httpFailure(
  status: number,
  headers: HeaderReader,
  text: string,
  errors: readonly RawGraphQLError[],
  topLevelMessage: string | undefined,
): GitHubApiError {
  const retryAfter = headers.get('retry-after')
  const remaining = headers.get('x-ratelimit-remaining')
  const message = firstMessage(errors) ?? topLevelMessage
  if (status === 429 || retryAfter !== null || remaining === '0' || /rate limit|secondary rate/i.test(text)) {
    return new GitHubApiError(
      message ?? `GitHub rate limit exceeded${retryAfter === null ? '.' : `; retry after ${retryAfter} s.`}`,
      'rate_limited',
      status,
    )
  }
  if (errors.some(isScopeError) || /required scopes|not been granted|INSUFFICIENT_SCOPES/i.test(text)) {
    return new GitHubApiError(message ?? 'The GitHub token is missing a required scope.', 'missing_scope', status)
  }
  return new GitHubApiError(message ?? `GitHub request failed with HTTP ${status}.`, 'graphql', status)
}

/** Classify the `errors[]` of a 2xx GraphQL response. */
function errorFromBody(
  errors: readonly RawGraphQLError[],
  status: number,
): GitHubApiError | undefined {
  if (errors.length === 0) return undefined
  const message = firstMessage(errors) ?? 'GitHub returned an error for the request.'
  if (errors.some(isScopeError)) {
    return new GitHubApiError(message, 'missing_scope', status >= 400 ? status : 403)
  }
  if (errors.some(isRateLimitError)) {
    return new GitHubApiError(message, 'rate_limited', status >= 400 ? status : 429)
  }
  if (errors.some(isUnauthorizedError)) return new GitHubApiError(message, 'unauthorized', 401)
  if (errors.some(isNotFoundError)) {
    return new GitHubApiError(message, 'not_found', status >= 400 ? status : 404)
  }
  return new GitHubApiError(message, 'graphql', status >= 400 ? status : undefined)
}

/** Normalize the pagination block into the view model's shape. */
function pageInfoOf(raw: RawPageInfo | null | undefined): { hasNextPage: boolean; endCursor: string | null } {
  return {
    hasNextPage: raw?.hasNextPage === true,
    endCursor: typeof raw?.endCursor === 'string' ? raw.endCursor : null,
  }
}

/** Map the `rateLimit` selection, or `undefined` when it was not requested. */
function rateLimitOf(raw: RawRateLimit | null | undefined): { cost?: number; remaining?: number } | undefined {
  if (raw === null || raw === undefined) return undefined
  const cost = typeof raw.cost === 'number' ? raw.cost : undefined
  const remaining = typeof raw.remaining === 'number' ? raw.remaining : undefined
  if (cost === undefined && remaining === undefined) return undefined
  return {
    ...cost === undefined ? {} : { cost },
    ...remaining === undefined ? {} : { remaining },
  }
}

/** A page that needs no round trip: empty, not paged, optionally with a reason. */
function emptyPage(notice?: string): IssueListPage {
  return {
    items: [],
    pageInfo: { hasNextPage: false, endCursor: null },
    ...notice === undefined ? {} : { notice },
  }
}

/** The message shown wherever Projects v2 could not be read for lack of scope. */
function projectsScopeMessage(host: string): string {
  return `Projects v2 need the "read:project" scope. Run: gh auth refresh -h ${host} -s read:project`
}

/** Normalize and validate a list request, clamping paging values. */
function normalizeListRequest(request: IssueListRequest): NormalizedListRequest {
  const repos = [...new Set((request.repos ?? []).filter(repo => typeof repo === 'string' && repo.includes('/')))].sort()
  const first = typeof request.first === 'number' && Number.isFinite(request.first)
    ? Math.min(Math.max(Math.trunc(request.first), 1), 50)
    : DEFAULT_PAGE_SIZE
  const after = typeof request.after === 'string' && request.after !== '' ? request.after : null
  const state = request.state === 'closed' || request.state === 'all' ? request.state : 'open'
  const projectId = typeof request.projectId === 'string' && request.projectId !== '' ? request.projectId : undefined
  const org = typeof request.org === 'string' && request.org !== '' ? request.org : undefined
  const view = request.view
  const assignee = typeof request.assignee === 'string' && request.assignee !== ''
    ? request.assignee
    : view === 'assigned' ? '@me' : 'all'
  const author = typeof request.author === 'string' && request.author !== ''
    ? request.author
    : view === 'created' ? '@me' : undefined
  return {
    ...view === undefined ? {} : { view },
    repos,
    state,
    assignee,
    first,
    after,
    ...author === undefined ? {} : { author },
    ...projectId === undefined ? {} : { projectId },
    ...org === undefined ? {} : { org },
  }
}

/** The cache key for a normalized request; its property order is fixed. */
function listCacheKey(request: NormalizedListRequest): string {
  return JSON.stringify(request)
}

/** Map a raw issue connection to cards, dropping entries the search returned without fields. */
function toCards(nodes: readonly (RawIssue | null)[] | null | undefined): IssueCardVM[] {
  const cards: IssueCardVM[] = []
  for (const node of nodes ?? []) {
    if (node === null) continue
    if (typeof node.number !== 'number' || typeof node.id !== 'string' || node.id === '') continue
    cards.push(toIssueCardVM(node))
  }
  return cards
}

/** Whether a card survives the project view's client-side state filter. */
function stateMatches(state: IssueCardVM['state'], filter: 'open' | 'closed' | 'all'): boolean {
  if (filter === 'all') return true
  return filter === 'open' ? state === 'OPEN' : state === 'CLOSED'
}

/** Map the viewer block of the scope catalog. */
function viewerOf(raw: RawScopeData['viewer']): ScopeCatalog['viewer'] {
  if (raw === null || raw === undefined || typeof raw.login !== 'string' || raw.login === '') return null
  return {
    login: raw.login,
    ...typeof raw.avatarUrl === 'string' && raw.avatarUrl !== '' ? { avatarUrl: raw.avatarUrl } : {},
  }
}

/** Map and dedupe the organizations, keeping a display name when GitHub sends one. */
function orgsOf(raw: { nodes?: (RawOrgRef | null)[] | null } | null | undefined): OrgRefVM[] {
  const orgs: OrgRefVM[] = []
  const seen = new Set<string>()
  for (const node of raw?.nodes ?? []) {
    if (node === null || typeof node.login !== 'string' || node.login === '') continue
    if (seen.has(node.login)) continue
    seen.add(node.login)
    orgs.push({
      login: node.login,
      ...typeof node.name === 'string' && node.name !== '' ? { name: node.name } : {},
    })
  }
  return orgs
}

/** Merge organization lists by login, keeping the display name when one side has it. */
function mergeOrgs(...lists: readonly OrgRefVM[][]): OrgRefVM[] {
  const merged = new Map<string, OrgRefVM>()
  for (const list of lists) {
    for (const org of list) {
      const existing = merged.get(org.login)
      const name = org.name ?? existing?.name
      merged.set(org.login, name === undefined ? { login: org.login } : { login: org.login, name })
    }
  }
  return [...merged.values()].sort((a, b) => a.login.localeCompare(b.login))
}

/** Append one repository page, deduping by `nameWithOwner`. */
function appendRepos(target: RepoRefVM[], page: RawRepoPage | null | undefined): void {
  const seen = new Set(target.map(repo => repo.nameWithOwner))
  for (const node of page?.nodes ?? []) {
    if (node === null || typeof node.nameWithOwner !== 'string' || node.nameWithOwner === '') continue
    if (seen.has(node.nameWithOwner)) continue
    seen.add(node.nameWithOwner)
    target.push({
      nameWithOwner: node.nameWithOwner,
      isPrivate: node.isPrivate === true,
      isFork: node.isFork === true,
      ...typeof node.pushedAt === 'string' && node.pushedAt !== '' ? { pushedAt: node.pushedAt } : {},
    })
  }
}

/** Append one project connection, deduping by node id. */
function appendProjects(
  target: ProjectRefVM[],
  connection: RawProjectConnection | null | undefined,
  owner: string | undefined,
): void {
  if (owner === undefined) return
  const seen = new Set(target.map(project => project.id))
  for (const node of connection?.nodes ?? []) {
    if (node === null) continue
    if (typeof node.id !== 'string' || node.id === '') continue
    if (typeof node.number !== 'number' || typeof node.title !== 'string' || typeof node.url !== 'string') continue
    if (seen.has(node.id)) continue
    seen.add(node.id)
    target.push({ id: node.id, number: node.number, title: node.title, url: node.url, owner })
  }
}

/** The GitHub client behind the plugin's contract. */
class GitHubApiClient implements GitHubApi {
  readonly host: string

  private readonly token: string
  private readonly endpoint: string
  private readonly baseSignal: AbortSignal | undefined
  private scopesCache: Timed<ScopeCatalog> | undefined
  private projectsBlocked = false
  private projectsError: string | undefined
  private readonly listCache = new Map<string, Timed<IssueListPage>>()
  private readonly detailCache = new Map<string, Timed<IssueDetailVM>>()
  private readonly orgReposCache = new Map<string, Timed<RepoPageVM>>()
  private readonly orgProjectsCache = new Map<string, Timed<{ projects: ProjectRefVM[]; blocked: boolean; error?: string }>>()

  /**
   * @param options - token, host, and an optional signal covering the session.
   */
  constructor(options: GitHubApiOptions) {
    this.host = options.host
    this.token = options.token
    this.endpoint = endpointFor(options.host)
    this.baseSignal = options.signal
  }

  /** The viewer's organizations and repositories, for the cascade's first level. */
  async scopes(signal?: AbortSignal): Promise<ScopeCatalog> {
    const cached = this.scopesCache
    if (cached !== undefined && Date.now() - cached.at < SCOPES_TTL_MS) return cached.data
    const catalog = await this.fetchScopes(signal)
    this.scopesCache = { at: Date.now(), data: catalog }
    return catalog
  }

  /** Projects v2 of one organization, loaded when the organization is chosen. */
  async orgProjects(
    org: string,
    signal?: AbortSignal,
  ): Promise<{ projects: ProjectRefVM[]; blocked: boolean; error?: string }> {
    const cached = this.orgProjectsCache.get(org)
    if (cached !== undefined && Date.now() - cached.at < SCOPES_TTL_MS) return cached.data
    const scopeMessage = projectsScopeMessage(this.host)
    if (this.projectsBlocked) {
      return { projects: [], blocked: true, error: this.projectsError ?? scopeMessage }
    }
    const body = await this.request(buildOrgProjectsQuery(org), signal)
    if (body.errors.some(isScopeError)) {
      this.projectsBlocked = true
      this.projectsError = scopeMessage
      return { projects: [], blocked: true, error: scopeMessage }
    }
    if (body.errors.some(isRateLimitError)) throw errorFromBody(body.errors, body.status)
    const data = (body.data ?? undefined) as RawOrgProjectsData | undefined
    const projects: ProjectRefVM[] = []
    appendProjects(projects, data?.organization?.projectsV2, org)
    const failure = body.errors.find(error => !isNotFoundError(error))
    const result = {
      projects,
      blocked: false,
      ...failure === undefined ? {} : { error: `Projects could not be read: ${firstMessage([failure]) ?? 'unknown error'}` },
    }
    this.orgProjectsCache.set(org, { at: Date.now(), data: result })
    return result
  }

  /**
   * One organization's repositories, forks included.
   * `organization.repositories` has no search argument, so up to four pages are
   * fetched and the browser filters the list by name.
   */
  async orgRepos(org: string, signal?: AbortSignal): Promise<RepoPageVM> {
    const cached = this.orgReposCache.get(org)
    if (cached !== undefined && Date.now() - cached.at < SCOPES_TTL_MS) return cached.data
    const items: RepoRefVM[] = []
    let totalCount = 0
    let after: string | null = null
    let hasNextPage = false
    for (let page = 0; page < 4; page += 1) {
      const data: RawOrgReposData = this.unwrap<RawOrgReposData>(await this.request(
        buildOrgReposQuery({ org, first: 100, after }),
        signal,
      ))
      const connection: RawRepoPage | null | undefined = data.organization?.repositories
      appendRepos(items, connection)
      if (typeof connection?.totalCount === 'number') totalCount = connection.totalCount
      const pageInfo: RawPageInfo | null | undefined = connection?.pageInfo
      hasNextPage = pageInfo?.hasNextPage === true
      const cursor: string | null | undefined = pageInfo?.endCursor
      after = typeof cursor === 'string' && cursor !== '' ? cursor : null
      if (!hasNextPage || after === null) break
    }
    const result: RepoPageVM = { items, totalCount, hasNextPage, endCursor: after }
    this.orgReposCache.set(org, { at: Date.now(), data: result })
    return result
  }

  /** One page of issues for the requested view. */
  async listIssues(request: IssueListRequest, signal?: AbortSignal): Promise<IssueListPage> {
    const normalized = normalizeListRequest(request)
    const key = listCacheKey(normalized)
    const cached = this.listCache.get(key)
    if (cached !== undefined && Date.now() - cached.at < LIST_TTL_MS) return cached.data
    const page = await this.fetchList(normalized, signal)
    this.listCache.set(key, { at: Date.now(), data: page })
    return page
  }

  /** One issue with its body, closing PRs, and cross-referenced PRs. */
  async issueDetail(repo: string, number: number, signal?: AbortSignal): Promise<IssueDetailVM> {
    const { owner, name } = splitRepo(repo)
    if (!Number.isInteger(number) || number <= 0) {
      throw new GitHubApiError(`invalid issue number "${String(number)}"`, 'invalid_issue')
    }
    const key = `${repo}#${String(number)}`
    const cached = this.detailCache.get(key)
    if (cached !== undefined && Date.now() - cached.at < DETAIL_TTL_MS) return cached.data
    const data = this.unwrap<RawDetailData>(await this.request(
      buildIssueDetailQuery({ owner, name, number }),
      signal,
    ))
    const issue = data.repository?.issue
    if (issue === null || issue === undefined) {
      throw new GitHubApiError(`issue ${key} was not found or is not accessible`, 'not_found', 404)
    }
    const detail = toIssueDetailVM(issue, issue.timelineItems?.nodes)
    this.detailCache.set(key, { at: Date.now(), data: detail })
    return detail
  }

  /** Drop cached responses; `all` (or no argument) also drops the scope catalog. */
  invalidate(scope?: 'list' | 'detail' | 'all'): void {
    if (scope === 'list') {
      this.listCache.clear()
      return
    }
    if (scope === 'detail') {
      this.detailCache.clear()
      return
    }
    this.scopesCache = undefined
    this.orgReposCache.clear()
    this.orgProjectsCache.clear()
    this.projectsBlocked = false
    this.projectsError = undefined
    this.listCache.clear()
    this.detailCache.clear()
  }

  /** Build the catalog: viewer, organizations (GraphQL + REST union), and repositories. */
  private async fetchScopes(signal?: AbortSignal): Promise<ScopeCatalog> {
    const core = await this.fetchScopeCore(signal)
    return {
      viewer: core.viewer,
      orgs: core.orgs,
      repos: core.repos,
      projectsBlocked: this.projectsBlocked,
      ...this.projectsError === undefined ? {} : { projectsError: this.projectsError },
    }
  }

  /** The viewer, organizations, and up to two pages of repositories. */
  private async fetchScopeCore(
    signal?: AbortSignal,
  ): Promise<{ viewer: ScopeCatalog['viewer']; orgs: OrgRefVM[]; repos: RepoRefVM[] }> {
    let data = this.unwrap<RawScopeData>(await this.request(buildScopeQuery(null), signal))
    const viewer = viewerOf(data.viewer)
    const graphOrgs = orgsOf(data.viewer?.organizations)
    const repos: RepoRefVM[] = []
    appendRepos(repos, data.viewer?.repositories)
    while (repos.length < MAX_SCOPE_REPOS) {
      const pageInfo = data.viewer?.repositories?.pageInfo
      if (pageInfo?.hasNextPage !== true) break
      const after = pageInfo.endCursor
      if (typeof after !== 'string' || after === '') break
      data = this.unwrap<RawScopeData>(await this.request(buildScopeQuery(after), signal))
      appendRepos(repos, data.viewer?.repositories)
    }
    // `viewer.organizations` reports public memberships only; the REST endpoint is
    // the one that includes private ones. A failure is not an error: a union of
    // whatever each source returned is still a better picker.
    const restOrgs = await this.restOrgs(signal)
    return { viewer, orgs: mergeOrgs(graphOrgs, restOrgs), repos }
  }

  /** Organizations as `/user/orgs` reports them (includes private memberships). */
  private async restOrgs(signal?: AbortSignal): Promise<OrgRefVM[]> {
    try {
      const base = this.host === 'github.com' ? 'https://api.github.com' : `https://${this.host}/api/v3`
      const effectiveSignal = signal ?? this.baseSignal
      const response = await fetch(`${base}/user/orgs?per_page=100`, {
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: 'application/vnd.github+json',
          'user-agent': USER_AGENT,
        },
        ...effectiveSignal === undefined ? {} : { signal: effectiveSignal },
      })
      if (!response.ok) return []
      const rows = await response.json() as { login?: unknown; name?: unknown }[]
      return rows
        .filter((row): row is { login: string; name?: unknown } => typeof row.login === 'string' && row.login !== '')
        .map(row => ({
          login: row.login,
          ...typeof row.name === 'string' && row.name !== '' ? { name: row.name } : {},
        }))
    } catch {
      return []
    }
  }

  /** Dispatch one request to the project, exact-repository, or search endpoint. */
  private async fetchList(
    request: NormalizedListRequest,
    signal?: AbortSignal,
  ): Promise<IssueListPage> {
    if (request.projectId !== undefined) return await this.fetchProjectList(request, signal)
    // A legacy repository request with no repository chosen answers with a hint
    // instead of listing the whole account.
    if (request.view === 'repo' && request.repos.length === 0) {
      return emptyPage('Select a repository to read its issues.')
    }
    // A legacy single-repository request keeps the exact `issues` connection (and
    // its authoritative totalCount); every cascade request is one search.
    if (request.view === 'repo' && request.repos.length === 1 && request.assignee === 'all') {
      return await this.fetchRepoList(request, signal)
    }
    return await this.fetchSearchList(request, signal)
  }

  /** A page from GitHub's search API, scoped by the cascade's qualifiers. */
  private async fetchSearchList(
    request: NormalizedListRequest,
    signal?: AbortSignal,
  ): Promise<IssueListPage> {
    const search = searchStringForFilters(request)
    const data = this.unwrap<RawSearchData>(await this.request(
      buildSearchIssuesQuery({ search, first: request.first, after: request.after }),
      signal,
    ))
    const connection = data.search
    const rateLimit = rateLimitOf(data.rateLimit)
    return {
      items: toCards(connection?.nodes),
      pageInfo: pageInfoOf(connection?.pageInfo),
      ...typeof connection?.issueCount === 'number' ? { totalCount: connection.issueCount } : {},
      ...rateLimit === undefined ? {} : { rateLimit },
    }
  }

  /** A page from one repository's exact `issues` connection. */
  private async fetchRepoList(
    request: NormalizedListRequest,
    signal?: AbortSignal,
  ): Promise<IssueListPage> {
    const [repo] = request.repos
    if (repo === undefined) return emptyPage('Select a repository to read its issues.')
    const { owner, name } = splitRepo(repo)
    const data = this.unwrap<RawRepoData>(await this.request(
      buildRepoIssuesQuery({
        owner,
        name,
        states: statesForView(request.state),
        first: request.first,
        after: request.after,
      }),
      signal,
    ))
    const issues = data.repository?.issues
    if (issues === null || issues === undefined) {
      throw new GitHubApiError(`repository ${repo} was not found or is not accessible`, 'not_found', 404)
    }
    const rateLimit = rateLimitOf(data.rateLimit)
    return {
      items: toCards(issues.nodes),
      pageInfo: pageInfoOf(issues.pageInfo),
      ...typeof issues.totalCount === 'number' ? { totalCount: issues.totalCount } : {},
      ...rateLimit === undefined ? {} : { rateLimit },
    }
  }

  /**
   * A page from one Projects v2 board.
   *
   * The state and assignee filters go to GitHub's own item filter (a 126-item
   * board returns its 25 open items instead of the first page of 30 filtered
   * locally). A repository filter has no server-side equivalent in the project
   * filter DSL, so matching pages are scanned until the page is full.
   */
  private async fetchProjectList(
    request: NormalizedListRequest,
    signal?: AbortSignal,
  ): Promise<IssueListPage> {
    if (this.projectsBlocked) return emptyPage(this.projectsError ?? projectsScopeMessage(this.host))
    if (request.projectId === undefined) return emptyPage('Select a project to read its issues.')
    const filter = projectItemsFilterFor(request)
    const wantedRepos = new Set(request.repos)
    const cards: IssueCardVM[] = []
    let cursor = request.after
    let totalCount: number | undefined
    let rateLimit: IssueListPage['rateLimit'] | undefined
    let pageInfo: RawPageInfo | null | undefined
    let scanned = 0
    for (;;) {
      let body: GraphQLResult
      try {
        body = await this.request(buildProjectItemsQuery({
          projectId: request.projectId,
          first: request.first,
          after: cursor,
          filter,
        }), signal)
      } catch (error) {
        if (error instanceof GitHubApiError && error.code === 'missing_scope') {
          this.projectsBlocked = true
          this.projectsError = projectsScopeMessage(this.host)
          return emptyPage(this.projectsError)
        }
        throw error
      }
      if (body.errors.some(isScopeError)) {
        this.projectsBlocked = true
        this.projectsError = projectsScopeMessage(this.host)
        return emptyPage(this.projectsError)
      }
      const data = this.unwrap<RawProjectItemsData>(body)
      const items = data.node?.items
      if (items === null || items === undefined) {
        throw new GitHubApiError(
          `project ${request.projectId} was not found or is not accessible`,
          'not_found',
          404,
        )
      }
      totalCount ??= typeof items.totalCount === 'number' ? items.totalCount : undefined
      rateLimit ??= rateLimitOf(data.rateLimit)
      for (const item of items.nodes ?? []) {
        const card = toProjectItemCardVM(item)
        if (card === undefined) continue
        if (wantedRepos.size > 0 && !wantedRepos.has(card.repo)) continue
        cards.push(card)
        if (cards.length >= request.first) break
      }
      pageInfo = items.pageInfo
      scanned += 1
      const next = pageInfo?.hasNextPage === true ? pageInfo.endCursor : null
      if (cards.length >= request.first || scanned >= 4 || typeof next !== 'string' || next === '') break
      cursor = next
    }
    return {
      items: cards,
      ...totalCount === undefined ? {} : { totalCount },
      ...rateLimit === undefined ? {} : { rateLimit },
      pageInfo: {
        hasNextPage: pageInfo?.hasNextPage === true,
        endCursor: pageInfo?.endCursor ?? null,
      },
    }
  }

  /** POST one GraphQL operation and read the response, classifying transport failures. */
  private async request(
    request: GitHubGraphQLRequest,
    signal?: AbortSignal,
  ): Promise<GraphQLResult> {
    const fetchImpl = globalFetch()
    if (fetchImpl === undefined) {
      throw new GitHubApiError(
        'This runtime has no fetch implementation; Node.js 18 or newer is required.',
        'network',
      )
    }
    const controller = new AbortController()
    const external = [this.baseSignal, signal]
      .filter((entry): entry is AbortSignal => entry !== undefined)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, REQUEST_TIMEOUT_MS)
    const forwardAbort = (): void => controller.abort()
    for (const entry of external) {
      if (entry.aborted) controller.abort()
      else entry.addEventListener('abort', forwardAbort, { once: true })
    }
    try {
      let response: GitHubResponse
      let text: string
      try {
        response = await fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        })
        text = await response.text()
      } catch (error) {
        if (timedOut) {
          throw new GitHubApiError(
            `The GitHub request timed out after ${String(REQUEST_TIMEOUT_MS / 1_000)} s.`,
            'network',
          )
        }
        const aborted = external.find(entry => entry.aborted)
        if (aborted !== undefined) throw abortReason(aborted)
        throw new GitHubApiError(`Could not reach GitHub: ${messageOf(error)}`, 'network')
      }
      return this.interpret(response.status, response.headers, text)
    } finally {
      clearTimeout(timer)
      for (const entry of external) entry.removeEventListener('abort', forwardAbort)
    }
  }

  /** Turn one HTTP answer into a GraphQL result or a classified error. */
  private interpret(status: number, headers: HeaderReader, text: string): GraphQLResult {
    const parsed = text.trim() === '' ? undefined : parseJson(text)
    const record = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
    const errors = rawErrorsOf(record?.errors)
    const topLevelMessage = typeof record?.message === 'string' && record.message !== '' ? record.message : undefined
    if (status === 401) {
      throw new GitHubApiError(
        'GitHub rejected the token (HTTP 401). The gh token may have expired; run: gh auth login',
        'unauthorized',
        401,
      )
    }
    if (status === 403 || status === 429) throw httpFailure(status, headers, text, errors, topLevelMessage)
    if (status === 404) {
      throw new GitHubApiError(firstMessage(errors) ?? topLevelMessage ?? 'GitHub returned HTTP 404 for the request.', 'not_found', 404)
    }
    if (status < 200 || status >= 300) {
      throw new GitHubApiError(`GitHub request failed with HTTP ${String(status)}.`, 'graphql', status)
    }
    if (record === undefined) {
      throw new GitHubApiError('GitHub returned a response that was not JSON.', 'graphql', status)
    }
    return { data: record.data, errors, status }
  }

  /** Throw the classified error of a GraphQL body, or return its data. */
  private unwrap<T>(result: GraphQLResult): T {
    const failure = errorFromBody(result.errors, result.status)
    if (failure !== undefined) throw failure
    if (result.data === undefined || result.data === null) {
      throw new GitHubApiError('GitHub returned no data for the request.', 'graphql', result.status)
    }
    return result.data as T
  }
}

/**
 * Create one GitHub API session.
 * The returned object caches responses for a few minutes and caches the resolved
 * scope catalog for five, so the caller may create it once per resolved token.
 * @param options - the token, host, and optional session-wide abort signal.
 * @returns the API the controller forwards to.
 */
export function createGitHubApi(options: GitHubApiOptions): GitHubApi {
  return new GitHubApiClient(options)
}
