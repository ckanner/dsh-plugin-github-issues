/**
 * The browser surface this plugin runs against.
 *
 * Transcribed from the shipped client packages the plugin consumes. Every member
 * exists in DSH 0.2.1-rc.3; keeping the declarations local means the bundle imports
 * no Harness client package as a module (only React is external), which is the
 * upgrade-safe arrangement for an out-of-tree plugin.
 *
 * @module dsh-plugin-github-issues/client/context
 */

import type { ComponentType, ReactNode } from 'react'

/** One slot entry's registration options. */
export interface SlotRegistrationOptions {
  /** Exact slot key this entry registers into. */
  name: string
  /** Cell key a `keyed` slot dispatches by. */
  key?: string
  /** Entry id a `list` slot orders and deduplicates by. */
  id?: string
  /** Sort position within the slot. */
  order?: number
  /** Label the owner may render beside the cell. */
  label?: string | (() => string)
  /** Locale namespace this entry's text belongs to. */
  locale?: string
  /** Props merged into the slot component. */
  inject?: () => Record<string, unknown>
}

/**
 * The renderer a slot entry exposes.
 *
 * `any` is deliberate: the renderer spreads a framework-provided prop kit (the
 * session standard props, owner props, and injected props) into the component, and
 * each entry narrows it locally.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SlotEntry = ComponentType<any> | (() => ReactNode)

/**
 * Cordis dynamic service injection: run `callback` in a scoped context once all
 * listed services are available, and dispose its registrations with the plugin.
 * Used for services a profile may omit (the right sidebar), so their absence
 * never keeps the core panel from activating.
 */
export interface ContextInject {
  inject(deps: string[], callback: (scoped: ClientContext) => void): () => void
}

/** The browser slot registry. */
export interface SlotService {
  /** Run `register` for every occurrence of one slot key. */
  inject(name: string, register: () => unknown): () => void
  /** Register one entry for one exact slot occurrence. */
  register(options: SlotRegistrationOptions, entry: SlotEntry): () => void
}

/** A dictionary resolver for one namespace; `{name}` placeholders are interpolated. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string

/** The locale registry and active-language owner. */
export interface LocaleService {
  /** Register dictionaries for one namespace, keyed by locale id (`en`, `zh`). */
  register(ns: string, dicts: Record<string, Record<string, string>>): () => void
  /** Bind one namespace to a translate function. */
  bind(ns: string): Translate
}

/** The `ctx.remote` gateway, narrowed to the one call this plugin makes. */
export interface RemoteService {
  /**
   * Install this package's hand-written Remote descriptors.
   * @param contribution - `{package, descriptors}`.
   * @returns a disposer, once the namespace service is published.
   */
  $mount(contribution: unknown): Promise<() => Promise<void>>
}

/** Layout navigation. */
export interface LayoutService {
  /**
   * Select a main panel by key; `null` returns to the Conversation.
   * @param panelId - a registered `main` key, or `null`.
   */
  selectPanel(panelId: string | null): void
}

/** Workspace navigation used by the handoff fallback. */
export interface UiWorkspaceService {
  /**
   * Start (or focus) a blank Session, optionally seeding the composer.
   * @param workspaceId - target workspace.
   * @param options - draft seed and preset.
   */
  startSession(workspaceId?: string, options?: {
    prompt?: string
    whenDraftExists?: 'keep' | 'replace' | 'append'
    clearPreviousDraft?: boolean
    agentPreset?: string
  }): void
  /** Create or reuse a workspace's blank Session without navigating. */
  connectWorkspace(workspaceId: string, options?: { agentPreset?: string }): Promise<string>
  /** Navigate to one Session. */
  openSession(sessionId: string): void
}

/** Session retention and scope addressing. */
export interface SessionsService {
  /**
   * Hold one Session reference while the callback runs.
   * @param sessionId - the Session to retain.
   * @param options - source tag and cancellation.
   * @param operation - runs inside the retained generation.
   */
  using<T>(sessionId: string, options: unknown, operation: (reference: unknown) => Promise<T>): Promise<T>
  /** Address one Session's scoped services. */
  scope(sessionId: string): { conversation: { send(text: string): Promise<void> } }
}

/** The composer action face, as `inputActions` reaches a session slot. */
export interface InputActions {
  /** Snapshot the caret for a subsequent {@link InputActions.insertText}. */
  captureInsertion(): { draftRev: number } & Record<string, unknown>
  /** Insert one undoable plain-text edit while that draft revision is current. */
  insertText(text: string, span: { draftRev: number } & Record<string, unknown>): boolean
  /** Replace the whole draft with plain text. */
  setDraft(text: string): void
  /** Persist the current draft through the conversation store. */
  persistDraft(): void
  /** Attach previously created draft attachments by id. */
  addAttachments(ids: string[]): void
  /** Remove one draft attachment. */
  removeAttachment(id: string): void
  /** Keep only the given draft attachments. */
  pruneAttachments(ids: string[]): void
  /** Submit the current draft as a queued prompt. */
  submit(): void
}

/** The composer's published state. */
export interface InputState {
  draft: string
  phase: 'plain' | 'claimed' | 'adjudicating' | 'submitting'
  attachmentIds: readonly string[]
}

/** The Session catalog the sidebar and schedule plugins project from. */
export interface SessionsSnapshot {
  phase?: string
  ids?: readonly string[]
  byId?: Record<string, { title?: string | null } | undefined>
}

/** One workspace entry in the workspace catalog. */
export interface WorkspaceEntrySnapshot {
  workspaceId?: string
  title?: string | null
  sessionIds?: readonly string[]
}

/** The workspace catalog snapshot. */
export interface WorkspacesSnapshot {
  phase?: string
  state?: string
  items?: readonly WorkspaceEntrySnapshot[]
  archivedSessionIds?: readonly string[]
}

/** A snapshot source that can be subscribed to. */
export interface SnapshotSource<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/**
 * A plain bridge to the Cordis context.
 *
 * Reading a service *property* on the context (`ctx.sessions`) requires it to be
 * declared in the plugin's `inject` list and throws otherwise; a render must never
 * depend on that. The plugin hands the React tree this lazy `getService` instead,
 * so services are resolved at use time through `ctx.get`.
 */
export interface ClientRuntime {
  /** Read one optional service by key; never throws for an absent service. */
  getService(name: string): unknown
}

/** A right-sidebar page type, as the sidebar-right plugin's registry accepts it. */
export interface SidebarRightTabsService {
  /** Register one tab type for the caller's lifetime. */
  register(definition: {
    id: string
    kind: string
    title(address: string): string
    priority?: 'builtin' | 'extension' | 'fallback'
    multiple?: boolean
    patterns?: string[]
    guide?: { id: string, title(): string, order?: number }[]
  }): () => void
}

/** The client plugin context. */
export interface ClientContext {
  /** Read one service by key (used for the plugin's own Remote namespace). */
  get(name: string): unknown
  remote: RemoteService
  slots: SlotService
  locale: LocaleService
  /**
   * Register a resource owned by this plugin instance.
   * @param callback - creates the resource and returns its cleanup.
   * @param name - optional label shown in cordis diagnostics.
   */
  effect(callback: () => () => void, name?: string): () => void
  /** Run registrations in a scope that waits for the listed services. */
  inject(deps: string[], callback: (scoped: ClientContext) => void): () => void
  layout?: LayoutService
  uiWorkspace?: UiWorkspaceService
  sessions?: SessionsService
}

/** The standard session props a `scope: session` slot component receives. */
export interface SessionKit {
  sessionId?: string
  inputActions?: InputActions
  useInput?: <T>(selector: (state: InputState) => T) => T
}
