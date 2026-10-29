/**
 * Client tests with a fake `fetch`: no socket is opened.
 *
 * The fake proves three things at once: the endpoint is spoken to correctly (the
 * token travels only in the Authorization header), failures are classified into
 * the codes the UI branches on, and the in-memory caches actually save requests
 * until `invalidate` drops them.
 */

import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { createGitHubApi, endpointFor } from '../src/github/client.ts'
import { GitHubApiError } from '../src/github/types.ts'

/** The token used throughout; it must never appear in an error or a URL. */
const TOKEN = 'ghp_testtoken_never_leak_0123456789'

/** One canned answer the fake returns for an operation. */
interface FakeAnswer {
  status?: number
  headers?: Record<string, string>
  body?: unknown
  /** Throw instead of answering, to simulate a transport failure. */
  networkError?: Error
}

/** One request the fake observed. */
interface FakeCall {
  url: string
  operation: string
  query: string
  variables: Record<string, unknown>
  headers: Record<string, string>
}

/** A recording stand-in for GitHub's GraphQL endpoint. */
class FakeGitHub {
  readonly calls: FakeCall[] = []
  private readonly routes = new Map<string, FakeAnswer>()

  /**
   * Register the answer for one GraphQL operation name.
   * @param operation - e.g. `SearchIssues`.
   * @param answer - the response to return.
   * @returns this fake, for chaining.
   */
  on(operation: string, answer: FakeAnswer): this {
    this.routes.set(operation, answer)
    return this
  }

  /** How many times one operation was requested. */
  count(operation: string): number {
    return this.calls.filter(call => call.operation === operation).length
  }

  /** The `fetch` implementation installed on `globalThis`. */
  readonly handler = async (url: string, init?: { body?: string; headers?: Record<string, string> }): Promise<Response> => {
    const body = typeof init?.body === 'string' ? init.body : ''
    const parsed = JSON.parse(body) as { query?: unknown; variables?: unknown }
    const query = typeof parsed.query === 'string' ? parsed.query : ''
    const operation = /query\s+([A-Za-z0-9_]+)/.exec(query)?.[1] ?? ''
    const variables = typeof parsed.variables === 'object' && parsed.variables !== null
      ? parsed.variables as Record<string, unknown>
      : {}
    this.calls.push({ url, operation, query, variables, headers: init?.headers ?? {} })
    const answer = this.routes.get(operation)
    if (answer === undefined) throw new Error(`fake GitHub: no response registered for ${operation}`)
    if (answer.networkError !== undefined) throw answer.networkError
    return new Response(JSON.stringify(answer.body ?? null), {
      status: answer.status ?? 200,
      ...answer.headers === undefined ? {} : { headers: answer.headers },
    })
  }
}

/**
 * Install a fresh fake fetch for one test and restore the previous one after it.
 * @param t - the test context that owns the cleanup.
 * @returns the installed fake.
 */
function useFake(t: TestContext): FakeGitHub {
  const fake = new FakeGitHub()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  Object.defineProperty(globalThis, 'fetch', {
    value: fake.handler,
    configurable: true,
    writable: true,
  })
  t.after(() => {
    if (original === undefined) delete (globalThis as { fetch?: unknown }).fetch
    else Object.defineProperty(globalThis, 'fetch', original)
  })
  return fake
}

/** One client on github.com. */
function makeApi(host = 'github.com') {
  return createGitHubApi({ token: TOKEN, host })
}

/** Run a call that must reject and return its classified error. */
async function errorOf(run: () => Promise<unknown>): Promise<GitHubApiError> {
  try {
    await run()
  } catch (error) {
    assert.ok(error instanceof GitHubApiError, `expected GitHubApiError, got ${String(error)}`)
    return error
  }
  assert.fail('expected the call to reject')
}

/** An issue card node with every required list field selected. */
const ISSUE = {
  __typename: 'Issue',
  id: 'I_kwDO1',
  number: 2469,
  title: 'Panel flickers',
  url: 'https://github.com/one2x-ai/mesh/issues/2469',
  state: 'OPEN',
  stateReason: null,
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-27T12:50:56Z',
  issueType: { name: 'Bug', color: 'RED' },
  repository: { nameWithOwner: 'one2x-ai/mesh', isPrivate: true },
  labels: { nodes: [{ name: 'P2', color: 'fbca04' }] },
  milestone: null,
  assignees: { nodes: [{ login: 'ckanner', avatarUrl: 'https://a/u/1?s=32' }] },
  comments: { totalCount: 8 },
  body: 'Body',
  closedByPullRequestsReferences: { nodes: [] },
  issueFieldValues: { nodes: [] },
}

/** A search answer with one issue. */
const SEARCH_BODY = {
  data: {
    search: {
      issueCount: 1,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [ISSUE],
    },
    rateLimit: { cost: 1, remaining: 4799 },
  },
}

/** A scope catalog answer with one viewer, org, and repository. */
const SCOPE_BODY = {
  data: {
    viewer: {
      login: 'ckanner',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1?s=32',
      repositories: {
        totalCount: 1,
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [{ nameWithOwner: 'one2x-ai/mesh', isPrivate: true, pushedAt: '2026-10-27T13:01:41Z' }],
      },
      organizations: {
        totalCount: 1,
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [{ login: 'one2x-ai' }],
      },
    },
    rateLimit: { cost: 1, remaining: 4798 },
  },
}

/** The projects answer a token without `read:project` produces. */
const PROJECTS_BLOCKED_BODY = {
  errors: [
    {
      type: 'INSUFFICIENT_SCOPES',
      message: "Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: ['read:project']",
    },
  ],
}

test('endpointFor maps hosts to their GraphQL endpoints', () => {
  assert.equal(endpointFor('github.com'), 'https://api.github.com/graphql')
  assert.equal(endpointFor('api.github.com'), 'https://api.github.com/graphql')
  assert.equal(endpointFor('ghe.example.com'), 'https://ghe.example.com/api/graphql')
  assert.equal(endpointFor(' ghe.example.com/ '), 'https://ghe.example.com/api/graphql')
})

test('requests go to the endpoint with the token only in the header', async (t) => {
  const fake = useFake(t)
  fake.on('SearchIssues', { body: SEARCH_BODY })
  await makeApi().listIssues({ view: 'assigned', state: 'open' })
  const [call] = fake.calls
  assert.ok(call !== undefined)
  assert.equal(call.url, 'https://api.github.com/graphql')
  assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`)
  assert.ok(call.headers['User-Agent']?.includes('dsh-plugin-github-issues'))
  assert.ok(!call.url.includes(TOKEN))
  assert.ok(call.query.includes('query SearchIssues'))
})

test('a repository-scoped list uses the exact issues connection with server-side filters', async (t) => {
  const fake = useFake(t)
  fake.on('ScopeCatalog', { body: SCOPE_BODY })
  fake.on('RepoIssues', {
    body: {
      data: {
        repository: {
          nameWithOwner: 'one2x-ai/mesh',
          isPrivate: true,
          issues: {
            totalCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [ISSUE],
          },
        },
        rateLimit: { cost: 1, remaining: 4799 },
      },
    },
  })
  const api = makeApi()
  const first = await api.listIssues({
    org: 'one2x-ai',
    repos: ['one2x-ai/mesh'],
    assignee: '@me',
    state: 'open',
    milestone: 'v2.1',
    milestoneNumber: 7,
  })
  assert.equal(first.totalCount, 1)
  assert.equal(first.items[0]?.number, 2469)
  assert.equal(fake.count('ScopeCatalog'), 1)
  const call = fake.calls.find(call => call.operation === 'RepoIssues')
  assert.ok(call !== undefined)
  // `@me` is resolved to the viewer's login; the connection filters by milestone number.
  assert.equal(call.variables.assignee, 'ckanner')
  assert.equal(call.variables.milestone, '7')
  assert.ok(call.query.includes('filterBy: { assignee: $assignee, milestoneNumber: $milestone }'))

  // The same request is cached.
  const second = await api.listIssues({
    org: 'one2x-ai',
    repos: ['one2x-ai/mesh'],
    assignee: '@me',
    state: 'open',
    milestone: 'v2.1',
    milestoneNumber: 7,
  })
  assert.equal(first, second)
  assert.equal(fake.count('RepoIssues'), 1)
})

test('list pages are cached until the list cache is invalidated', async (t) => {
  const fake = useFake(t)
  fake.on('SearchIssues', { body: SEARCH_BODY })
  const api = makeApi()
  const first = await api.listIssues({ view: 'assigned', state: 'open' })
  const second = await api.listIssues({ view: 'assigned', state: 'open' })
  assert.equal(fake.count('SearchIssues'), 1)
  assert.equal(first, second)
  assert.equal(first.items.length, 1)
  assert.equal(first.items[0]?.number, 2469)
  assert.equal(first.totalCount, 1)
  assert.deepEqual(first.pageInfo, { hasNextPage: false, endCursor: null })
  assert.deepEqual(first.rateLimit, { cost: 1, remaining: 4799 })
  api.invalidate('list')
  await api.listIssues({ view: 'assigned', state: 'open' })
  assert.equal(fake.count('SearchIssues'), 2)
})

test('the detail body is cached until the detail cache is invalidated', async (t) => {
  const fake = useFake(t)
  fake.on('IssueDetail', { body: { data: { repository: { issue: { id: 'I_1', number: 2469, body: 'Body' } } } } })
  const api = makeApi()
  const detail = await api.issueDetail('one2x-ai/mesh', 2469)
  await api.issueDetail('one2x-ai/mesh', 2469)
  assert.equal(fake.count('IssueDetail'), 1)
  assert.deepEqual(detail, { body: 'Body' })
  api.invalidate('detail')
  await api.issueDetail('one2x-ai/mesh', 2469)
  assert.equal(fake.count('IssueDetail'), 2)
})

test('the mentioned PRs are fetched as a separate, cached request', async (t) => {
  const fake = useFake(t)
  fake.on('IssueMentionedPRs', { body: { data: { repository: { issue: { timelineItems: { nodes: [] } } } } } })
  const api = makeApi()
  const first = await api.issueMentionedPRs('one2x-ai/mesh', 2469)
  await api.issueMentionedPRs('one2x-ai/mesh', 2469)
  assert.equal(fake.count('IssueMentionedPRs'), 1)
  assert.deepEqual(first, { mentionedPRs: [] })
  api.invalidate('detail')
  await api.issueMentionedPRs('one2x-ai/mesh', 2469)
  assert.equal(fake.count('IssueMentionedPRs'), 2)
})

test('scopes returns the organization/repository catalog and the org project lookup degrades', async (t) => {
  const fake = useFake(t)
  fake.on('ScopeCatalog', { body: SCOPE_BODY })
  fake.on('ScopeProjects', { body: PROJECTS_BLOCKED_BODY })
  const api = makeApi()
  const catalog = await api.scopes()
  assert.equal(catalog.viewer?.login, 'ckanner')
  assert.deepEqual(catalog.orgs, [{ login: 'one2x-ai' }])
  assert.deepEqual(catalog.repos, [{
    nameWithOwner: 'one2x-ai/mesh',
    isPrivate: true,
    isFork: false,
    pushedAt: '2026-10-27T13:01:41Z',
  }])
  // The catalog is cached for five minutes.
  await api.scopes()
  assert.equal(fake.count('ScopeCatalog'), 1)
  // Projects are loaded per organization, on demand.
  const projects = await api.orgProjects('one2x-ai')
  assert.deepEqual(projects.projects, [])
  assert.equal(projects.blocked, true)
  assert.ok(projects.error?.includes('read:project'))
  await api.orgProjects('one2x-ai')
  assert.equal(fake.count('ScopeProjects'), 1)
  // A project view now answers with a notice and makes no items request at all.
  const page = await api.listIssues({ projectId: 'PVT_kwDOtest', state: 'open', assignee: '@me' })
  assert.deepEqual(page.items, [])
  assert.ok(page.notice?.includes('read:project'))
  assert.equal(fake.count('ProjectItems'), 0)
  // A full invalidate drops the catalog and the organization caches too.
  api.invalidate('all')
  await api.scopes()
  await api.orgProjects('one2x-ai')
  assert.equal(fake.count('ScopeCatalog'), 2)
  assert.equal(fake.count('ScopeProjects'), 2)
})

test('401 is classified as unauthorized and never echoes the token', async (t) => {
  const fake = useFake(t)
  fake.on('SearchIssues', { status: 401, body: { message: 'Bad credentials' } })
  const error = await errorOf(() => makeApi().listIssues({ view: 'assigned' }))
  assert.equal(error.code, 'unauthorized')
  assert.equal(error.status, 401)
  assert.ok(!error.message.includes(TOKEN))
})

test('INSUFFICIENT_SCOPES in a 200 body is a missing_scope error', async (t) => {
  const fake = useFake(t)
  fake.on('SearchIssues', { body: PROJECTS_BLOCKED_BODY })
  const error = await errorOf(() => makeApi().listIssues({ view: 'assigned' }))
  assert.equal(error.code, 'missing_scope')
  assert.equal(error.status, 403)
  assert.ok(error.message.includes('required scopes'))
})

test('a 403 with scopes text is a missing_scope error', async (t) => {
  const fake = useFake(t)
  fake.on('SearchIssues', {
    status: 403,
    body: { errors: [{ type: 'INSUFFICIENT_SCOPES', message: 'The token has not been granted the required scopes.' }] },
  })
  const error = await errorOf(() => makeApi().listIssues({ view: 'assigned' }))
  assert.equal(error.code, 'missing_scope')
  assert.equal(error.status, 403)
})

test('a 403 with Retry-After is a rate_limited error', async (t) => {
  const fake = useFake(t)
  fake.on('SearchIssues', {
    status: 403,
    headers: { 'retry-after': '60' },
    body: { message: 'You have exceeded a secondary rate limit.' },
  })
  const error = await errorOf(() => makeApi().listIssues({ view: 'assigned' }))
  assert.equal(error.code, 'rate_limited')
  assert.equal(error.status, 403)
  assert.ok(error.message.includes('secondary rate limit'))
})

test('RATE_LIMITED in a GraphQL body is a rate_limited error', async (t) => {
  const fake = useFake(t)
  fake.on('SearchIssues', {
    body: { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded for user.' }] },
  })
  const error = await errorOf(() => makeApi().listIssues({ view: 'assigned' }))
  assert.equal(error.code, 'rate_limited')
  assert.equal(error.status, 429)
})

test('other GraphQL errors classify as graphql and keep GitHub\'s message', async (t) => {
  const fake = useFake(t)
  fake.on('SearchIssues', { body: { errors: [{ message: 'Something went sideways.' }] } })
  const error = await errorOf(() => makeApi().listIssues({ view: 'assigned' }))
  assert.equal(error.code, 'graphql')
  assert.equal(error.message, 'Something went sideways.')
})

test('a NOT_FOUND detail answer classifies as not_found', async (t) => {
  const fake = useFake(t)
  fake.on('IssueDetail', {
    body: {
      data: { repository: { issue: null } },
      errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to an Issue with the number of 9999.' }],
    },
  })
  const error = await errorOf(() => makeApi().issueDetail('one2x-ai/mesh', 9999))
  assert.equal(error.code, 'not_found')
  assert.ok(error.message.includes('Could not resolve'))
})

test('a transport failure classifies as network', async (t) => {
  const fake = useFake(t)
  fake.on('SearchIssues', { networkError: new TypeError('fetch failed') })
  const error = await errorOf(() => makeApi().listIssues({ view: 'assigned' }))
  assert.equal(error.code, 'network')
  assert.ok(error.message.includes('Could not reach GitHub'))
})

test('a GHES host is spoken to at its own GraphQL path', async (t) => {
  const fake = useFake(t)
  fake.on('SearchIssues', { body: SEARCH_BODY })
  await makeApi('ghe.example.com').listIssues({ view: 'assigned' })
  assert.equal(fake.calls[0]?.url, 'https://ghe.example.com/api/graphql')
})

test('the repo view uses the issues connection for one repo and search for many', async (t) => {
  const fake = useFake(t)
  fake.on('RepoIssues', {
    body: {
      data: {
        repository: {
          nameWithOwner: 'one2x-ai/mesh',
          isPrivate: true,
          issues: { totalCount: 3, pageInfo: { hasNextPage: true, endCursor: 'c1' }, nodes: [ISSUE] },
        },
        rateLimit: { cost: 1, remaining: 4797 },
      },
    },
  })
  fake.on('SearchIssues', { body: SEARCH_BODY })
  const api = makeApi()
  const single = await api.listIssues({ view: 'repo', repos: ['one2x-ai/mesh'], state: 'open' })
  assert.equal(fake.count('RepoIssues'), 1)
  assert.equal(single.totalCount, 3)
  assert.deepEqual(single.pageInfo, { hasNextPage: true, endCursor: 'c1' })
  const many = await api.listIssues({ view: 'repo', repos: ['one2x-ai/mesh', 'cli/cli'] })
  assert.equal(fake.count('RepoIssues'), 1)
  assert.equal(fake.count('SearchIssues'), 1)
  const searchCall = fake.calls.find(call => call.operation === 'SearchIssues')
  assert.ok(searchCall !== undefined)
  const qualifiers = String(searchCall.variables.q)
  assert.ok(qualifiers.includes('repo:one2x-ai/mesh'))
  assert.ok(qualifiers.includes('repo:cli/cli'))
  assert.ok(qualifiers.includes('is:issue'))
  assert.equal(many.items.length, 1)
})

test('the project view maps issue and PR items and filters drafts by state', async (t) => {
  const fake = useFake(t)
  fake.on('ProjectItems', {
    body: {
      data: {
        node: {
          items: {
            totalCount: 3,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: 'PVTI_1',
                type: 'ISSUE',
                priority: { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'Urgent', color: 'PINK' },
                content: { ...ISSUE },
              },
              {
                id: 'PVTI_2',
                type: 'PULL_REQUEST',
                content: {
                  __typename: 'PullRequest',
                  id: 'PR_kwDO1',
                  number: 2527,
                  title: 'Fix panel flicker',
                  url: 'https://github.com/one2x-ai/mesh/pull/2527',
                  state: 'MERGED',
                  isDraft: false,
                  merged: true,
                  updatedAt: '2026-10-27T11:00:00Z',
                  repository: { nameWithOwner: 'one2x-ai/mesh', isPrivate: true },
                  labels: { nodes: [] },
                  comments: { totalCount: 2 },
                  body: 'Fixes it.',
                },
              },
              { id: 'PVTI_3', type: 'DRAFT_ISSUE', content: { __typename: 'DraftIssue', id: 'DI_1', title: 'Draft' } },
            ],
          },
        },
        rateLimit: { cost: 2, remaining: 4790 },
      },
    },
  })
  const api = makeApi()
  const all = await api.listIssues({ view: 'project', projectId: 'PVT_kwDOtest', state: 'all' })
  assert.equal(all.items.length, 2)
  assert.equal(all.items[0]?.priority?.source, 'project')
  assert.equal(all.items[0]?.priority?.name, 'Urgent')
  assert.equal(all.items[1]?.state, 'CLOSED')
  assert.equal(all.items[1]?.number, 2527)
  assert.equal(all.totalCount, 3)
  assert.deepEqual(all.rateLimit, { cost: 2, remaining: 4790 })
  // The state filter is now sent to GitHub's own project filter (the fake
  // ignores it and returns the same board), so the host must not filter locally.
  const openOnly = await api.listIssues({ view: 'project', projectId: 'PVT_kwDOtest', state: 'open' })
  assert.equal(openOnly.items.length, 2)
  const projectCalls = fake.calls.filter(call => call.operation === 'ProjectItems')
  assert.equal(projectCalls.at(-1)?.variables.query, 'is:open')
  assert.equal(projectCalls.at(-2)?.variables.query, '')
})
