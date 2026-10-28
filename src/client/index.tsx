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

import { DockHost, GitHubRailIcon, InputHost, PageHost, SettingsHost, SidebarHost } from './containers.tsx'
import type { ClientContext, ClientRuntime, SidebarRightTabsService } from './context.ts'
import { DICTS, NS } from './locale.ts'
import { remoteContribution } from './remote.ts'
import { GitHubStore } from './store.ts'

/** The `main` panel key and the `sidebar.panellist` id that addresses it. */
const PANEL_ID = 'github'

/** The settings section id this plugin owns. */
const SETTINGS_ID = 'github-issues'

/** The right-sidebar page type id this plugin owns. */
const SIDEBAR_KIND = 'github-issues'

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

  // `ctx.get` requires no `inject` declaration and never throws for an absent
  // service; property access on the context proxy does. Keep that detail here.
  const runtime: ClientRuntime = {
    getService: name => ctx.get(name),
  }

  const store = new GitHubStore(ctx, runtime, mounting)
  ctx.effect(() => {
    store.start()
    return () => { store.stop() }
  }, 'github-issues: store')

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({ store, t, runtime }),
  }, PageHost))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 20,
    locale: NS,
    label: () => t('panel'),
  }, GitHubRailIcon))

  // The chip row rides the compact dock *below* the composer, next to the
  // shipped step/token/cache meters. It is an inline chip (not a full-width
  // bar), and `order: -10` puts it first so those meters keep their place.
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'github-issues-handoff',
    order: -10,
    locale: NS,
    inject: () => ({ store, t, runtime }),
  }, DockHost))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SETTINGS_ID,
    order: 30,
    locale: NS,
    label: () => t('settings.title'),
    inject: () => ({ store, t }),
  }, SettingsHost))

  // Above the composer: the pending handoff chip (attachment-like) and the drop
  // target for drags out of the right column. Both render nothing when idle.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'github-issues-input',
    order: 25,
    locale: NS,
    inject: () => ({ store, t }),
  }, InputHost))

  // The right sidebar may be absent from a profile; registering its page type
  // inside a dynamic inject scope keeps the panel independent from it.
  ctx.inject(['sidebarRightTabs'], scoped => {
    const tabs = (scoped as unknown as { sidebarRightTabs: SidebarRightTabsService }).sidebarRightTabs
    scoped.effect(() => tabs.register({
      id: SIDEBAR_KIND,
      kind: SIDEBAR_KIND,
      priority: 'extension',
      title: () => t('sidebar.tab'),
      guide: [{ id: SIDEBAR_KIND, title: () => t('sidebar.tab'), order: 45 }],
    }), 'github-issues: right-sidebar type')
    scoped.slots.inject('sidebar.right.pane.tab', () => scoped.slots.register({
      name: 'sidebar.right.pane.tab',
      key: SIDEBAR_KIND,
      locale: NS,
      inject: () => ({ store, t }),
    }, SidebarHost))
  })
}
