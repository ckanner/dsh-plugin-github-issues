/**
 * The bundle's Host entry point.
 *
 * A bundle is a configuration layer, so this module exists to do the one thing a
 * layer cannot: own the live GitHub service and the machine-local preferences, and
 * expose them to the browser through the plugin's own Remote namespace.
 *
 * @module dsh-plugin-github-issues
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

import { GitHubIssuesController } from './controller.ts'
import { probeGh, resolveToken } from './github/auth.ts'
import { createGitHubApi } from './github/client.ts'
import { PrefsStore } from './github/state.ts'

/** What this plugin calls itself in diagnostics. */
export const name = 'github-issues'

/**
 * Everything an installation may tune.
 *
 * No token lives here on purpose: the deployment's patch and its `.bak` copies
 * would duplicate it. The token is read from the machine's `gh` CLI at call time.
 */
export const Config = z.object({
  /** How the Host obtains a token; `gh` is the only mode in v0.1. */
  authMode: z.string().default('gh'),
  /** GitHub host, `github.com` or a GitHub Enterprise hostname. */
  host: z.string().default('github.com'),
  /** Explicit `gh` executable path, when the app's PATH cannot find one. */
  ghPath: z.string().default(''),
  /** Default handoff behavior: `draft` fills the composer, `send` submits it. */
  handoffMode: z.string().default('draft'),
  /** Seconds between list refreshes while the panel is visible. */
  pollSeconds: z.number().default(90),
  /** Directory for non-secret UI state; defaults to `$DSH_HOME/github-issues`. */
  stateDir: z.string().default(''),
  /** Default prompt template; empty means the built-in one. */
  promptTemplate: z.string().default(''),
})

/** The configuration one installation supplies, as the harness resolves it. */
export type Config = {
  authMode: string
  host: string
  ghPath: string
  handoffMode: string
  pollSeconds: number
  stateDir: string
  promptTemplate: string
}

/**
 * Register the GitHub service.
 * @param ctx - the plugin context.
 * @param config - the installation's configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const stateDir = config.stateDir === ''
    ? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'github-issues')
    : config.stateDir

  const prefs = new PrefsStore(stateDir, config.handoffMode, config.promptTemplate)
  new GitHubIssuesController(ctx, {
    probeGh,
    resolveToken,
    createApi: createGitHubApi,
    prefs,
    config: {
      authMode: config.authMode,
      host: config.host,
      ghPath: config.ghPath,
      handoffMode: config.handoffMode,
      pollSeconds: config.pollSeconds,
    },
  })
}
