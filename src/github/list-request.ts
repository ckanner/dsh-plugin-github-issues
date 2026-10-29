/**
 * The wire validator for list requests.
 *
 * The Remote receiver is the trust boundary: the browser can send any JSON, so
 * this whitelist decides what reaches the GitHub client. It lives outside the
 * controller so it can be unit tested without the Cordis decorators.
 *
 * @module dsh-plugin-github-issues/github/list-request
 */

/**
 * Validate a list request that came over the wire.
 *
 * The wire is untrusted: this whitelist is the only path from the browser to the
 * list API, so every new filter must be added here as well as in the client.
 * @param input - the raw Remote argument.
 * @returns the validated request.
 */
export function normalizeRequest(input: unknown): {
  view?: 'assigned' | 'created' | 'open' | 'repo' | 'project'
  repos?: string[]
  projectId?: string
  org?: string
  assignee: string
  author?: string
  state: 'open' | 'closed' | 'all'
  milestone?: string
  milestoneNumber?: number
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
  const milestone = typeof raw.milestone === 'string' && raw.milestone.trim() !== ''
    ? raw.milestone.trim().slice(0, 200)
    : undefined
  const milestoneNumber = typeof raw.milestoneNumber === 'number'
    && Number.isInteger(raw.milestoneNumber) && raw.milestoneNumber > 0
    ? raw.milestoneNumber
    : undefined
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
    ...milestone === undefined ? {} : { milestone },
    ...milestoneNumber === undefined ? {} : { milestoneNumber },
  }
}

