/**
 * The Remote surface, described once for both halves.
 *
 * The browser half cannot use the generated `ctx.remote.*` aggregate: that is
 * assembled at build time from a fixed list of shipped packages. So the client
 * mounts its own contribution (see `src/client/remote.ts`) built from this table,
 * and the Host half decorates exactly these methods with `@Remote`. A method added
 * to one side and forgotten here fails only when a user clicks.
 *
 * @module dsh-plugin-github-issues/remote-methods
 */

/** One argument of a Remote method. */
export interface RemoteParameter {
  /** Wire name the Gateway builds the call from. */
  wire: string
  /** Whether the Host declares this argument optional (still sent as explicit `undefined`). */
  optional?: boolean
}

/** One method the Host exposes, with the wire name of each argument. */
export interface RemoteMethod {
  /** Method name on the controller. */
  method: string
  /** Arguments, in call order. */
  parameters: readonly RemoteParameter[]
}

/** Every method the browser may call. */
export const REMOTE_METHODS: readonly RemoteMethod[] = [
  { method: 'status', parameters: [] },
  { method: 'catalog', parameters: [] },
  { method: 'orgProjects', parameters: [{ wire: 'org' }] },
  { method: 'orgRepos', parameters: [{ wire: 'org' }] },
  { method: 'listIssues', parameters: [{ wire: 'request' }] },
  { method: 'repoMilestones', parameters: [{ wire: 'repo' }] },
  { method: 'issueDetail', parameters: [{ wire: 'repo' }, { wire: 'number' }] },
  { method: 'issueMentionedPRs', parameters: [{ wire: 'repo' }, { wire: 'number' }] },
  { method: 'loadPrefs', parameters: [] },
  { method: 'savePrefs', parameters: [{ wire: 'patch' }] },
  { method: 'refresh', parameters: [] },
  { method: 'links', parameters: [] },
  { method: 'linkIssue', parameters: [{ wire: 'repo' }, { wire: 'number' }, { wire: 'sessionId' }] },
  { method: 'unlinkIssue', parameters: [{ wire: 'repo' }, { wire: 'number' }, { wire: 'sessionId', optional: true }] },
]

/** The Cordis service key the controller registers, and the descriptor's `service` field. */
export const REMOTE_SERVICE_KEY = 'githubIssuesController'

/** The wire namespace both halves address this surface by. */
export const REMOTE_NAMESPACE = 'githubIssues'
