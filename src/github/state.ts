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

import { mergePrefs, type Prefs } from '../vm.ts'

/** What the state file holds. */
interface StateFile {
  version: 1
  prefs: Prefs
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
  if ('view' in input) next.view = pick(input.view, ['assigned', 'created', 'open', 'repo', 'project'] as const, current.view)
  if ('state' in input) next.state = pick(input.state, ['open', 'closed', 'all'] as const, current.state)
  if ('handoffMode' in input) next.handoffMode = pick(input.handoffMode, ['draft', 'send'] as const, current.handoffMode)
  if ('repo' in input) next.repo = optionalString(input.repo)
  if ('projectId' in input) next.projectId = optionalString(input.projectId)
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
    let saved: Partial<Prefs> | undefined
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StateFile>
      if (parsed.version === 1 && typeof parsed.prefs === 'object' && parsed.prefs !== null) saved = parsed.prefs
    } catch {
      // No state yet, or it became unreadable: defaults are the honest answer.
    }
    this.cached = mergePrefs(saved, this.configureHandoff, this.configureTemplate)
    return this.cached
  }

  /** Merge one patch into the stored preferences and persist them. */
  save(patch: unknown): Prefs {
    const next = applyPrefsPatch(this.load(), patch)
    this.cached = next
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    try {
      chmodSync(this.directory, 0o700)
    } catch {
      // A pre-existing directory may not be ours to chmod; the write still works.
    }
    const text = `${JSON.stringify({ version: 1, prefs: next } satisfies StateFile, null, 2)}\n`
    const temporary = `${this.file}.tmp-${String(process.pid)}`
    writeFileSync(temporary, text, { mode: 0o600 })
    renameSync(temporary, this.file)
    return next
  }
}
