/**
 * The plugin's non-secret state file.
 *
 * Preferences (which repo or project the panel shows, the pinned issue, the
 * handoff template) are not credentials, so they live in the plugin's own
 * directory instead of the DSH settings profile: the profile patch is rewritten
 * by upgrades and its `.bak` copies would duplicate whatever is written there.
 *
 * @module dsh-plugin-github-issues/github/state
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { mergePrefs, type IssueLinkRecord, type IssueSessionLinkVM, type Prefs } from '../vm.ts'

/** How many links one installation keeps; older handoffs fall off the tail. */
const MAX_LINKS = 500

/** What the state file holds. */
interface StateFile {
  version: 2
  prefs: Prefs
  links: IssueLinkRecord[]
}

/** Clamp one untrusted patch value to a known preference list. */
function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T
    : fallback
}

/** Read one optional string, treating an empty string as absent. */
function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Apply a browser-supplied preference patch onto the current preferences.
 * @param current - the preferences currently stored.
 * @param patch - the untrusted patch.
 * @returns the next preferences, with every field validated.
 */
export function applyPrefsPatch(current: Prefs, patch: unknown): Prefs {
  if (typeof patch !== 'object' || patch === null) return current
  const input = patch as Record<string, unknown>
  const next: Prefs = { ...current }
  if ('state' in input) next.state = pick(input.state, ['open', 'closed', 'all'] as const, current.state)
  if ('assignee' in input) {
    const assignee = typeof input.assignee === 'string' ? input.assignee.trim() : ''
    if (assignee === '@me' || assignee === 'all' || /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(assignee)) next.assignee = assignee
  }
  if ('org' in input) next.org = optionalString(input.org)
  if ('repo' in input) next.repo = optionalString(input.repo)
  if ('handoffMode' in input) next.handoffMode = pick(input.handoffMode, ['draft', 'send'] as const, current.handoffMode)
  if ('repo' in input) next.repo = optionalString(input.repo)
  if ('projectId' in input) next.projectId = optionalString(input.projectId)
  if ('milestone' in input) {
    const milestone = optionalString(input.milestone)?.trim()
    next.milestone = milestone === undefined || milestone === '' ? undefined : milestone.slice(0, 200)
  }
  if ('org' in input) next.org = optionalString(input.org)
  if ('promptTemplate' in input) {
    const template = typeof input.promptTemplate === 'string' ? input.promptTemplate : ''
    next.promptTemplate = template === '' ? current.promptTemplate : template.slice(0, 4_000)
  }
  if ('pinned' in input) {
    const pinned = input.pinned
    if (pinned === null || pinned === undefined) {
      next.pinned = undefined
    } else if (typeof pinned === 'object') {
      const { repo, number } = pinned as { repo?: unknown; number?: unknown }
      if (typeof repo === 'string' && repo.includes('/') && typeof number === 'number' && Number.isInteger(number) && number > 0) {
        next.pinned = { repo, number }
      }
    }
  }
  return next
}

/** File-backed preference storage for one installation. */
export class PrefsStore {
  private readonly stateDir: string
  private readonly configureHandoff: string | undefined
  private readonly configureTemplate: string | undefined
  private readonly file: string
  private readonly directory: string
  private cached: Prefs | undefined
  private cachedLinks: IssueLinkRecord[] | undefined

  /**
   * @param stateDir - owner-only directory this installation's state lives in.
   * @param configureHandoff - the deployment's default handoff mode.
   * @param configureTemplate - the deployment's default prompt template.
   */
  constructor(stateDir: string, configureHandoff: string | undefined, configureTemplate: string | undefined) {
    this.stateDir = stateDir
    this.configureHandoff = configureHandoff
    this.configureTemplate = configureTemplate
    this.directory = stateDir
    this.file = join(stateDir, 'state.json')
  }

  /** Read the current preferences, creating defaults on first use. */
  load(): Prefs {
    if (this.cached !== undefined) return this.cached
    const saved = this.readFile()?.prefs
    this.cached = mergePrefs(saved, this.configureHandoff, this.configureTemplate)
    return this.cached
  }

  /** Every recorded issue → session link, oldest first. */
  links(): IssueLinkRecord[] {
    if (this.cachedLinks !== undefined) return this.cachedLinks
    const links = this.readFile()?.links
    this.cachedLinks = Array.isArray(links)
      ? links.filter((link): link is IssueLinkRecord => {
        if (typeof link !== 'object' || link === null) return false
        const record = link as Partial<IssueLinkRecord>
        return typeof record.repo === 'string' && typeof record.number === 'number'
          && typeof record.sessionId === 'string' && typeof record.at === 'number'
      })
      : []
    return this.cachedLinks
  }

  /** The links recorded for one issue, newest last. */
  linksFor(repo: string, number: number): IssueSessionLinkVM[] {
    return this.links()
      .filter(link => link.repo === repo && link.number === number)
      .map(link => ({ sessionId: link.sessionId, at: link.at }))
  }

  /** Record one issue → session handoff, idempotently. */
  link(repo: string, number: number, sessionId: string): IssueLinkRecord[] {
    const existing = this.links()
    const already = existing.some(link => link.repo === repo && link.number === number && link.sessionId === sessionId)
    if (already) return existing
    const next = [...existing, { repo, number, sessionId, at: Date.now() }].slice(-MAX_LINKS)
    this.cachedLinks = next
    this.writeFile(next)
    return next
  }

  /** Remove one link (or every link for the issue when `sessionId` is omitted). */
  unlink(repo: string, number: number, sessionId?: string): IssueLinkRecord[] {
    const next = this.links().filter(link => {
      if (link.repo !== repo || link.number !== number) return true
      return sessionId === undefined ? false : link.sessionId !== sessionId
    })
    this.cachedLinks = next
    this.writeFile(next)
    return next
  }

  /** Read the state file once, tolerating absence, v1 files, and corruption. */
  private readFile(): { prefs?: Partial<Prefs>; links?: unknown } | undefined {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as {
        version?: unknown
        prefs?: unknown
        links?: unknown
      }
      if (typeof parsed !== 'object' || parsed === null) return undefined
      if (parsed.version !== 1 && parsed.version !== 2) return undefined
      const prefs = typeof parsed.prefs === 'object' && parsed.prefs !== null
        ? parsed.prefs as Partial<Prefs>
        : undefined
      return { ...prefs === undefined ? {} : { prefs }, links: parsed.links }
    } catch {
      return undefined
    }
  }

  /** Merge one patch into the stored preferences and persist them. */
  save(patch: unknown): Prefs {
    const next = applyPrefsPatch(this.load(), patch)
    this.cached = next
    this.writeFile(this.links())
    return next
  }

  /** Write the whole state document atomically with owner-only permissions. */
  private writeFile(links: IssueLinkRecord[]): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    try {
      chmodSync(this.directory, 0o700)
    } catch {
      // A pre-existing directory may not be ours to chmod; the write still works.
    }
    const text = `${JSON.stringify({ version: 2, prefs: this.cached ?? this.load(), links } satisfies StateFile, null, 2)}\n`
    const temporary = `${this.file}.tmp-${String(process.pid)}`
    writeFileSync(temporary, text, { mode: 0o600 })
    renameSync(temporary, this.file)
  }
}
