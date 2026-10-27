/**
 * Resolving the machine's GitHub credential from the `gh` CLI.
 *
 * The plugin never asks for a token in its own UI: a developer machine that can
 * run `gh` can list and read issues, and `gh auth token` hands the Host the same
 * credential. Two invariants matter here:
 *
 * - **The token never leaves this module's success value.** It is not logged, not
 *   placed in an error message, and not read from the environment by this code.
 * - **A failure is always actionable.** "gh is missing", "not signed in", and
 *   "gh failed" are distinct codes with human messages, so the settings card can
 *   tell the user which of the three things to fix.
 *
 * @module dsh-plugin-github-issues/github/auth
 */

import { execFile } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'

import { GitHubApiError, type GhProbe, type ResolvedAuth } from './types.ts'

/** How long one `gh` invocation may take before it is killed. */
const GH_TIMEOUT_MS = 5_000

/** Where Homebrew and the system install `gh`; checked before falling back to PATH. */
const GH_CANDIDATES = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'] as const

/** The facts both auth helpers need; matches the controller's collaborator type. */
export interface GhAuthConfig {
  /** GitHub host to authorize against, e.g. `github.com` or a GHES hostname. */
  host: string
  /** Explicit `gh` executable path from Config; skips discovery when set. */
  ghPath?: string
}

/** The failure shape `execFile` reports for a missing, killed, or non-zero child. */
interface GhFailure extends Error {
  /** `ENOENT` when the executable is missing, `ABORT_ERR` when aborted, an exit code otherwise. */
  code?: string | number | null
  /** True when the process was killed (the `gh` timeout path). */
  killed?: boolean
}

/** One finished `gh` invocation. */
interface GhRun {
  stdout: string
  stderr: string
  /** Present when the process could not run, timed out, was aborted, or exited non-zero. */
  error?: GhFailure
}

/** One signed-in account as `gh auth status --json hosts` reports it. */
interface GhAccount {
  state?: string
  active?: boolean
  login?: string
  tokenSource?: string
  host?: string
  scopes?: unknown
}

/** One account plus the host key it was listed under. */
interface GhHostAccount {
  host: string
  account: GhAccount
}

/**
 * Resolve the `gh` executable to run.
 * An explicit Config value wins outright (the operator may point at a wrapper);
 * otherwise the usual install locations are tried and a bare `gh` is left for
 * PATH to resolve.
 * @param ghPath - explicit path from Config, if any.
 * @returns the executable path or the bare command name.
 */
export function resolveGhPath(ghPath?: string): string {
  const explicit = ghPath?.trim()
  if (explicit !== undefined && explicit !== '') return explicit
  for (const candidate of GH_CANDIDATES) {
    if (!existsSync(candidate)) continue
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Present but not executable: try the next location.
    }
  }
  return 'gh'
}

/** Build the error a caller sees when an operation was aborted. */
function abortReason(signal: AbortSignal | undefined): Error {
  const reason = signal?.reason
  if (reason instanceof Error) return reason
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

/** Whether a `gh` failure means the executable could not be started. */
function isMissingExecutable(error: GhFailure | undefined): boolean {
  return error !== undefined && (error.code === 'ENOENT' || error.code === 'EACCES')
}

/** Whether a `gh` failure came from an abort rather than gh itself. */
function isAbortError(error: GhFailure | undefined): boolean {
  return error !== undefined && (error.name === 'AbortError' || error.code === 'ABORT_ERR')
}

/**
 * Remove token-shaped text from a message before it can reach a log or an error.
 * `gh auth status` does not print tokens, but the redaction is cheap insurance
 * for a promise the module makes.
 */
function redactTokens(text: string): string {
  return text
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,})\b/g, '[redacted]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
}

/** Turn gh's stderr into one short, safe line. */
function safeGhMessage(text: string): string {
  const line = redactTokens(text).trim().split(/\r?\n/)[0] ?? ''
  return line.length > 300 ? `${line.slice(0, 299)}…` : line
}

/** Run `gh` without a shell, with a timeout and an optional abort signal. */
function runGh(bin: string, args: readonly string[], signal?: AbortSignal): Promise<GhRun> {
  return new Promise<GhRun>((resolve) => {
    execFile(
      bin,
      [...args],
      {
        encoding: 'utf8',
        timeout: GH_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        ...signal === undefined ? {} : { signal },
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          resolve({ stdout: stdout ?? '', stderr: stderr ?? '', error })
          return
        }
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '' })
      },
    )
  })
}

/** Read `scopes` as an array: newer gh prints a comma-separated string, older a list. */
function parseScopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
  if (typeof value === 'string') return value.split(',').map(scope => scope.trim()).filter(scope => scope !== '')
  return []
}

/** Flatten the `hosts` object into one entry per account, tolerating both gh shapes. */
function hostAccountsOf(hosts: unknown): GhHostAccount[] {
  if (typeof hosts !== 'object' || hosts === null) return []
  const entries: GhHostAccount[] = []
  for (const [host, value] of Object.entries(hosts as Record<string, unknown>)) {
    const accounts: GhAccount[] = Array.isArray(value)
      ? value.filter((entry): entry is GhAccount => typeof entry === 'object' && entry !== null)
      : typeof value === 'object' && value !== null ? [value as GhAccount] : []
    for (const account of accounts) entries.push({ host, account })
  }
  return entries
}

/** Pick the account for the configured host, else whichever host is active. */
function pickAccount(entries: readonly GhHostAccount[], host: string): GhHostAccount | undefined {
  const configured = entries.filter(entry => entry.host === host || entry.account.host === host)
  const fromConfigured = configured.find(entry => entry.account.active === true) ?? configured[0]
  if (fromConfigured !== undefined) return fromConfigured
  return entries.find(entry => entry.account.active === true)
}

/** The probe result for an account, exposing no secret. */
function probeOf(host: string, path: string, entry: GhHostAccount | undefined): GhProbe {
  if (entry === undefined) {
    return {
      installed: true,
      path,
      signedIn: false,
      host,
      scopes: [],
      error: `Not signed in to ${host}. Run: gh auth login --hostname ${host}`,
    }
  }
  const signedIn = entry.account.state === 'success'
  const login = typeof entry.account.login === 'string' && entry.account.login !== ''
    ? entry.account.login
    : undefined
  const tokenSource = typeof entry.account.tokenSource === 'string' && entry.account.tokenSource !== ''
    ? entry.account.tokenSource
    : undefined
  return {
    installed: true,
    path,
    signedIn,
    host: typeof entry.account.host === 'string' && entry.account.host !== '' ? entry.account.host : entry.host,
    scopes: parseScopes(entry.account.scopes),
    ...login === undefined ? {} : { login },
    ...tokenSource === undefined ? {} : { tokenSource },
    ...signedIn ? {} : { error: `The gh account on ${entry.host} is not usable. Run: gh auth login --hostname ${entry.host}` },
  }
}

/**
 * Read what `gh auth status` says about this machine.
 * Never throws for a missing CLI or a signed-out host — those are described by
 * the returned value, because not being signed in is a normal first-run state.
 * Only an abort is rethrown.
 * @param config - host and optional explicit executable path.
 * @param signal - cancellation signal, forwarded to the child process.
 * @returns the probe facts, with `installed` false when gh cannot be started.
 */
export async function probeGh(config: GhAuthConfig, signal?: AbortSignal): Promise<GhProbe> {
  const path = resolveGhPath(config.ghPath)
  const run = await runGh(path, ['auth', 'status', '--json', 'hosts'], signal)
  if (isAbortError(run.error)) throw abortReason(signal)
  if (isMissingExecutable(run.error)) {
    return {
      installed: false,
      signedIn: false,
      scopes: [],
      error: 'The GitHub CLI (gh) is not installed. Install it from https://cli.github.com, then run: gh auth login',
    }
  }
  const failure = run.error
  let parsed: unknown
  try {
    parsed = JSON.parse(run.stdout)
  } catch {
    parsed = undefined
  }
  if (parsed === undefined) {
    const detail = safeGhMessage(run.stderr)
    return {
      installed: true,
      signedIn: false,
      scopes: [],
      error: detail === ''
        ? `gh auth status did not print usable JSON${failure?.killed === true ? ' (timed out)' : ''}.`
        : `gh auth status failed: ${detail}`,
    }
  }
  const hosts = (parsed as { hosts?: unknown }).hosts
  return probeOf(config.host, path, pickAccount(hostAccountsOf(hosts), config.host))
}

/**
 * Resolve the token for the configured host via `gh auth token`.
 * A token is accepted only from a successful invocation; every failure path
 * throws a {@link GitHubApiError} whose message is safe to render.
 * @param config - host and optional explicit executable path.
 * @param signal - cancellation signal, forwarded to the child process.
 * @returns the token plus the account facts the settings card shows.
 */
export async function resolveToken(config: GhAuthConfig, signal?: AbortSignal): Promise<ResolvedAuth> {
  const path = resolveGhPath(config.ghPath)
  const run = await runGh(path, ['auth', 'token', '--hostname', config.host], signal)
  if (isAbortError(run.error)) throw abortReason(signal)
  if (isMissingExecutable(run.error)) {
    throw new GitHubApiError(
      'The GitHub CLI (gh) is not installed. Install it from https://cli.github.com, then run: gh auth login',
      'gh_missing',
    )
  }
  const token = run.stdout.trim().split(/\r?\n/)[0] ?? ''
  if (run.error !== undefined && run.error.killed === true) {
    throw new GitHubApiError(
      `gh auth token did not answer within ${String(GH_TIMEOUT_MS / 1_000)} s.`,
      'gh_failed',
    )
  }
  if (run.error !== undefined || token === '') {
    const detail = safeGhMessage(run.stderr)
    const signedOut = token === ''
      && (detail === '' || /not logged|no oauth token|not signed in|logged out/i.test(detail))
    if (signedOut) {
      throw new GitHubApiError(
        `Not signed in to ${config.host} via the gh CLI. Run: gh auth login --hostname ${config.host}`,
        'gh_not_signed_in',
      )
    }
    throw new GitHubApiError(
      `gh could not produce a token for ${config.host}${detail === '' ? '.' : `: ${detail}`}`,
      'gh_failed',
    )
  }
  // The token is already usable; a probe failure only loses the cosmetic facts.
  let probe: GhProbe | undefined
  try {
    probe = await probeGh(config, signal)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    probe = undefined
  }
  return {
    token,
    source: 'gh',
    host: config.host,
    scopes: probe?.scopes ?? [],
    ...probe?.login === undefined ? {} : { login: probe.login },
  }
}
