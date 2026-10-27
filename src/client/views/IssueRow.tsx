/**
 * One issue row of the GitHub panel list.
 *
 * The row is the plugin's drag source: it publishes the rendered agent prompt as
 * `text/plain` (so the same card can be dropped straight onto the composer
 * editor) and the whole card as JSON under a private MIME type (so the plugin's
 * own dock can take over when the editor is not the drop target).
 *
 * @module dsh-plugin-github-issues/client/views/IssueRow
 */

import type { DragEvent, KeyboardEvent } from 'react'
import type { Translate } from '../context.ts'
import type { IssueCardVM } from '../../vm.ts'
import { Badge, Chip, ProgressBar, TONE } from './controls.tsx'
import { CommentGlyph, LinkGlyph } from './Icon.tsx'
import {
  checksGlyph, formatDue, labelsWithoutPriority, prGlyph, prioritySourceLabel, priorityTone,
  relativeTime, reviewGlyph, stateLabelKey, stateTone,
} from './format.ts'

/** The drag payload type that carries a whole issue card between plugin surfaces. */
export const ISSUE_MIME = 'application/x-dsh-github-issue+json'

/** How many labels a row shows before collapsing the rest into a `+N` chip. */
const MAX_LABELS = 4

/** How many assignee avatars a row shows. */
const MAX_ASSIGNEES = 3

/** How many linked pull requests a row shows before collapsing a `+N` badge. */
const MAX_PRS = 2

/** Props of {@link IssueRow}. */
export interface IssueRowProps {
  /** The issue this row renders. */
  card: IssueCardVM
  /** Namespace translate function. */
  t: Translate
  /** Whether this issue's detail is open. */
  selected: boolean
  /** Open the detail pane for this card. */
  onSelect: (card: IssueCardVM) => void
  /** Render the agent prompt for this card (the drag payload). */
  promptText: (card: IssueCardVM) => string
}

/** The stylesheet chunk owned by this module. */
export const ISSUE_ROW_CSS = `
.ghr-row{display:flex;flex-direction:column;gap:4px;box-sizing:border-box;padding:10px 8px;border-top:0.5px solid var(--dsw-alias-border-l2);cursor:pointer;outline:none;text-align:left;color:var(--dsw-alias-label-primary)}
.ghr-row:first-child{border-top:0}
.ghr-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ghr-row:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px;border-radius:var(--dsw-radius-sm,6px)}
.ghr-row[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover)}
.ghr-top{display:flex;align-items:center;gap:6px;min-width:0}
.ghr-dot{width:8px;height:8px;border-radius:50%;flex:none}
.ghr-ref{flex:none;font-family:var(--dsh-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);text-decoration:none;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ghr-ref:hover{color:var(--dsw-alias-link);text-decoration:underline}
.ghr-private{display:inline-flex;align-items:center;color:var(--dsw-alias-label-tertiary);flex:none}
.ghr-title{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;font-size:var(--dsh-content-font-size,14px);line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.ghr-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0;color:var(--dsw-alias-label-tertiary)}
.ghr-milestone{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:260px}
.ghr-meta-item{display:inline-flex;align-items:center;gap:3px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.ghr-avatar{width:16px;height:16px;border-radius:50%;flex:none;object-fit:cover}
.ghr-avatar-fallback{display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:9px;line-height:1;font-weight:600;text-transform:uppercase}
.ghr-pr{display:inline-flex;align-items:center;gap:2px;padding:0 4px;border-radius:var(--dsw-radius-xs,4px);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);text-decoration:none;background:var(--dsw-alias-bg-layer-2);white-space:nowrap}
.ghr-pr:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.ghr-glyph{font-size:11px;line-height:1}
`.trim()

/**
 * One draggable issue row.
 * @param props - the card, translate function, selection, and drag payload builder.
 * @returns a keyboard-selectable row with links for the issue and its pull requests.
 */
export function IssueRow({ card, t, selected, onSelect, promptText }: IssueRowProps) {
  const tone = stateTone(card.state, card.stateReason)
  const updated = relativeTime(card.updatedAt)
  const renderable = labelsWithoutPriority(card)
  const labels = renderable.slice(0, MAX_LABELS)
  const hiddenLabels = renderable.length - labels.length
  const assignees = card.assignees.slice(0, MAX_ASSIGNEES)
  const prs = card.linkedPRs.slice(0, MAX_PRS)
  const hiddenPRs = card.linkedPRs.length - prs.length

  /** Publish both drag payloads: a plain prompt and the card JSON. */
  const handleDragStart = (event: DragEvent<HTMLDivElement>): void => {
    const transfer = event.dataTransfer
    transfer.setData('text/plain', promptText(card))
    transfer.setData(ISSUE_MIME, JSON.stringify(card))
    transfer.effectAllowed = 'copy'
  }

  /** Select on Enter/Space when the row itself holds focus. */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelect(card)
  }

  // A row is a composite control, so it cannot be a native <button>: the
  // requirement nests real links for the issue and each linked pull request. The
  // ARIA button role plus Enter/Space handling gives the same keyboard behavior
  // without invalid interactive nesting.
  return (
    <div
      className="ghr-row"
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      draggable
      onClick={() => onSelect(card)}
      onKeyDown={handleKeyDown}
      onDragStart={handleDragStart}
      data-issue-id={card.id}
    >
      <div className="ghr-top">
        <span className="ghr-dot" style={{ background: TONE[tone].dot }} title={t(stateLabelKey(card.state))} aria-hidden="true" />
        <a
          className="ghr-ref"
          href={card.url}
          target="_blank"
          rel="noreferrer"
          onClick={event => event.stopPropagation()}
        >
          {card.repo}#{card.number}
        </a>
        {card.isPrivate && (
          <span className="ghr-private" role="img" aria-label={t('panel.private')} title={t('panel.private')}>
            <LinkGlyph size={11} />
          </span>
        )}
      </div>

      <div className="ghr-title">{card.title}</div>

      <div className="ghr-meta">
        {card.priority !== undefined && (
          <Chip
            label={card.priority.name}
            tone={priorityTone(card.priority.name)}
            dot
            title={`${t('panel.priority')} · ${t(prioritySourceLabel(card.priority.source))}`}
          />
        )}
        {card.milestone !== undefined && (
          <span
            className="ghr-milestone"
            title={card.milestone.dueOn === null ? t('panel.milestone') : t('panel.due', { date: formatDue(card.milestone.dueOn) })}
          >
            <Chip label={card.milestone.title} tone="info" dot />
            {card.milestone.progress !== null && (
              <ProgressBar
                value={card.milestone.progress}
                width={40}
                label={t('panel.progress', { percent: card.milestone.progress })}
              />
            )}
          </span>
        )}
        {labels.map(label => (
          <Chip key={label.name} label={label.name} color={label.color} title={label.name} />
        ))}
        {hiddenLabels > 0 && <Chip label={t('panel.more', { count: hiddenLabels })} />}
        {assignees.map(assignee => (
          assignee.avatarUrl === undefined
            ? (
              <span key={assignee.login} className="ghr-avatar ghr-avatar-fallback" title={assignee.login} aria-label={assignee.login}>
                {assignee.login.slice(0, 1)}
              </span>
            )
            : (
              <img
                key={assignee.login}
                className="ghr-avatar"
                src={assignee.avatarUrl}
                alt={assignee.login}
                title={assignee.login}
                width={16}
                height={16}
                loading="lazy"
              />
            )
        ))}
        {card.commentCount > 0 && (
          <span className="ghr-meta-item" title={t('panel.comments', { count: card.commentCount })}>
            <CommentGlyph size={11} />
            {card.commentCount}
          </span>
        )}
        <time className="ghr-meta-item" dateTime={card.updatedAt} title={card.updatedAt}>{updated}</time>
        {prs.map(pr => {
          const state = prGlyph(pr)
          const checks = checksGlyph(pr)
          const review = reviewGlyph(pr)
          const parts = [`#${pr.number}`, pr.title, t(state.label)]
          if (checks !== undefined) parts.push(t(checks.label, { count: pr.failingChecks?.length ?? 0 }))
          if (review !== undefined) parts.push(t(review.label))
          return (
            <a
              key={pr.number}
              className="ghr-pr"
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              title={parts.join(' · ')}
              onClick={event => event.stopPropagation()}
            >
              <span className="ghr-glyph" style={{ color: TONE[state.tone].dot }} aria-hidden="true">{state.glyph}</span>
              <span>#{pr.number}</span>
              {checks !== undefined && (
                <span className="ghr-glyph" style={{ color: TONE[checks.tone].dot }} aria-hidden="true">{checks.glyph}</span>
              )}
              {review !== undefined && (
                <span className="ghr-glyph" style={{ color: TONE[review.tone].dot }} aria-hidden="true">{review.glyph}</span>
              )}
            </a>
          )
        })}
        {hiddenPRs > 0 && <Badge tone="neutral" title={t('panel.linkedPRs')}>{t('panel.more', { count: hiddenPRs })}</Badge>}
      </div>
    </div>
  )
}
