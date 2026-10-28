/**
 * The Host-side GitHub contract.
 *
 * Pure data in and pure data out: no Cordis types, no transport, no Node imports
 * beyond the standard library, so the implementation is testable with a fake
 * fetch and the Remote controller stays a thin forwarding layer.
 *
 * @module dsh-plugin-github-issues/github/types
 */

import type {
  IssueBodyVM, IssueCardVM, IssueDetailVM, IssueListPage, IssueListRequest, LinkedPRVM,
  OrgRefVM, ProjectRefVM, RepoPageVM, ScopeCatalog,
} from '../vm.ts'

/** A token resolved from the machine's `gh` CLI. */
export interface ResolvedAuth {
  token: string
  /** Where the token came from, for the settings card. */
  source: 'gh'
  host: string
  login?: string
  scopes: string[]
}

/** What `gh auth status` says about this machine, without ever exposing the token. */
export interface GhProbe {
  installed: boolean
  path?: string
  signedIn: boolean
  login?: string
  host?: string
  tokenSource?: string
  scopes: string[]
  error?: string
}

/** Options both the probe and the token resolver share. */
export interface GitHubAuthOptions {
  host: string
  /** Explicit `gh` executable path from Config, when the default lookup fails. */
  ghPath?: string
  signal?: AbortSignal
}

/** Options for one GitHub API session. */
export interface GitHubApiOptions extends GitHubAuthOptions {
  token: string
}

/** A classified failure, so the UI can tell "missing scope" from "network down". */
export class GitHubApiError extends Error {
  readonly code: string
  readonly status: number | undefined

  constructor(message: string, code: string, status?: number) {
    super(message)
    this.name = 'GitHubApiError'
    this.code = code
    this.status = status
  }
}

/** The GitHub operations the panel needs. */
export interface GitHubApi {
  readonly host: string
  /** Repositories, organizations, and the signed-in viewer. */
  scopes(signal?: AbortSignal): Promise<ScopeCatalog>
  /** Projects v2 for one organization; a missing scope degrades to `blocked`. */
  orgProjects(org: string, signal?: AbortSignal): Promise<{ projects: ProjectRefVM[]; blocked: boolean; error?: string }>
  /** The organization's repositories (forks included, capped in the implementation). */
  orgRepos(org: string, signal?: AbortSignal): Promise<RepoPageVM>
  /** One page of issues for a list view. */
  listIssues(request: IssueListRequest, signal?: AbortSignal): Promise<IssueListPage>
  /** One issue with its body and linked pull requests (no timeline). */
  issueDetail(repo: string, number: number, signal?: AbortSignal): Promise<IssueBodyVM>
  /** The issue's cross-referenced pull requests; the lazy slow leg of the detail. */
  issueMentionedPRs(repo: string, number: number, signal?: AbortSignal): Promise<{ mentionedPRs: LinkedPRVM[] }>
  /** Drop cached responses for the next call to refetch. */
  invalidate(scope?: 'list' | 'detail' | 'all'): void
}

/** Split `owner/name` and reject malformed values before they reach GraphQL. */
export function splitRepo(repo: string): { owner: string; name: string } {
  const slash = repo.indexOf('/')
  if (slash <= 0 || slash === repo.length - 1 || repo.indexOf('/', slash + 1) !== -1) {
    throw new GitHubApiError(`invalid repository "${repo}"; expected "owner/name"`, 'invalid_repo')
  }
  return { owner: repo.slice(0, slash), name: repo.slice(slash + 1) }
}

/** The subset of an issue card the prompt formatter needs. */
export type PromptIssue = Pick<
  IssueCardVM,
  'repo' | 'number' | 'title' | 'url' | 'state' | 'stateReason' | 'labels' | 'milestone' | 'assignees' | 'priority' | 'linkedPRs'
>
