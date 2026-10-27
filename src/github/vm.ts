/**
 * Pure mapping from GitHub's GraphQL wire shapes to the shared view models.
 *
 * Nothing here performs I/O or touches a transport: a raw node goes in, a
 * renderable value comes out. Keeping the mapping pure is what lets the layout
 * rules (priority precedence, check glyphs, excerpt length) be tested against
 * the trimmed JSON captured in the research notes instead of a live API.
 *
 * Raw shapes are deliberately loose — every field is optional and nullable — so
 * a partial or aliased response maps to something sensible rather than crashing
 * the panel.
 *
 * @module dsh-plugin-github-issues/github/vm
 */

import type {
  AssigneeVM, CheckState, IssueCardVM, IssueDetailVM, IssueState, IssueTypeVM, LabelVM,
  LinkedPRVM, MilestoneVM, PriorityVM, PullRequestState, ReviewDecision, StateReason,
} from '../vm.ts'

/** The repository reference embedded in an issue or pull request node. */
export interface RawRepositoryRef {
  /** `owner/name`. */
  nameWithOwner?: string | null
  /** Whether the repository is private (drives the lock glyph). */
  isPrivate?: boolean | null
}

/** One label as GraphQL returns it. */
export interface RawLabel {
  name?: string | null
  /** Bare hex color, no leading `#`. */
  color?: string | null
}

/** One assignee as GraphQL returns it. */
export interface RawAssignee {
  login?: string | null
  /** Avatar URL, requested at 32 px. */
  avatarUrl?: string | null
}

/** One milestone as GraphQL returns it. */
export interface RawMilestone {
  title?: string | null
  dueOn?: string | null
  state?: string | null
  progressPercentage?: number | null
}

/** GitHub's org-defined issue type. */
export interface RawIssueType {
  name?: string | null
  /** A `IssueTypeColor` enum name, e.g. `RED`; not a hex value. */
  color?: string | null
}

/** One check-run entry of a pull request's status rollup. */
export interface RawCheckRun {
  __typename?: string | null
  name?: string | null
  status?: string | null
  conclusion?: string | null
}

/** One legacy commit-status entry of a pull request's status rollup. */
export interface RawStatusContext {
  __typename?: string | null
  context?: string | null
  state?: string | null
}

/** Either kind of entry in `statusCheckRollup.contexts.nodes`. */
export type RawCheckContext = RawCheckRun | RawStatusContext

/** A pull request's rolled-up check state and its individual contexts. */
export interface RawStatusCheckRollup {
  state?: string | null
  contexts?: { nodes?: (RawCheckContext | null)[] | null } | null
}

/** A pull request linked to an issue, from either a closing link or a cross-reference. */
export interface RawLinkedPR {
  number?: number | null
  title?: string | null
  url?: string | null
  state?: string | null
  isDraft?: boolean | null
  merged?: boolean | null
  reviewDecision?: string | null
  updatedAt?: string | null
  author?: { login?: string | null } | null
  statusCheckRollup?: RawStatusCheckRollup | null
}

/** One org Issue Field value on an issue (`issueFieldValues.nodes`). */
export interface RawIssueFieldValue {
  __typename?: string | null
  name?: string | null
  /** A `IssueFieldSingleSelectValue` color enum name, e.g. `RED`. */
  color?: string | null
  /** The field definition this value belongs to; only its name is requested. */
  field?: { name?: string | null } | null
}

/** The `issueFieldValues` connection embedded in an issue node. */
export interface RawIssueFieldValues {
  nodes?: (RawIssueFieldValue | null)[] | null
}

/** An issue node as the list and detail queries select it. */
export interface RawIssue {
  /** GraphQL type name, selected where a union has to be told apart. */
  __typename?: string | null
  id?: string | null
  number?: number | null
  title?: string | null
  url?: string | null
  state?: string | null
  stateReason?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  issueType?: RawIssueType | null
  repository?: RawRepositoryRef | null
  labels?: { nodes?: (RawLabel | null)[] | null } | null
  milestone?: RawMilestone | null
  assignees?: { nodes?: (RawAssignee | null)[] | null } | null
  comments?: { totalCount?: number | null } | null
  body?: string | null
  closedByPullRequestsReferences?: { nodes?: (RawLinkedPR | null)[] | null } | null
  issueFieldValues?: RawIssueFieldValues | null
}

/** One `timelineItems` entry; only cross-referenced events are requested. */
export interface RawTimelineItem {
  __typename?: string | null
  /** The referencing object; only a `PullRequest` source becomes a mentioned PR. */
  source?: (RawLinkedPR & { __typename?: string | null }) | null
}

/** A project item's `Priority` field value (`fieldValueByName`). */
export interface RawProjectFieldValue {
  __typename?: string | null
  /** Single-select option name. */
  name?: string | null
  /** Single-select option color enum, e.g. `RED`. */
  color?: string | null
  /** Text field value. */
  text?: string | null
  /** Number field value. */
  number?: number | null
  /** Date field value. */
  date?: string | null
}

/**
 * Project item content, selected through the `Issue | PullRequest | DraftIssue`
 * union. Fields that only one branch owns are optional, and a stale pull
 * request's `state` can be `MERGED`; drafts are skipped by the mapper.
 */
export interface RawProjectItemContent extends RawIssue {
  isDraft?: boolean | null
  merged?: boolean | null
}

/** One Projects v2 item. */
export interface RawProjectItem {
  id?: string | null
  /** `ISSUE | PULL_REQUEST | DRAFT_ISSUE | REDACTED`. */
  type?: string | null
  content?: RawProjectItemContent | null
  priority?: RawProjectFieldValue | null
  /** The project's `Status` single-select value, when defined on the board. */
  status?: RawProjectFieldValue | null
}

/** Conclusions that mean "this check needs a human before merging". */
const FAILING_CONCLUSIONS: ReadonlySet<string> = new Set([
  'FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED',
])

/** Commit-status states that mean failure. */
const FAILING_STATUSES: ReadonlySet<string> = new Set(['FAILURE', 'ERROR'])

/** The reason a closed issue carries, restricted to the states the UI renders. */
function stateReasonOf(value: string | null | undefined): StateReason {
  switch (value) {
    case 'COMPLETED': return 'COMPLETED'
    case 'NOT_PLANNED': return 'NOT_PLANNED'
    case 'DUPLICATE': return 'DUPLICATE'
    case 'REOPENED': return 'REOPENED'
    default: return null
  }
}

/**
 * Map GitHub's issue/PR state to the two-state view.
 * A merged pull request renders as closed, because the card has no separate
 * merged state (the PR's own `merged` flag is only on {@link LinkedPRVM}).
 */
function issueStateOf(value: string | null | undefined): IssueState {
  return value === 'CLOSED' || value === 'MERGED' ? 'CLOSED' : 'OPEN'
}

/** Map a raw milestone to its view model, or `undefined` when the issue has none. */
export function toMilestoneVM(node: RawMilestone | null | undefined): MilestoneVM | undefined {
  if (node === null || node === undefined || typeof node.title !== 'string' || node.title === '') return undefined
  return {
    title: node.title,
    dueOn: typeof node.dueOn === 'string' ? node.dueOn : null,
    state: node.state === 'CLOSED' ? 'CLOSED' : 'OPEN',
    progress: typeof node.progressPercentage === 'number' ? node.progressPercentage : null,
  }
}

/** Map a label connection to view models, dropping malformed entries. */
export function toLabelVMs(nodes: readonly (RawLabel | null)[] | null | undefined): LabelVM[] {
  const labels: LabelVM[] = []
  for (const node of nodes ?? []) {
    if (node === null || typeof node.name !== 'string' || node.name === '') continue
    labels.push({ name: node.name, color: typeof node.color === 'string' ? node.color : '' })
  }
  return labels
}

/** Map an assignee connection to view models, dropping entries without a login. */
export function toAssigneeVMs(nodes: readonly (RawAssignee | null)[] | null | undefined): AssigneeVM[] {
  const assignees: AssigneeVM[] = []
  for (const node of nodes ?? []) {
    if (node === null || typeof node.login !== 'string' || node.login === '') continue
    assignees.push({
      login: node.login,
      ...typeof node.avatarUrl === 'string' && node.avatarUrl !== '' ? { avatarUrl: node.avatarUrl } : {},
    })
  }
  return assignees
}

/** Map the issue-type node, or `undefined` where the org has not enabled types. */
function toIssueTypeVM(node: RawIssueType | null | undefined): IssueTypeVM | undefined {
  if (node === null || node === undefined || typeof node.name !== 'string' || node.name === '') return undefined
  return {
    name: node.name,
    ...typeof node.color === 'string' && node.color !== '' ? { color: node.color } : {},
  }
}

/** Map the rolled-up check state, or `null` when GitHub reports none. */
export function checkStateOf(rollup: RawStatusCheckRollup | null | undefined): CheckState {
  switch (rollup?.state) {
    case 'SUCCESS': return 'SUCCESS'
    case 'FAILURE': return 'FAILURE'
    case 'ERROR': return 'ERROR'
    case 'PENDING': return 'PENDING'
    case 'EXPECTED': return 'EXPECTED'
    case 'NEUTRAL': return 'NEUTRAL'
    case 'SKIPPED': return 'SKIPPED'
    default: return null
  }
}

/**
 * The names of checks that failed, at most five.
 * Check runs fail on a terminal bad conclusion; legacy statuses fail on
 * `FAILURE` or `ERROR`. Pending checks are not counted as failing.
 */
export function failingChecksOf(rollup: RawStatusCheckRollup | null | undefined): string[] {
  const failing: string[] = []
  for (const node of rollup?.contexts?.nodes ?? []) {
    if (node === null) continue
    if ('context' in node) {
      if (typeof node.context === 'string' && FAILING_STATUSES.has(node.state ?? '')) failing.push(node.context)
    } else if ('name' in node) {
      if (typeof node.name === 'string' && FAILING_CONCLUSIONS.has(node.conclusion ?? '')) failing.push(node.name)
    }
    if (failing.length >= 5) break
  }
  return failing.slice(0, 5)
}

/** Map one linked pull request, including its check glyph inputs. */
export function toLinkedPRVM(node: RawLinkedPR): LinkedPRVM {
  const state: PullRequestState = node.state === 'MERGED'
    ? 'MERGED'
    : node.state === 'CLOSED' ? 'CLOSED' : 'OPEN'
  const reviewDecision: ReviewDecision = node.reviewDecision === 'APPROVED'
    || node.reviewDecision === 'CHANGES_REQUESTED'
    || node.reviewDecision === 'REVIEW_REQUIRED'
    ? node.reviewDecision
    : null
  const failingChecks = failingChecksOf(node.statusCheckRollup)
  return {
    number: typeof node.number === 'number' ? node.number : 0,
    title: typeof node.title === 'string' ? node.title : '',
    url: typeof node.url === 'string' ? node.url : '',
    state,
    isDraft: node.isDraft === true,
    merged: node.merged === true,
    reviewDecision,
    checks: checkStateOf(node.statusCheckRollup),
    ...failingChecks.length === 0 ? {} : { failingChecks },
    ...typeof node.author?.login === 'string' && node.author.login !== '' ? { author: node.author.login } : {},
  }
}

/** Map a linked-PR connection, dropping malformed entries. */
function toLinkedPRVMs(nodes: readonly (RawLinkedPR | null)[] | null | undefined): LinkedPRVM[] {
  const pullRequests: LinkedPRVM[] = []
  for (const node of nodes ?? []) {
    if (node === null) continue
    pullRequests.push(toLinkedPRVM(node))
  }
  return pullRequests
}

/**
 * Read the `Priority` value out of a project item's `fieldValueByName` answer.
 * Single-select values carry a name and a color enum; text and number fields
 * are accepted as names too, because a project may model priority either way.
 */
export function priorityFromProjectValue(
  value: RawProjectFieldValue | null | undefined,
): PriorityVM | undefined {
  if (value === null || value === undefined) return undefined
  const name = typeof value.name === 'string' && value.name !== ''
    ? value.name
    : typeof value.text === 'string' && value.text !== ''
      ? value.text
      : typeof value.number === 'number' ? String(value.number) : undefined
  if (name === undefined) return undefined
  return {
    source: 'project',
    name,
    ...typeof value.color === 'string' && value.color !== '' ? { color: value.color } : {},
  }
}

/** Read the org-level Issue Field named `Priority`, when the issue has a value. */
export function priorityFromIssueFields(
  values: RawIssueFieldValues | null | undefined,
): PriorityVM | undefined {
  for (const value of values?.nodes ?? []) {
    if (value === null) continue
    const fieldName = value.field?.name
    if (typeof fieldName !== 'string' || fieldName.toLowerCase() !== 'priority') continue
    if (typeof value.name !== 'string' || value.name === '') continue
    return {
      source: 'issue-field',
      name: value.name,
      ...typeof value.color === 'string' && value.color !== '' ? { color: value.color } : {},
    }
  }
  return undefined
}

/**
 * Fall back to a `P0`..`P4` label.
 * When a repository somehow carries several such labels, the lowest number wins
 * (P0 is the highest priority); the label's own bare hex color is carried along.
 */
export function priorityFromLabels(
  labels: readonly (RawLabel | null)[] | null | undefined,
): PriorityVM | undefined {
  let best: RawLabel | undefined
  let bestRank = Number.POSITIVE_INFINITY
  for (const label of labels ?? []) {
    if (label === null || typeof label.name !== 'string') continue
    if (!/^P[0-4]$/i.test(label.name)) continue
    const rank = Number.parseInt(label.name.slice(1), 10)
    if (rank >= bestRank) continue
    best = label
    bestRank = rank
  }
  if (best === undefined) return undefined
  return {
    source: 'label',
    name: best.name as string,
    ...typeof best.color === 'string' && best.color !== '' ? { color: best.color } : {},
  }
}

/**
 * Pick the rendered priority by source precedence:
 * project field, then org Issue Field, then label.
 * @param project - priority read from the containing project item.
 * @param issueField - priority read from the issue's org fields.
 * @param label - priority read from `P0`..`P4` labels.
 * @returns the first defined value, or `undefined` when no source has one.
 */
export function pickPriority(
  project?: PriorityVM | undefined,
  issueField?: PriorityVM | undefined,
  label?: PriorityVM | undefined,
): PriorityVM | undefined {
  return project ?? issueField ?? label
}

/**
 * Turn an issue body into a one-line preview.
 * Headings, images, links, and fences are reduced to their text, whitespace is
 * collapsed, and the result is cut at `max` characters with an ellipsis.
 * @param body - the issue body as returned by the API.
 * @param max - the excerpt budget in characters.
 * @returns the excerpt, or `undefined` when the body has no text.
 */
export function bodyExcerpt(body: string, max = 200): string | undefined {
  if (typeof body !== 'string' || body.trim() === '') return undefined
  let text = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/```[a-zA-Z0-9_-]*/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text === '') return undefined
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

/** Options the containing surface adds to the generic issue card mapping. */
export interface IssueCardOptions {
  /**
   * Priority read from the containing project item.
   * It outranks the issue's own org fields and labels.
   */
  projectPriority?: PriorityVM | undefined
}

/**
 * Map one issue node to the list-row view model.
 * @param node - an issue node from a search, repository, or project query.
 * @param options - project context, when the node came from a project item.
 * @returns the card the panel renders.
 */
export function toIssueCardVM(node: RawIssue, options: IssueCardOptions = {}): IssueCardVM {
  const issueType = toIssueTypeVM(node.issueType)
  const milestone = toMilestoneVM(node.milestone)
  const body = typeof node.body === 'string' ? node.body : ''
  const excerpt = bodyExcerpt(body)
  const priority = pickPriority(
    options.projectPriority,
    priorityFromIssueFields(node.issueFieldValues),
    priorityFromLabels(node.labels?.nodes),
  )
  return {
    id: typeof node.id === 'string' ? node.id : '',
    repo: typeof node.repository?.nameWithOwner === 'string' ? node.repository.nameWithOwner : '',
    number: typeof node.number === 'number' ? node.number : 0,
    title: typeof node.title === 'string' ? node.title : '',
    url: typeof node.url === 'string' ? node.url : '',
    state: issueStateOf(node.state),
    stateReason: stateReasonOf(node.stateReason),
    isPrivate: node.repository?.isPrivate === true,
    labels: toLabelVMs(node.labels?.nodes),
    assignees: toAssigneeVMs(node.assignees?.nodes),
    updatedAt: typeof node.updatedAt === 'string' ? node.updatedAt : '',
    commentCount: typeof node.comments?.totalCount === 'number' ? node.comments.totalCount : 0,
    linkedPRs: toLinkedPRVMs(node.closedByPullRequestsReferences?.nodes),
    ...issueType === undefined ? {} : { issueType },
    ...milestone === undefined ? {} : { milestone },
    ...excerpt === undefined ? {} : { bodyExcerpt: excerpt },
    ...priority === undefined ? {} : { priority },
  }
}

/** Map a `timelineItems` connection to mentioned PRs, dropping duplicates and closers. */
function mentionedPRsOf(
  crossRefs: readonly (RawTimelineItem | null)[] | null | undefined,
  closingNumbers: ReadonlySet<number>,
): LinkedPRVM[] {
  const mentioned: LinkedPRVM[] = []
  const seen = new Set<number>()
  for (const item of crossRefs ?? []) {
    if (item === null || item.__typename !== 'CrossReferencedEvent') continue
    const source = item.source
    if (source === null || source === undefined || source.__typename !== 'PullRequest') continue
    const pullRequest = toLinkedPRVM(source)
    if (pullRequest.number <= 0) continue
    if (closingNumbers.has(pullRequest.number) || seen.has(pullRequest.number)) continue
    seen.add(pullRequest.number)
    mentioned.push(pullRequest)
  }
  return mentioned
}

/**
 * Map one issue node plus its cross-references to the detail view.
 * `mentionedPRs` excludes PRs that already appear as closing references, since
 * the panel renders those separately.
 * @param node - the issue node from the detail query.
 * @param crossRefs - the issue's `timelineItems.nodes` (cross-referenced events).
 * @returns the detail the composer dock renders.
 */
export function toIssueDetailVM(
  node: RawIssue,
  crossRefs: readonly (RawTimelineItem | null)[] | null | undefined,
): IssueDetailVM {
  const card = toIssueCardVM(node)
  const closingNumbers = new Set(card.linkedPRs.map(pullRequest => pullRequest.number))
  return {
    ...card,
    body: typeof node.body === 'string' ? node.body : '',
    mentionedPRs: mentionedPRsOf(crossRefs, closingNumbers),
  }
}

/**
 * Map one Projects v2 item to a card.
 * Draft issues and redacted items have no repository or number and are
 * skipped; pull requests are rendered as issue-like cards, closed when merged.
 * @param item - one node of a project's `items` connection.
 * @returns the card, or `undefined` when the item is not renderable.
 */
export function toProjectItemCardVM(item: RawProjectItem | null | undefined): IssueCardVM | undefined {
  if (item === null || item === undefined) return undefined
  const content = item.content
  if (content === null || content === undefined) return undefined
  if (content.__typename !== 'Issue' && content.__typename !== 'PullRequest') return undefined
  const projectPriority = priorityFromProjectValue(item.priority)
  const card = toIssueCardVM(content, projectPriority === undefined ? {} : { projectPriority })
  const status = item.status
  if (status !== null && status !== undefined && typeof status.name === 'string' && status.name !== '') {
    return {
      ...card,
      projectStatus: {
        name: status.name,
        ...typeof status.color === 'string' && status.color !== '' ? { color: status.color } : {},
      },
    }
  }
  return card
}
