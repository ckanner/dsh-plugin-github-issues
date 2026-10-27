/**
 * The composer dock strip: the pinned issue that can be handed to the agent.
 *
 * The strip is deliberately compact (one line under the composer) and is a drop
 * target itself: dropping a card from the panel or plain prompt text anywhere on
 * the strip routes through the container's `onDropIssue` / `onDropText`
 * callbacks. It never touches `InputActions` directly.
 *
 * @module dsh-plugin-github-issues/client/views/Dock
 */

import { useState } from 'react'
import type { DragEvent } from 'react'
import type { Translate } from '../context.ts'
import type { IssueCardVM, LinkedPRVM } from '../../vm.ts'
import type { DockProps } from '../viewmodel.ts'
import { Button, StyleSheet, TONE, CONTROLS_CSS } from './controls.tsx'
import { ExternalGlyph, GitHubIcon } from './Icon.tsx'
import { ISSUE_MIME } from './IssueRow.tsx'
import {
  checksGlyph, prGlyph, reviewGlyph, stateTone, summaryLine,
} from './format.ts'

/** The stylesheet chunk owned by this module. */
export const DOCK_CSS = `
.ghd-strip{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-height:30px;margin:0 0 6px;padding:2px 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.ghd-strip:hover{border-color:var(--dsw-alias-border-l3)}
.ghd-grip{flex:none;color:var(--dsw-alias-label-tertiary);cursor:grab;font-size:12px;line-height:1;letter-spacing:-1px}
.ghd-issue[draggable=true]{cursor:grab;min-width:0}
.ghd-issue[draggable=true]:active{cursor:grabbing}
.ghd-hot{border-color:var(--dsw-alias-brand-primary,var(--dsw-alias-link));background:var(--dsw-alias-bg-layer-2)}
.ghd-label{flex:none;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.ghd-issue{display:flex;align-items:center;gap:6px;min-width:0;flex:1}
.ghd-dot{width:8px;height:8px;border-radius:50%;flex:none}
.ghd-ref{flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsh-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary);text-decoration:none}
.ghd-ref:hover{color:var(--dsw-alias-link);text-decoration:underline}
.ghd-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:12px}
.ghd-pr{display:inline-flex;align-items:center;gap:2px;flex:none;padding:0 4px;border-radius:var(--dsw-radius-xs,4px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);text-decoration:none;font-size:11px;line-height:18px}
.ghd-pr:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.ghd-glyph{font-size:11px;line-height:1}
.ghd-hint{flex:none;color:var(--dsw-alias-brand-primary,var(--dsw-alias-link));font-size:12px;white-space:nowrap}
.ghd-actions{display:flex;align-items:center;gap:6px;flex:none;margin-left:auto}
.ghd-strip .gh-btn{height:24px;padding:0 8px;font-size:12px}
.ghd-sep{width:0.5px;height:16px;background:var(--dsw-alias-border-l2);flex:none}
.ghd-icon-link{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:var(--dsw-radius-sm,6px);color:var(--dsw-alias-label-tertiary);text-decoration:none;flex:none}
.ghd-icon-link:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.ghd-icon-link:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
`.trim()

/** The `text/plain` type that a card drag always carries as a fallback. */
const TEXT_MIME = 'text/plain'

/**
 * Whether a drag carries something the strip can accept.
 * @param transfer - the drag's data transfer, possibly `null`.
 * @returns true for the card MIME type or plain text.
 */
function hasIssuePayload(transfer: DataTransfer | null): boolean {
  if (transfer === null) return false
  return transfer.types.includes(ISSUE_MIME) || transfer.types.includes(TEXT_MIME)
}

/**
 * Read a whole card out of the private drag payload.
 * @param json - the raw JSON string.
 * @returns the card when the payload has the two identifying fields.
 */
function parseDroppedCard(json: string): IssueCardVM | undefined {
  try {
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record = parsed as Record<string, unknown>
    if (typeof record.repo !== 'string' || typeof record.number !== 'number') return undefined
    return record as unknown as IssueCardVM
  } catch {
    return undefined
  }
}

/** Props of the local pull-request badge. */
interface PullRequestBadgeProps {
  /** The pull request to summarize. */
  pr: LinkedPRVM
  /** Namespace translate function. */
  t: Translate
}

/**
 * The compact pull-request badge of the pinned issue.
 * @param props - the pull request and the translate function.
 * @returns a link with its state, check, and review glyphs.
 */
function PullRequestBadge({ pr, t }: PullRequestBadgeProps) {
  const state = prGlyph(pr)
  const checks = checksGlyph(pr)
  const review = reviewGlyph(pr)
  const parts = [`#${pr.number}`, pr.title, t(state.label)]
  if (checks !== undefined) parts.push(t(checks.label, { count: pr.failingChecks?.length ?? 0 }))
  if (review !== undefined) parts.push(t(review.label))
  return (
    <a className="ghd-pr" href={pr.url} target="_blank" rel="noreferrer" title={parts.join(' · ')}>
      <span className="ghd-glyph" style={{ color: TONE[state.tone].dot }} aria-hidden="true">{state.glyph}</span>
      <span>#{pr.number}</span>
      {checks !== undefined && (
        <span className="ghd-glyph" style={{ color: TONE[checks.tone].dot }} aria-hidden="true">{checks.glyph}</span>
      )}
      {review !== undefined && (
        <span className="ghd-glyph" style={{ color: TONE[review.tone].dot }} aria-hidden="true">{review.glyph}</span>
      )}
    </a>
  )
}

/**
 * The composer dock strip.
 * @param props - the panel snapshot, actions, composer callbacks, and translate function.
 * @returns the compact strip, or `null` while nothing is pinned.
 */
export function GitHubDock({ snapshot, actions, t, composerReady, onInsert, onSend, onDropIssue, onDropText }: DockProps) {
  const [hot, setHot] = useState(false)
  const card = snapshot.pinnedCard
  const firstPR = card?.linkedPRs[0]
  const disabledTitle = composerReady ? undefined : t('dock.disabled')

  // Nothing pinned: render nothing. This row sits above the composer on every
  // turn, so an empty hint would be permanent clutter rather than an affordance.
  if (card === undefined) return null

  /** Highlight the strip while a draggable issue hovers it. */
  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (!hasIssuePayload(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setHot(true)
  }

  /** Clear the highlight once the pointer really leaves the strip. */
  const handleDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setHot(false)
  }

  /** Hand the dropped payload to the container's callbacks. */
  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setHot(false)
    const transfer = event.dataTransfer
    const json = transfer.getData(ISSUE_MIME)
    if (json !== '') {
      const dropped = parseDroppedCard(json)
      if (dropped !== undefined) {
        onDropIssue(dropped)
        return
      }
    }
    const text = transfer.getData(TEXT_MIME)
    if (text.trim() !== '') onDropText(text)
  }

  return (
    <div
      className={`ghd-strip${hot ? ' ghd-hot' : ''}`}
      data-github-dock
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <StyleSheet chunks={[CONTROLS_CSS, DOCK_CSS]} />
      <GitHubIcon size={14} active={hot} />
      <span className="ghd-label">{t('dock.pinned')}</span>

      <>
            <div
              className="ghd-issue"
              draggable
              title={t('dock.drag')}
              onDragStart={(event: DragEvent<HTMLDivElement>) => {
                event.dataTransfer.setData(TEXT_MIME, actions.promptText(card))
                event.dataTransfer.setData(ISSUE_MIME, JSON.stringify(card))
                event.dataTransfer.effectAllowed = 'copy'
              }}
            >
              <span className="ghd-grip" aria-hidden="true">⠿</span>
              <span
                className="ghd-dot"
                style={{ background: TONE[stateTone(card.state, card.stateReason)].dot }}
                aria-hidden="true"
              />
              <a className="ghd-ref" href={card.url} target="_blank" rel="noreferrer" title={summaryLine(card)}>
                {card.repo}#{card.number}
              </a>
              <span className="ghd-title" title={card.title}>{card.title}</span>
              {firstPR !== undefined && <PullRequestBadge pr={firstPR} t={t} />}
            </div>

            {hot && <span className="ghd-hint">{t('dock.drop')}</span>}

            <div className="ghd-actions">
              <Button
                size="sm"
                variant="primary"
                onClick={() => onInsert(card)}
                disabled={!composerReady}
                title={disabledTitle}
              >
                {t('dock.insert')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSend(card)}
                disabled={!composerReady}
                title={disabledTitle}
              >
                {t('dock.send')}
              </Button>
              <span className="ghd-sep" aria-hidden="true" />
              <Button size="sm" variant="ghost" onClick={() => actions.unpin()}>{t('dock.clear')}</Button>
              <a
                className="ghd-icon-link"
                href={card.url}
                target="_blank"
                rel="noreferrer"
                aria-label={t('dock.open')}
                title={t('dock.open')}
              >
                <ExternalGlyph size={13} />
              </a>
            </div>
      </>
    </div>
  )
}
