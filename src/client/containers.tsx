/**
 * Slot containers: the thin seam between the store and the pure renderers.
 *
 * Each exported component is what the slot registers. It reads the shared store
 * with `useSyncExternalStore`, passes the plain snapshot down, and adds the
 * browser-only plumbing (composer actions, clipboard, panel navigation) that a
 * presentational view should not know about.
 *
 * @module dsh-plugin-github-issues/client/containers
 */

import { useEffect, useSyncExternalStore } from 'react'

import type { ClientContext, SessionKit, Translate } from './context.ts'
import type { GitHubStore } from './store.ts'
import type { IssueCardVM } from '../vm.ts'
import { GitHubDock } from './views/Dock.tsx'
import { GitHubIcon } from './views/Icon.tsx'
import { GitHubPage } from './views/Page.tsx'
import { GitHubSettings } from './views/Settings.tsx'

/** Props every container receives through the slot's `inject`. */
interface ContainerProps {
  store: GitHubStore
  t: Translate
}

/** Subscribe one component to the shared store. */
function usePanel(store: GitHubStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

/** The full-page GitHub panel. */
export function PageHost({ store, t }: ContainerProps) {
  const snapshot = usePanel(store)
  return <GitHubPage snapshot={snapshot} actions={store} t={t} />
}

/** The composer dock strip, which also consumes a one-click handoff. */
export function DockHost({ store, t, inputActions, sessionId }: ContainerProps & SessionKit) {
  const snapshot = usePanel(store)

  // A one-click handoff switches to the Conversation; when its dock mounts, the
  // pending issue is written into the composer exactly once.
  useEffect(() => {
    const pending = store.consumeHandoff()
    if (pending !== undefined && inputActions !== undefined) {
      void store.insertIntoComposer(pending, inputActions)
    }
    // The pending handoff is the trigger; consuming it re-renders with undefined.
  }, [snapshot.pendingHandoff, inputActions, store])

  /** Fill the draft, regardless of the configured handoff mode. */
  const insert = (card: IssueCardVM): void => {
    if (inputActions === undefined) return
    inputActions.setDraft(store.promptFor(card))
  }

  /** Fill the draft and send it immediately. */
  const send = (card: IssueCardVM): void => {
    if (inputActions === undefined) return
    inputActions.setDraft(store.promptFor(card))
    inputActions.submit()
  }

  /** Insert dropped plain text at the caret, falling back to replacing the draft. */
  const dropText = (text: string): void => {
    if (inputActions === undefined || text === '') return
    const span = inputActions.captureInsertion()
    if (!inputActions.insertText(text, span)) inputActions.setDraft(text)
  }

  return (
    <GitHubDock
      snapshot={snapshot}
      actions={store}
      t={t}
      {...sessionId === undefined ? {} : { sessionId }}
      {...inputActions === undefined ? {} : { inputActions }}
      composerReady={inputActions !== undefined}
      onInsert={insert}
      onSend={send}
      onDropIssue={card => { insert(card) }}
      onDropText={dropText}
    />
  )
}

/** The GitHub section of the Settings page. */
export function SettingsHost({ store, t }: ContainerProps) {
  const snapshot = usePanel(store)
  return <GitHubSettings snapshot={snapshot} actions={store} t={t} />
}

/** The sidebar rail icon for the GitHub panel. */
export function GitHubRailIcon(props: { size?: number; active?: boolean }) {
  return <GitHubIcon {...props} />
}
