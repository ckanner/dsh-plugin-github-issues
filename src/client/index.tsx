/**
 * The browser half's entry point.
 *
 * It registers the plugin's dictionaries, mounts the hand-written Remote
 * namespace the browser calls through, and contributes four slot entries: the
 * full-page GitHub panel beside the Conversation, its sidebar rail icon, the
 * composer dock strip that hands an issue to the agent, and the GitHub settings
 * page.
 *
 * @module dsh-plugin-github-issues/client
 */

import { DockHost, GitHubRailIcon, PageHost, SettingsHost } from './containers.tsx'
import type { ClientContext } from './context.ts'
import { DICTS, NS } from './locale.ts'
import { remoteContribution } from './remote.ts'
import { GitHubStore } from './store.ts'

/** The `main` panel key and the `sidebar.panellist` id that addresses it. */
const PANEL_ID = 'github'

/** The settings section id this plugin owns. */
const SETTINGS_ID = 'github-issues'

/** Services this plugin consumes from the page. */
export const inject = ['slots', 'locale', 'remote']

/**
 * Register the panels, mount the namespace, and start the store.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, DICTS), 'github-issues: dictionaries')
  const t = ctx.locale.bind(NS)

  // Nothing in the generated aggregate carries this namespace, so it is mounted
  // here. The store waits for it to publish before its first call.
  const mounting: Promise<string | undefined> = ctx.remote.$mount(remoteContribution()).then(
    () => undefined,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )

  const store = new GitHubStore(ctx, mounting)
  ctx.effect(() => {
    store.start()
    return () => { store.stop() }
  }, 'github-issues: store')

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({ store, t }),
  }, PageHost))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 20,
    locale: NS,
    label: () => t('panel'),
  }, GitHubRailIcon))

  // `conversation.input.dock` is the full-width seat above the composer card.
  // The strip must not share the compact dock row below the composer with the
  // shipped activity/usage pills: it is a full-width bar, and there it pushed
  // those chips out of view.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'github-issues-handoff',
    order: 30,
    locale: NS,
    inject: () => ({ store, t }),
  }, DockHost))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SETTINGS_ID,
    order: 30,
    locale: NS,
    label: () => t('settings.title'),
    inject: () => ({ store, t }),
  }, SettingsHost))
}
