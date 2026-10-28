/**
 * Workspace resolution for a one-click handoff.
 *
 * A handoff from the GitHub panel opens a fresh Session so the issue gets its
 * own context. The new Session needs a Workspace, with this priority:
 *
 * 1. the Workspace of the Session the handoff came from,
 * 2. the Workspace of a Session already linked to the same repository,
 * 3. a Workspace whose directory basename or title matches the repository name,
 * 4. no choice at all — the Host's "current or most recent Workspace" default.
 *
 * Pure so the rules are unit-tested without a browser.
 *
 * @module dsh-plugin-github-issues/workspace
 */

/** One Workspace candidate, narrowed from the client's workspace catalog. */
export interface WorkspaceCandidate {
  workspaceId: string
  /** Absolute directory path of the Workspace, when the catalog carries it. */
  path?: string
  /** Display title of the Workspace (usually the directory basename). */
  title?: string
  /** Sessions currently grouped under this Workspace. */
  sessionIds: readonly string[]
}

/** The inputs of one resolution. */
export interface ResolveWorkspaceInput {
  /** `owner/name` of the issue's repository. */
  repo: string
  /** The Session the handoff was triggered from, when one is on screen. */
  currentSessionId?: string
  /** Sessions already linked to this repository, newest first. */
  linkedSessionIds?: readonly string[]
  /** The Workspace catalog, in display order. */
  workspaces: readonly WorkspaceCandidate[]
}

/** The last path segment, used for the directory-name rule. */
function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return (index === -1 ? trimmed : trimmed.slice(index + 1)).toLowerCase()
}

/**
 * Pick the Workspace for a handoff's new Session.
 * @param input - repository, source Sessions, and the Workspace catalog.
 * @returns the chosen Workspace id, or `undefined` to use the Host default.
 */
export function resolveHandoffWorkspace(input: ResolveWorkspaceInput): string | undefined {
  const workspaces = input.workspaces
  if (workspaces.length === 0) return undefined

  /** The first Workspace whose `sessionIds` contains one of the candidates. */
  const bySession = (sessionIds: readonly string[]): string | undefined => {
    for (const sessionId of sessionIds) {
      const hit = workspaces.find(workspace => workspace.sessionIds.includes(sessionId))
      if (hit !== undefined) return hit.workspaceId
    }
    return undefined
  }

  if (input.currentSessionId !== undefined) {
    const source = bySession([input.currentSessionId])
    if (source !== undefined) return source
  }

  if (input.linkedSessionIds !== undefined && input.linkedSessionIds.length !== 0) {
    const linked = bySession(input.linkedSessionIds)
    if (linked !== undefined) return linked
  }

  const repoName = basename(input.repo)
  const directory = workspaces.find(workspace => (
    (workspace.path !== undefined && basename(workspace.path) === repoName)
    || (workspace.title !== undefined && workspace.title.toLowerCase() === repoName)
  ))
  if (directory !== undefined) return directory.workspaceId

  return undefined
}
