/**
 * The GraphQL documents and variable builders the Host sends to GitHub.
 *
 * Queries are built per view instead of as one mega-document on purpose: a
 * schema mismatch or a missing scope in one view must not break the others, and
 * the search, repository, project, and detail endpoints accept different
 * arguments. All documents are static text plus variables, except the project
 * discovery query, whose organization aliases are generated from the viewer's
 * organization list.
 *
 * Everything here is pure: no fetch, no token, no Node imports.
 *
 * @module dsh-plugin-github-issues/github/queries
 */

import type { IssueListRequest, IssueState, ListView } from '../vm.ts'
import { splitRepo } from './types.ts'

/** One GraphQL operation ready to POST: the document and its variables. */
export interface GitHubGraphQLRequest {
  query: string
  variables: Record<string, unknown>
}

/** The list views that are served by GitHub's search API. */
export type SearchView = Exclude<ListView, 'project'>

/** How many repositories the project picker queries per owner; bounds the point cost. */
const PROJECTS_PER_OWNER = 20

/**
 * The pull-request fragment shared by list, detail, and project documents.
 * `statusCheckRollup.contexts` is capped at 20 types; the mapper derives the
 * glyph and the failing-check names from what arrives.
 */
const LINKED_PR_FRAGMENT = `fragment LinkedPRFields on PullRequest {
  number
  title
  url
  state
  isDraft
  merged
  reviewDecision
  updatedAt
  author { login }
  statusCheckRollup {
    state
    contexts(first: 20) {
      nodes {
        __typename
        ... on CheckRun { name status conclusion }
        ... on StatusContext { context state }
      }
    }
  }
}`

/**
 * Every field a card needs, selected on `Issue`.
 * A body is requested here as well: the card shows a client-side excerpt, and
 * GraphQL has no server-side excerpt to ask for.
 */
const ISSUE_CARD_FRAGMENT = `fragment IssueCardFields on Issue {
  id
  number
  title
  url
  state
  stateReason
  createdAt
  updatedAt
  issueType { name color }
  repository { nameWithOwner isPrivate }
  labels(first: 10) { nodes { name color } }
  milestone { title dueOn state progressPercentage }
  assignees(first: 5) { nodes { login avatarUrl(size: 32) } }
  comments { totalCount }
  body
  closedByPullRequestsReferences(first: 5) {
    nodes { ...LinkedPRFields }
  }
  issueFieldValues(first: 10) {
    nodes {
      __typename
      ... on IssueFieldSingleSelectValue {
        name
        color
        field { ... on IssueFieldSingleSelect { name } }
      }
    }
  }
}`

/** The trailing fragment definitions every document that uses them appends. */
const FRAGMENTS = `${LINKED_PR_FRAGMENT}\n${ISSUE_CARD_FRAGMENT}`

/** The page size of the scope catalog's repository connection. */
const SCOPE_PAGE_SIZE = 100

/**
 * The scope catalog: the viewer, their organizations, and their repositories.
 * One request is one point at this page size. A second request is issued by the
 * client when the repository connection has more pages (capped at 200 repos).
 * @param after - cursor from the previous page, or `null` for the first page.
 * @returns the operation and its variables.
 */
export function buildScopeQuery(after: string | null): GitHubGraphQLRequest {
  return {
    query: `query ScopeCatalog($first: Int!, $after: String) {
  viewer {
    login
    avatarUrl(size: 32)
    repositories(first: $first, after: $after, ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], orderBy: {field: PUSHED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { nameWithOwner isPrivate isFork pushedAt }
    }
    organizations(first: 100) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { login avatarUrl(size: 32) }
    }
  }
  rateLimit { cost remaining }
}`,
    variables: { first: SCOPE_PAGE_SIZE, after },
  }
}

/**
 * Projects v2 discovery for the project picker.
 * Every `ProjectV2` field except `totalCount` needs `read:project`, so the whole
 * request fails with `INSUFFICIENT_SCOPES` on a token without it; the client
 * treats that as a blocked picker rather than an error. One alias per
 * organization keeps the request count at one.
 * @param orgs - organization logins to list projects for (the caller caps this).
 * @returns the operation and its variables.
 */
export function buildProjectsQuery(orgs: readonly string[]): GitHubGraphQLRequest {
  const variableDefinitions = ['$viewerFirst: Int!']
  const variables: Record<string, unknown> = { viewerFirst: PROJECTS_PER_OWNER }
  const selections = [
    `viewer { projectsV2(first: $viewerFirst) { nodes { id number title url } } }`,
  ]
  orgs.forEach((org, index) => {
    variableDefinitions.push(`$org${index}: String!`)
    variables[`org${index}`] = org
    selections.push(`o${index}: organization(login: $org${index}) { projectsV2(first: $viewerFirst) { nodes { id number title url } } }`)
  })
  return {
    query: `query ScopeProjects(${variableDefinitions.join(', ')}) {
  ${selections.join('\n  ')}
}`,
    variables,
  }
}

/**
 * The fields of one project, including single-select options.
 * `ProjectV2.fields` returns the `ProjectV2FieldConfiguration` union, so each
 * member has to be selected explicitly rather than through common fields.
 * Kept for the project-view field/priority picker; the items query reads the
 * selected `Priority` value directly.
 * @param projectId - the project's GraphQL node id.
 * @returns the operation and its variables.
 */
export function buildProjectFieldsQuery(projectId: string): GitHubGraphQLRequest {
  return {
    query: `query ProjectFields($id: ID!) {
  node(id: $id) {
    ... on ProjectV2 {
      id
      title
      fields(first: 50) {
        nodes {
          __typename
          ... on ProjectV2Field { id name dataType }
          ... on ProjectV2SingleSelectField { id name dataType options { id name color } }
          ... on ProjectV2IterationField { id name dataType }
        }
      }
    }
  }
}`,
    variables: { id: projectId },
  }
}

/**
 * One page of projects v2 items, with the `Priority` field and the issue or
 * pull-request content each item holds. Drafts are selected only enough to be
 * recognised and skipped.
 * @param input - project id and page window.
 * @returns the operation and its variables.
 */
export function buildProjectItemsQuery(input: {
  projectId: string
  first: number
  after: string | null
  /** Projects v2 filter DSL (`is:open assignee:@me`), evaluated by GitHub. */
  filter?: string
}): GitHubGraphQLRequest {
  return {
    query: `query ProjectItems($id: ID!, $first: Int!, $after: String, $query: String!) {
  node(id: $id) {
    ... on ProjectV2 {
      id
      items(first: $first, after: $after, query: $query) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          type
          priority: fieldValueByName(name: "Priority") {
            __typename
            ... on ProjectV2ItemFieldSingleSelectValue { name color optionId }
            ... on ProjectV2ItemFieldTextValue { text }
            ... on ProjectV2ItemFieldNumberValue { number }
            ... on ProjectV2ItemFieldDateValue { date }
          }
          status: fieldValueByName(name: "Status") {
            __typename
            ... on ProjectV2ItemFieldSingleSelectValue { name color optionId }
          }
          content {
            __typename
            ... on Issue { ...IssueCardFields }
            ... on PullRequest {
              id
              number
              title
              url
              state
              isDraft
              merged
              updatedAt
              repository { nameWithOwner isPrivate }
              labels(first: 10) { nodes { name color } }
              milestone { title dueOn state progressPercentage }
              assignees(first: 5) { nodes { login avatarUrl(size: 32) } }
              comments { totalCount }
              body
            }
            ... on DraftIssue { id title body }
          }
        }
      }
    }
  }
  rateLimit { cost remaining }
}
${FRAGMENTS}`,
    variables: {
      id: input.projectId,
      first: input.first,
      after: input.after,
      query: input.filter ?? '',
    },
  }
}

/**
 * Free-text search for the assigned, created, open, and multi-repository views.
 * Search is the one endpoint that spans all accessible repositories in a single
 * point, so the repo view also uses it when more than one repository is
 * selected; a single repository uses the exact `issues` connection instead.
 * @param input - the search query string and page window.
 * @returns the operation and its variables.
 */
export function buildSearchIssuesQuery(input: {
  search: string
  first: number
  after: string | null
}): GitHubGraphQLRequest {
  return {
    query: `query SearchIssues($q: String!, $first: Int!, $after: String) {
  search(query: $q, type: ISSUE, first: $first, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ...IssueCardFields }
  }
  rateLimit { cost remaining }
}
${FRAGMENTS}`,
    variables: { q: input.search, first: input.first, after: input.after },
  }
}

/**
 * One repository's issues, with exact `totalCount` and cursor paging.
 * Used for the repo view's single-repository case; `states` is a list and the
 * order is always most-recently-updated first.
 * @param input - repository, states, and page window.
 * @returns the operation and its variables.
 */
export function buildRepoIssuesQuery(input: {
  owner: string
  name: string
  states: readonly IssueState[]
  first: number
  after: string | null
  /** Milestone title, or `undefined` for every milestone. */
  milestone?: string
}): GitHubGraphQLRequest {
  const filtered = input.milestone !== undefined && input.milestone !== ''
  const filterBy = filtered ? ', filterBy: { milestone: $milestone }' : ''
  const declaration = filtered ? '$milestone: String' : ''
  return {
    query: `query RepoIssues($owner: String!, $name: String!, $first: Int!, $after: String, $states: [IssueState!]${declaration}) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    isPrivate
    issues(first: $first, after: $after, states: $states, orderBy: {field: UPDATED_AT, direction: DESC}${filterBy}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { ...IssueCardFields }
    }
  }
  rateLimit { cost remaining }
}
${FRAGMENTS}`,
    variables: {
      owner: input.owner,
      name: input.name,
      states: [...input.states],
      first: input.first,
      after: input.after,
      ...filtered ? { milestone: input.milestone } : {},
    },
  }
}

/**
 * A repository's milestones, used to fill the milestone picker.
 * @param owner - repository owner.
 * @param name - repository name.
 * @returns the operation and its variables.
 */
export function buildRepoMilestonesQuery(owner: string, name: string): GitHubGraphQLRequest {
  return {
    query: `query RepoMilestones($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    milestones(first: 100, states: [OPEN, CLOSED], orderBy: {field: DUE_DATE, direction: ASC}) {
      nodes { title state dueOn }
    }
  }
}`,
    variables: { owner, name },
  }
}

/**
 * One issue with its body and card fields.
 *
 * The cross-reference timeline is *not* part of this request: it is the slowest
 * leg of the detail (a timeline scan plus a full PR fragment per entry), so the
 * panel asks for it separately after the detail is already on screen. See
 * {@link buildMentionedPRsQuery}.
 * @param input - repository and issue number.
 * @returns the operation and its variables.
 */
export function buildIssueDetailQuery(input: {
  owner: string
  name: string
  number: number
}): GitHubGraphQLRequest {
  return {
    query: `query IssueDetail($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      id
      number
      body
    }
  }
}`,
    variables: { owner: input.owner, name: input.name, number: input.number },
  }
}

/**
 * The issue's cross-referenced pull requests (the slow timeline leg).
 * @param input - repository and issue number.
 * @returns the operation and its variables.
 */
export function buildMentionedPRsQuery(input: {
  owner: string
  name: string
  number: number
}): GitHubGraphQLRequest {
  return {
    query: `query IssueMentionedPRs($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      timelineItems(itemTypes: [CROSS_REFERENCED_EVENT], first: 10) {
        nodes {
          __typename
          ... on CrossReferencedEvent {
            source {
              __typename
              ... on PullRequest { ...LinkedPRFields }
            }
          }
        }
      }
    }
  }
}
${LINKED_PR_FRAGMENT}`,
    variables: { owner: input.owner, name: input.name, number: input.number },
  }
}

/** Turn the UI's three-way state filter into a search qualifier. */
function stateQualifier(state: IssueListRequest['state']): string {
  switch (state ?? 'open') {
    case 'open': return 'state:open'
    case 'closed': return 'state:closed'
    case 'all': return ''
  }
}

/**
 * Turn the UI's three-way state filter into the `states` argument value.
 * @param state - the requested filter; absent means open issues.
 * @returns the values for the `[IssueState!]` argument.
 */
export function statesForView(state: IssueListRequest['state']): IssueState[] {
  switch (state ?? 'open') {
    case 'open': return ['OPEN']
    case 'closed': return ['CLOSED']
    case 'all': return ['OPEN', 'CLOSED']
  }
}

/**
 * The GitHub search string for one search-backed view.
 * `sort:` and `state:` are qualifiers inside the query string, not GraphQL
 * arguments; `is:issue` is mandatory because `type: ISSUE` also matches pull
 * requests. Multiple `repo:` qualifiers are OR-ed by GitHub, which is how the
 * multi-repository view stays a single request.
 * @param view - a search-backed view (the project view is not one).
 * @param request - the normalized list request.
 * @returns the query string, e.g. `is:issue assignee:@me state:open sort:updated-desc`.
 */
export function searchStringFor(
  view: SearchView,
  request: Pick<IssueListRequest, 'state' | 'repos'>,
): string {
  const qualifiers = ['is:issue']
  if (view === 'assigned') qualifiers.push('assignee:@me')
  if (view === 'created') qualifiers.push('author:@me')
  if (view === 'repo') {
    for (const repo of request.repos ?? []) {
      const { owner, name } = splitRepo(repo)
      qualifiers.push(`repo:${owner}/${name}`)
    }
  }
  const state = stateQualifier(request.state)
  if (state !== '') qualifiers.push(state)
  qualifiers.push('sort:updated-desc')
  return qualifiers.join(' ')
}

/**
 * Projects v2 discovery for one organization, on demand.
 * @param org - the organization login.
 * @returns the operation and its variables.
 */
export function buildOrgProjectsQuery(org: string): GitHubGraphQLRequest {
  return {
    query: `query ScopeProjects($org: String!) {
  organization(login: $org) {
    projectsV2(first: 50) {
      totalCount
      nodes { id number title url }
    }
  }
}`,
    variables: { org },
  }
}

/**
 * One page of an organization's repositories, forks included.
 * GitHub's `organization.repositories` has no search argument, so the browser
 * filters the fetched pages locally.
 * @param input - organization, page window, and page size.
 * @returns the operation and its variables.
 */
export function buildOrgReposQuery(input: {
  org: string
  first: number
  after: string | null
}): GitHubGraphQLRequest {
  return {
    query: `query OrgRepos($org: String!, $first: Int!, $after: String) {
  organization(login: $org) {
    repositories(first: $first, after: $after, orderBy: {field: PUSHED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { nameWithOwner isPrivate isFork pushedAt }
    }
  }
}`,
    variables: { org: input.org, first: input.first, after: input.after },
  }
}

/**
 * The issue search string for a cascade request.
 *
 * `is:issue` is mandatory because `search(type: ISSUE)` also matches pull
 * requests. `org:` and `repo:` are ordinary search qualifiers, so an
 * organization-wide list costs the same one point as a global one.
 * @param request - the scope and filters.
 * @returns e.g. `is:issue org:one2x-ai assignee:@me state:open sort:updated-desc`.
 */
export function searchStringForFilters(request: Pick<IssueListRequest, 'org' | 'repos' | 'assignee' | 'author' | 'state' | 'milestone'>): string {
  const qualifiers = ['is:issue']
  if (request.org !== undefined && request.org !== '') qualifiers.push(`org:${request.org}`)
  for (const repo of request.repos ?? []) {
    const { owner, name } = splitRepo(repo)
    qualifiers.push(`repo:${owner}/${name}`)
  }
  if (request.author !== undefined && request.author !== '' && request.author !== 'all') {
    qualifiers.push(`author:${request.author}`)
  } else if (request.assignee !== undefined && request.assignee !== '' && request.assignee !== 'all') {
    qualifiers.push(`assignee:${request.assignee}`)
  }
  if (request.milestone !== undefined && request.milestone !== '') {
    qualifiers.push(`milestone:"${escapeSearchValue(request.milestone)}"`)
  }
  const state = stateQualifier(request.state)
  if (state !== '') qualifiers.push(state)
  qualifiers.push('sort:updated-desc')
  return qualifiers.join(' ')
}

/** Escape a value used inside a quoted GitHub search qualifier. */
function escapeSearchValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * The Projects v2 item filter for a cascade request. GitHub evaluates it
 * server-side, so a state filter on a 126-item board returns the 25 open ones
 * rather than the first page filtered locally.
 * @param request - the state and assignee filters.
 * @returns e.g. `is:open assignee:@me`, or an empty string for no filter.
 */
export function projectItemsFilterFor(request: Pick<IssueListRequest, 'assignee' | 'state'>): string {
  const parts: string[] = []
  if (request.state === 'open') parts.push('is:open')
  if (request.state === 'closed') parts.push('is:closed')
  if (request.assignee !== undefined && request.assignee !== '' && request.assignee !== 'all') {
    // `@me` is valid inside the project filter DSL just as in search.
    parts.push(`assignee:${request.assignee}`)
  }
  return parts.join(' ')
}

/** The repository filter a project view applies to its item content. */
export function reposFor(request: Pick<IssueListRequest, 'repos'>): string[] {
  return request.repos ?? []
}
