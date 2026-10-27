/**
 * Shared view-model types for both halves of the plugin.
 *
 * The Host assembles these from GitHub's GraphQL responses; the browser renders
 * them without knowing anything about GraphQL. Keeping them in one module is what
 * lets the two halves be built and tested separately.
 *
 * @module dsh-plugin-github-issues/vm
 */

/** One issue's state as GitHub reports it. */
export type IssueState = 'OPEN' | 'CLOSED'

/** Why an issue is closed; `null` while open. */
export type StateReason = 'COMPLETED' | 'NOT_PLANNED' | 'DUPLICATE' | 'REOPENED' | null

/** Where a rendered priority came from, so the UI can say why it shows that value. */
export type PrioritySource = 'project' | 'issue-field' | 'label'

/** Rolled-up check state of a linked pull request. */
export type CheckState =
  | 'SUCCESS'
  | 'FAILURE'
  | 'ERROR'
  | 'PENDING'
  | 'EXPECTED'
  | 'NEUTRAL'
  | 'SKIPPED'
  | null

/** Review decision of a linked pull request; `null` when reviews are not required. */
export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null

/** State of a pull request as GitHub reports it. */
export type PullRequestState = 'OPEN' | 'CLOSED' | 'MERGED'

/** One label with GitHub's bare hex color (no leading `#`). */
export interface LabelVM {
  name: string
  color: string
}

/** One assignee. */
export interface AssigneeVM {
  login: string
  avatarUrl?: string
}

/** One milestone with its completion percentage. */
export interface MilestoneVM {
  title: string
  dueOn: string | null
  state: 'OPEN' | 'CLOSED'
  progress: number | null
}

/** GitHub's issue type (org-defined, may be absent). */
export interface IssueTypeVM {
  name: string
  color?: string
}

/** The rendered priority and its source. */
export interface PriorityVM {
  source: PrioritySource
  name: string
  color?: string
}

/** One Projects v2 single-select field value (Status and friends). */
export interface ProjectFieldValueVM {
  name: string
  color?: string
}

/** One pull request linked to an issue. */
export interface LinkedPRVM {
  number: number
  title: string
  url: string
  state: PullRequestState
  isDraft: boolean
  merged: boolean
  reviewDecision: ReviewDecision
  checks: CheckState
  failingChecks?: string[]
  author?: string
}

/** One issue as a list row renders it. */
export interface IssueCardVM {
  /** GitHub node id, used as a stable React key and for merge/dedupe. */
  id: string
  /** `owner/name`. */
  repo: string
  number: number
  title: string
  url: string
  state: IssueState
  stateReason: StateReason
  isPrivate: boolean
  issueType?: IssueTypeVM
  labels: LabelVM[]
  milestone?: MilestoneVM
  assignees: AssigneeVM[]
  /** ISO 8601. */
  updatedAt: string
  commentCount: number
  bodyExcerpt?: string
  priority?: PriorityVM
  /** PRs closed by this issue (best effort, cheap nested connection). */
  linkedPRs: LinkedPRVM[]
  /** Projects v2 Status value, when the card came from a project view. */
  projectStatus?: ProjectFieldValueVM
  /** Sessions this issue has been handed to (newest last). */
  sessionLinks?: IssueSessionLinkVM[]
}

/** One issue's full detail. */
export interface IssueDetailVM extends IssueCardVM {
  body: string
  /** PRs that mention this issue without closing it (`timelineItems` cross-references). */
  mentionedPRs: LinkedPRVM[]
}

/** One Session this issue has been handed to. */
export interface IssueSessionLinkVM {
  sessionId: string
  /** Milliseconds since epoch when the handoff was recorded. */
  at: number
}

/** One persisted issue → session link. */
export interface IssueLinkRecord {
  repo: string
  number: number
  sessionId: string
  at: number
}

/** One page of the list. */
export interface IssueListPage {
  items: IssueCardVM[]
  totalCount?: number
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
  rateLimit?: { cost?: number; remaining?: number }
  /** A non-fatal note, e.g. Projects v2 unavailable because of a missing scope. */
  notice?: string
}

/** The list views the panel offers. */
export type ListView = 'assigned' | 'created' | 'open' | 'repo' | 'project'

/**
 * One list request from the browser.
 *
 * The scope is a cascade, not a view enum: an organization narrows the search to
 * `org:<login>`, a project switches to Projects v2 items, and a repository adds a
 * `repo:` qualifier (or filters the project's items by content repository). Any
 * combination is legal; an empty scope means "everything the token can read".
 */
export interface IssueListRequest {
  /** Legacy single-purpose view; the cascade UI sends the fields below instead. */
  view?: ListView
  /** Organization scope (`org:<login>` in search, owner for project/repo lookups). */
  org?: string
  /** Repository scope: `owner/name` values. */
  repos?: string[]
  /** Projects v2 node id. */
  projectId?: string
  /** Assignee qualifier: `@me`, `all` (no qualifier), or a GitHub login. */
  assignee?: string
  /** Author qualifier (legacy "created by me"). */
  author?: string
  /** Open/closed/all filter. */
  state?: 'open' | 'closed' | 'all'
  first?: number
  after?: string | null
}

/** One organization (or the viewer's personal account) in the scope picker. */
export interface OrgRefVM {
  login: string
  /** Display name, when GitHub reports one. */
  name?: string
}

/** One repository in the scope picker. */
export interface RepoRefVM {
  nameWithOwner: string
  isPrivate: boolean
  pushedAt?: string
  /** Whether this repository is a fork (kept in the list, marked in the UI). */
  isFork?: boolean
}

/** One page of a repository listing. */
export interface RepoPageVM {
  items: RepoRefVM[]
  totalCount: number
  hasNextPage: boolean
  endCursor: string | null
}

/** One Projects v2 project in the scope picker. */
export interface ProjectRefVM {
  id: string
  number: number
  title: string
  url: string
  owner: string
}

/** Everything the scope pickers need. */
export interface ScopeCatalog {
  viewer: { login: string; avatarUrl?: string } | null
  /** Organizations the token can see, including private memberships. */
  orgs: OrgRefVM[]
  /** The viewer's repositories (forks included); org repositories load on demand. */
  repos: RepoRefVM[]
  /** True when projects could not be read because the token lacks `read:project`. */
  projectsBlocked: boolean
  projectsError?: string
}

/** What the settings page renders about auth. */
export interface GitHubStatus {
  mode: 'gh'
  ghInstalled: boolean
  ghPath?: string
  signedIn: boolean
  login?: string
  host: string
  tokenSource?: string
  scopes: string[]
  missingProjectScope: boolean
  config: {
    authMode: string
    host: string
    handoffMode: string
    pollSeconds: number
  }
  error?: string
}

/** Preferences owned by the Host (persisted in the plugin's state file). */
export interface Prefs {
  /** Legacy view key, migrated to the cascade fields on load. */
  view?: ListView | undefined
  /** Selected organization (`undefined` means all organizations). */
  org?: string | undefined
  /** Selected Projects v2 node id. */
  projectId?: string | undefined
  /** Selected repository `owner/name` (filter within the org or the project). */
  repo?: string | undefined
  /** Assignee filter: `@me`, `all`, or a GitHub login. */
  assignee: string
  /** Issue state filter. */
  state: 'open' | 'closed' | 'all'
  /** What a handoff does by default: fill the draft, or send it. */
  handoffMode: 'draft' | 'send'
  /** Template used to turn an issue into an agent prompt. */
  promptTemplate: string
  /** The issue the composer dock shows. */
  pinned?: { repo: string; number: number } | undefined
}

/** The prompt a handoff writes into the composer. */
export const DEFAULT_PROMPT_TEMPLATE = [
  '处理 GitHub Issue：{{repo}}#{{number}} {{title}}',
  '链接：{{url}}',
  '状态：{{state}} ｜ 里程碑：{{milestone}} ｜ 优先级：{{priority}} ｜ 指派：{{assignees}}',
  '标签：{{labels}}',
  '关联 PR：{{prs}}',
  '要求：先读 Issue 正文与关联 PR，确认验收标准后再动手；用 subagent_codex 执行具体改动，完成后跑相关测试并回报。',
].join('\n')

/** Default preferences for a fresh install: everything assigned to me that is open. */
export const DEFAULT_PREFS: Prefs = {
  org: undefined,
  projectId: undefined,
  repo: undefined,
  assignee: '@me',
  state: 'open',
  handoffMode: 'draft',
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  pinned: undefined,
}

/** Build preferences from the deployment config and whatever was saved. */
export function mergePrefs(
  saved: Partial<Prefs> | undefined,
  configHandoffMode: string | undefined,
  configTemplate: string | undefined,
): Prefs {
  const handoff = saved?.handoffMode
    ?? (configHandoffMode === 'send' ? 'send' : 'draft')
  return {
    ...DEFAULT_PREFS,
    ...saved,
    handoffMode: handoff,
    promptTemplate: saved?.promptTemplate
      ?? (configTemplate === undefined || configTemplate === '' ? DEFAULT_PROMPT_TEMPLATE : configTemplate),
  }
}
