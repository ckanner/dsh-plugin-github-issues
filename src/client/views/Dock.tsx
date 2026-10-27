/**
 * The composer-handoff chips.
 *
 * A session that receives an issue shows it as an attachment-like chip directly
 * above the composer: status dot, `repo#number`, a draft/linked state, and a
 * remove button. Hovering the chip reveals the title and the rest of the card;
 * clicking it opens the GitHub panel focused on that issue.
 *
 * Nothing is rendered while the session has no issue, so the row takes no space
 * from the conversation.
 *
 * @module dsh-plugin-github-issues/client/views/Dock
 */

import type { Translate } from '../context.ts'
import type { ComposerIssueChip, DockProps } from '../viewmodel.ts'
import { Badge, StyleSheet, TONE, CONTROLS_CSS } from './controls.tsx'
import { CloseGlyph, GitHubIcon } from './Icon.tsx'
import { prGlyph, stateLabelKey, stateTone, summaryLine } from './format.ts'

/** The stylesheet chunk owned by this module. */
export const DOCK_CSS = `
.ghd-row{display:flex;align-items:center;gap:6px;box-sizing:border-box;width:100%;flex-wrap:wrap;padding:0 2px 4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.ghd-chip{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;max-width:100%;min-height:26px;padding:2px 4px 2px 8px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg,14px);background:var(--dsw-alias-bg-layer-2);cursor:pointer;color:var(--dsw-alias-label-primary)}
.ghd-chip:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.ghd-chip:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.ghd-dot{width:8px;height:8px;border-radius:50%;flex:none}
.ghd-ref{font-family:var(--dsh-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ghd-title{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
.ghd-x{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:none;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0}
.ghd-x:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.ghd-x:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
`.trim()

/**
 * One chip of the strip.
 * @param props - the chip, translate function, and the reduce/open callbacks.
 * @returns an attachment-like issue chip.
 */
function IssueChip(props: {
  chip: ComposerIssueChip
  t: Translate
  onRemove: () => void
  onOpen: () => void
}) {
  const { chip, t, onRemove, onOpen } = props
  const { card } = chip
  const state = stateTone(card.state, card.stateReason)
  const details = [
    summaryLine(card),
    t(stateLabelKey(card.state)),
    card.milestone === undefined ? undefined : `${t('panel.milestone')}: ${card.milestone.title}`,
    card.priority === undefined ? undefined : `${t('panel.priority')}: ${card.priority.name}`,
    card.linkedPRs.length === 0 ? undefined : `${t('panel.linkedPRs')}: ${String(card.linkedPRs.length)}`,
    chip.sessions.length === 0
      ? t('dock.pending')
      : `${t('dock.linked')}: ${chip.sessions.map(session => session.title).join(', ')}`,
  ].filter((line): line is string => line !== undefined)
  const pr = card.linkedPRs[0]
  const prState = pr === undefined ? undefined : prGlyph(pr)
  const repoShort = card.repo.split('/')[1] ?? card.repo

  return (
    <span
      className="ghd-chip"
      role="button"
      tabIndex={0}
      title={details.join(' · ')}
      onClick={onOpen}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onOpen()
      }}
    >
      <span className="ghd-dot" style={{ background: TONE[state].dot }} aria-hidden="true" />
      <span className="ghd-ref">{`${repoShort}#${String(card.number)}`}</span>
      <span className="ghd-title">{card.title}</span>
      {chip.state === 'draft'
        ? <Badge tone="warn">{t('dock.pending')}</Badge>
        : <Badge tone={state}>{t(stateLabelKey(card.state))}</Badge>}
      {prState !== undefined && (
        <span
          style={{ color: TONE[prState.tone].dot }}
          title={t(prState.label, { count: pr?.failingChecks?.length ?? 0 })}
        >
          {prState.glyph}
        </span>
      )}
      <button
        type="button"
        className="ghd-x"
        aria-label={t('dock.remove')}
        title={t('dock.remove')}
        onClick={event => {
          event.stopPropagation()
          onRemove()
        }}
      >
        <CloseGlyph size={11} />
      </button>
    </span>
  )
}

/**
 * The composer strip of handoff chips.
 * @param props - chips, translate function, and the per-chip callbacks.
 * @returns the chip row, or `null` while the session has no issue.
 */
export function GitHubDock({ chips, t, onRemoveChip, onOpenChip }: DockProps) {
  if (chips.length === 0) return null
  return (
    <div className="ghd-row" data-github-handoff>
      <StyleSheet chunks={[CONTROLS_CSS, DOCK_CSS]} />
      <GitHubIcon size={13} />
      {chips.map(chip => (
        <IssueChip
          key={`${chip.card.repo}#${String(chip.card.number)}`}
          chip={chip}
          t={t}
          onRemove={() => onRemoveChip(chip)}
          onOpen={() => onOpenChip(chip)}
        />
      ))}
    </div>
  )
}
