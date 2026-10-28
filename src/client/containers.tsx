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
import type { ComposerIssueChip, SessionLinkView } from './viewmodel.ts'
import { GitHubDock } from './views/Dock.tsx'
import { GitHubIcon } from './views/Icon.tsx'
import { GitHubPage } from './views/Page.tsx'
import { GitHubSettings } from './views/Settings.tsx'

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

/** The composer dock: chips for linked issues and the send-detection seam. */
export function DockHost({ store, t, runtime, inputActions, sessionId, useInput }: ContainerProps & DockKit) {
  const snapshot = usePanel(store)
  const sessionCatalog = (runtime.getService('sessions') as { list?: SnapshotSource<SessionsSnapshot> } | undefined)?.list
  const workspaceCatalog = (runtime.getService('workspaces') as { list?: SnapshotSource<WorkspacesSnapshot> } | undefined)?.list
  const sessions = useCatalog(sessionCatalog, EMPTY_SESSIONS)
  const workspaces = useCatalog(workspaceCatalog, EMPTY_WORKSPACES)
  const resolveSession = useCallback(
    (id: string) => resolveSessionLink(sessions, workspaces, id),
    [sessions, workspaces],
  )
  // The session slot always contributes `useInput`; the optional call keeps the
  // component usable in a composition that omits the conversation.
  const input = useInput === undefined ? undefined : useInput(state => state)
  const [draft, setDraft] = useState<IssueCardVM | undefined>(undefined)
  const lastDraft = useRef('')
  const marker = draft === undefined ? '' : `${draft.repo}#${String(draft.number)}`

  // One-click handoff switches to the Conversation; when its dock mounts, the
  // pending issue is written into the composer exactly once.
  useEffect(() => {
    const pending = store.consumeHandoff()
    if (pending === undefined) return
    setDraft(pending)
    if (inputActions !== undefined) {
      inputActions.setDraft(store.promptFor(pending))
      if (store.getSnapshot().prefs.handoffMode === 'send') inputActions.submit()
    }
  }, [snapshot.pendingHandoff, inputActions, store])

  // `conversation.input.dock` is a session slot: the renderer only mounts it for
  // a real session, so the links of that session are the chips to resolve.
  const sessionLinks = snapshot.links.filter(link => link.sessionId === sessionId)
  useEffect(() => {
    if (sessionLinks.length !== 0) void store.ensureCards(sessionLinks)
  }, [snapshot.links, store])

  // A staged prompt becomes a recorded handoff when it is actually submitted: the
  // composer clears after a send (or the user empties it), and the phase passes
  // through a non-idle value while the prompt round-trips.
  useEffect(() => {
    if (draft === undefined || input === undefined || sessionId === undefined) return
    const text = input.draft
    const contained = lastDraft.current.includes(marker)
    lastDraft.current = text
    const submitting = input.phase === 'submitting' || input.phase === 'adjudicating'
    const leftTheComposer = contained && text === ''
    if ((submitting && text.includes(marker)) || leftTheComposer) {
      void store.linkIssue(draft, sessionId)
      setDraft(undefined)
      return
    }
    // The user replaced the prompt with something else: no handoff happened.
    if (text !== '' && !text.includes(marker)) setDraft(undefined)
  }, [input, draft, marker, sessionId, store])

  /** Fill the draft and remember it as the session's pending handoff. */
  const insert = (card: IssueCardVM): void => {
    if (inputActions === undefined) return
    setDraft(card)
    lastDraft.current = ''
    inputActions.setDraft(store.promptFor(card))
  }

  /** Fill, submit, and record the handoff immediately. */
  const send = (card: IssueCardVM): void => {
    if (inputActions === undefined || sessionId === undefined) return
    inputActions.setDraft(store.promptFor(card))
    inputActions.submit()
    void store.linkIssue(card, sessionId)
  }

  /** Insert dropped plain text at the caret, falling back to replacing the draft. */
  const dropText = (text: string): void => {
    if (inputActions === undefined || text === '') return
    const span = inputActions.captureInsertion()
    if (!inputActions.insertText(text, span)) inputActions.setDraft(text)
  }

  const chips: ComposerIssueChip[] = []
  if (draft !== undefined) {
    chips.push({ card: draft, state: 'draft', sessions: [] })
  }
  const seen = new Set<string>([...draft === undefined ? [] : [`${draft.repo}#${String(draft.number)}`]])
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
      snapshot={snapshot}
      actions={store}
      t={t}
      resolveSession={resolveSession}
      {...sessionId === undefined ? {} : { sessionId }}
      {...inputActions === undefined ? {} : { inputActions }}
      composerReady={inputActions !== undefined}
      onInsert={insert}
      onSend={send}
      onDropIssue={card => { insert(card) }}
      onDropText={dropText}
      chips={chips}
      onRemoveChip={chip => {
        if (chip.state === 'draft') {
          setDraft(undefined)
          inputActions?.setDraft('')
          return
        }
        if (sessionId !== undefined) void store.unlinkSession(chip.card, sessionId)
      }}
      onOpenChip={chip => store.openInPanel(chip.card)}
    />
  )
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
