/**
 * Slot containers: the thin seam between the store and the pure renderers.
 *
 * Each exported component is what the slot registers. It reads the shared store
 * with `useSyncExternalStore`, resolves session titles from the page's own
 * session/workspace catalogs, and adds the browser-only plumbing (composer
 * actions, send detection for the handoff link, panel navigation) that a
 * presentational view should not know about.
 *
 * @module dsh-plugin-github-issues/client/containers
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type {
  ClientRuntime, SessionKit, SessionsSnapshot, SnapshotSource, Translate, WorkspacesSnapshot,
} from './context.ts'
import type { GitHubStore } from './store.ts'
import type { IssueCardVM, IssueLinkRecord } from '../vm.ts'
import { composeHandoffPrompt, EMPTY_DRAFT_HOLD } from '../prompt.ts'
import type { ComposerIssueChip, SessionLinkView } from './viewmodel.ts'
import { GitHubDock } from './views/Dock.tsx'
import { GitHubDropZone } from './views/DropZone.tsx'
import { GitHubIcon } from './views/Icon.tsx'
import { GitHubPendingChip } from './views/Pending.tsx'
import { GitHubPage } from './views/Page.tsx'
import { GitHubSettings } from './views/Settings.tsx'
import { GitHubSidebar } from './views/Sidebar.tsx'

/** Props every container receives through the slot's `inject`. */
interface ContainerProps {
  store: GitHubStore
  t: Translate
  runtime: ClientRuntime
}

/** A stable empty session catalog, so the hook order never depends on props. */
const EMPTY_SESSIONS: SessionsSnapshot = { byId: {} }

/** A stable empty workspace catalog. */
const EMPTY_WORKSPACES: WorkspacesSnapshot = { items: [] }

/** Subscribe one component to the shared store. */
function usePanel(store: GitHubStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

/** Subscribe one component to an optional snapshot catalog. */
function useCatalog<T>(source: SnapshotSource<T> | undefined, empty: T): T {
  const subscribe = useCallback(
    (listener: () => void) => source?.subscribe(listener) ?? (() => {}),
    [source],
  )
  const snapshot = useCallback(() => source?.getSnapshot() ?? empty, [source, empty])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * Resolve one session id against the page's catalogs.
 * @param sessions - the session catalog.
 * @param workspaces - the workspace catalog.
 * @param sessionId - the session to describe.
 * @returns its label, workspace, and availability.
 */
export function resolveSessionLink(
  sessions: SessionsSnapshot,
  workspaces: WorkspacesSnapshot,
  sessionId: string,
): SessionLinkView {
  const workspace = workspaces.items?.find(item => item.sessionIds?.includes(sessionId))
  const title = sessions.byId?.[sessionId]?.title
  const archived = workspaces.archivedSessionIds?.includes(sessionId) ?? false
  const known = sessions.byId?.[sessionId] !== undefined || workspace !== undefined
  return {
    sessionId,
    title: typeof title === 'string' && title.trim() !== '' ? title : sessionId,
    ...typeof workspace?.title === 'string' && workspace.title !== ''
      ? { workspaceTitle: workspace.title }
      : {},
    available: known && !archived,
  }
}

/** The full-page GitHub panel. */
export function PageHost({ store, t, runtime }: ContainerProps) {
  const snapshot = usePanel(store)
  const sessionCatalog = (runtime.getService('sessions') as { list?: SnapshotSource<SessionsSnapshot> } | undefined)?.list
  const workspaceCatalog = (runtime.getService('workspaces') as { list?: SnapshotSource<WorkspacesSnapshot> } | undefined)?.list
  const sessions = useCatalog(sessionCatalog, EMPTY_SESSIONS)
  const workspaces = useCatalog(workspaceCatalog, EMPTY_WORKSPACES)
  const resolveSession = useCallback(
    (sessionId: string) => resolveSessionLink(sessions, workspaces, sessionId),
    [sessions, workspaces],
  )
  return <GitHubPage snapshot={snapshot} actions={store} t={t} resolveSession={resolveSession} />
}

/** Props the dock slot's standard kit contributes. */
type DockKit = SessionKit

/** One minimal card for a link whose detail has not arrived yet. */
function placeholderCard(repo: string, number: number): IssueCardVM {
  return {
    id: `${repo}#${String(number)}`,
    repo,
    number,
    title: '',
    url: `https://github.com/${repo}/issues/${String(number)}`,
    state: 'OPEN',
    stateReason: null,
    isPrivate: false,
    labels: [],
    assignees: [],
    updatedAt: '',
    commentCount: 0,
    linkedPRs: [],
    sessionLinks: [],
  }
}

/** The composer dock: the linked-issue chips of this Session. */
export function DockHost({ store, t, runtime, sessionId }: ContainerProps & SessionKit) {
  const snapshot = usePanel(store)
  const sessionCatalog = (runtime.getService('sessions') as { list?: SnapshotSource<SessionsSnapshot> } | undefined)?.list
  const workspaceCatalog = (runtime.getService('workspaces') as { list?: SnapshotSource<WorkspacesSnapshot> } | undefined)?.list
  const sessions = useCatalog(sessionCatalog, EMPTY_SESSIONS)
  const workspaces = useCatalog(workspaceCatalog, EMPTY_WORKSPACES)
  const resolveSession = useCallback(
    (id: string) => resolveSessionLink(sessions, workspaces, id),
    [sessions, workspaces],
  )

  // The dock follows the session it is mounted for; links are global records.
  const sessionLinks = snapshot.links.filter(link => link.sessionId === sessionId)
  useEffect(() => {
    if (sessionLinks.length !== 0) void store.ensureCards(sessionLinks)
  }, [snapshot.links, store])

  const chips: ComposerIssueChip[] = []
  const seen = new Set<string>()
  for (const link of sessionLinks) {
    const key = `${link.repo}#${String(link.number)}`
    if (seen.has(key)) continue
    seen.add(key)
    const live = snapshot.linkCards[key]
    // A persisted link is enough to draw the chip: its detail may still be in
    // flight, and a failed detail request must not hide the session's issue.
    chips.push({
      card: live ?? placeholderCard(link.repo, link.number),
      state: live === undefined ? 'degraded' : 'linked',
      sessions: [resolveSession(link.sessionId)],
    })
  }

  return (
    <GitHubDock
      chips={chips}
      t={t}
      onRemoveChip={chip => {
        if (sessionId !== undefined) void store.unlinkSession(chip.card, sessionId)
      }}
      onOpenChip={chip => store.openInPanel(chip.card)}
    />
  )
}

/**
 * The pending handoff chip inside the composer card (`conversation.input.overlay`).
 *
 * The card carries the issue; the input stays empty for the user's own words. On
 * send (the native submit button or Enter) this component intercepts the gesture,
 * turns the card into the rendered issue prompt, appends whatever the user typed,
 * and submits that. Clearing the input withdraws the card without linking; the
 * link is recorded only after the send is observed.
 */
export function PendingOverlayHost({ store, t, sessionId, useInput, inputActions }: Omit<ContainerProps, 'runtime'> & { runtime?: ClientRuntime } & SessionKit) {
  const snapshot = usePanel(store)
  const [pending, setPending] = useState<IssueCardVM | undefined>(undefined)
  /** The marker was in the draft at least once (the prompt was actually written). */
  const markerSeen = useRef(false)
  /** The composer left `plain` while the marker was present: a send, not a manual clear. */
  const submitSeen = useRef(false)
  /** Guard against a double interception while the prepared draft is being submitted. */
  const sending = useRef(false)
  const marker = pending === undefined ? '' : `${pending.repo}#${String(pending.number)}`
  const input = useInput === undefined ? undefined : useInput(state => state)
  const latestInput = useRef(input)
  latestInput.current = input

  // The handoff stamped for this Session: stage it inside the composer once.
  useEffect(() => {
    const card = store.consumeHandoff(sessionId)
    if (card === undefined) return
    markerSeen.current = false
    submitSeen.current = false
    sending.current = false
    setPending(card)
    if (inputActions !== undefined) inputActions.setDraft(EMPTY_DRAFT_HOLD)
  }, [snapshot.pendingHandoff, snapshot.pendingHandoffSession, inputActions, sessionId, store])

  // Link only on an observed send; an emptied draft withdraws the pending card.
  useEffect(() => {
    if (pending === undefined || input === undefined || sessionId === undefined) return
    const text = input.draft
    if (text.includes(marker)) {
      markerSeen.current = true
      if (input.phase !== 'plain') submitSeen.current = true
    }
    if (markerSeen.current && submitSeen.current) {
      void store.linkIssue(pending, sessionId)
      setPending(undefined)
      markerSeen.current = false
      submitSeen.current = false
      sending.current = false
      return
    }
    if (text === '') {
      // The user emptied the composer: withdraw the card, link nothing.
      setPending(undefined)
      markerSeen.current = false
      submitSeen.current = false
      sending.current = false
      return
    }
    if (markerSeen.current && !text.includes(marker)) {
      setPending(undefined)
      markerSeen.current = false
      submitSeen.current = false
      sending.current = false
    }
  }, [input, pending, marker, sessionId, store])

  // The card is not text yet: intercept the native send gesture and compose.
  useEffect(() => {
    if (pending === undefined || inputActions === undefined) return
    const composerCard = (): HTMLElement | null => {
      const chip = document.querySelector('[data-github-pending]')
      const anchor = chip?.closest('[data-composer-overlay]')
      return anchor?.parentElement ?? null
    }
    const submitButton = (card: HTMLElement): Element | undefined => {
      const buttons = [...card.querySelectorAll('button')]
      return buttons.find(button => /_primary(\s|$)/.test(String(button.className)))
        ?? buttons[buttons.length - 1]
    }
    const send = (): void => {
      if (sending.current) return
      sending.current = true
      const composed = composeHandoffPrompt(store.promptFor(pending), latestInput.current?.draft ?? '')
      inputActions.setDraft(composed)
      // Let the draft commit before asking the composer to submit it.
      window.setTimeout(() => { inputActions.submit() }, 16)
    }
    const onClick = (event: MouseEvent): void => {
      const card = composerCard()
      if (card === null) return
      const button = (event.target as Element | null)?.closest('button')
      if (button === null || button === undefined || button.closest('[data-github-pending]') !== null) return
      if (button !== submitButton(card)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      send()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
      const card = composerCard()
      if (card === null) return
      const target = event.target as Element | null
      if (target === null || !card.contains(target) || target.closest('[data-github-pending]') !== null) return
      event.preventDefault()
      event.stopImmediatePropagation()
      send()
    }
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [pending, inputActions, store])

  if (pending === undefined) return null
  return (
    <GitHubPendingChip
      card={pending}
      t={t}
      onOpenPanel={() => store.openInPanel(pending)}
      onRemove={() => {
        setPending(undefined)
        markerSeen.current = false
        submitSeen.current = false
        sending.current = false
        inputActions?.setDraft('')
      }}
    />
  )
}

/**
 * The drop target above the composer (`conversation.input.dock`).
 *
 * It only renders while a drag is in flight; the whole window accepts the drop
 * (dropping back into the right column cancels). The staged handoff then shows in
 * the composer card through {@link PendingOverlayHost}.
 */
export function DropZoneHost({ store, t, sessionId }: Omit<ContainerProps, 'runtime'> & { runtime?: ClientRuntime, sessionId?: string }) {
  const snapshot = usePanel(store)
  const dragging = snapshot.dragging
  useEffect(() => {
    if (dragging === undefined) return
    const onDragOver = (event: DragEvent): void => {
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (event: DragEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-github-sidebar]') !== null && target !== null) {
        event.preventDefault()
        store.endDrag()
        return
      }
      event.preventDefault()
      store.dropHandoff(sessionId)
    }
    const onDragEnd = (): void => { store.endDrag() }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', onDragEnd)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', onDragEnd)
    }
  }, [dragging, sessionId, store])
  if (dragging === undefined) return null
  return (
    <GitHubDropZone
      dragging={dragging}
      t={t}
      onDrop={() => store.dropHandoff(sessionId)}
      onCancel={() => store.endDrag()}
    />
  )
}

/** The co-visible right-sidebar list; rows drag into the composer drop target. */
export function SidebarHost({ store, t }: Omit<ContainerProps, 'runtime'> & { runtime?: ClientRuntime }) {
  const snapshot = usePanel(store)
  return <GitHubSidebar snapshot={snapshot} actions={store} t={t} />
}

/** The GitHub section of the Settings page. */
export function SettingsHost({ store, t }: Omit<ContainerProps, 'runtime'> & { runtime?: ClientRuntime }) {
  const snapshot = usePanel(store)
  const resolveSession = (sessionId: string) => ({
    sessionId,
    title: sessionId,
    available: false,
  })
  return <GitHubSettings snapshot={snapshot} actions={store} t={t} resolveSession={resolveSession} />
}

/** The sidebar rail icon for the GitHub panel. */
export function GitHubRailIcon(props: { size?: number; active?: boolean }) {
  return <GitHubIcon {...props} />
}

/** Re-exported for the views' convenience. */
export type { IssueLinkRecord }
