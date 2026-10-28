/**
 * The pending-handoff chip rendered *inside* the composer card.
 *
 * It registers into `conversation.input.overlay`, the floating layer inside the
 * resident composer card, so it looks like the composer's own attachment row
 * (the `README.md` reference style) instead of a bar above the card. Clicking it
 * opens the issue in the GitHub panel; the remove control withdraws the handoff.
 *
 * @module dsh-plugin-github-issues/client/views/Pending
 */

import type { IssueCardVM } from '../../vm.ts'
import type { Translate } from '../context.ts'
import { CloseGlyph, GitHubIcon } from './Icon.tsx'
import { CONTROLS_CSS, StyleSheet, TONE } from './controls.tsx'
import { stateLabelKey, stateTone } from './format.ts'

/** The stylesheet chunk owned by the in-composer pending chip. */
export const PENDING_CSS = `
.ghp3-row{position:absolute;top:8px;left:12px;right:12px;z-index:2;display:flex;align-items:center;gap:6px;min-width:0;height:22px;font-size:12px;line-height:18px;pointer-events:none}
.ghp3-chip{pointer-events:auto;display:inline-flex;align-items:center;gap:5px;box-sizing:border-box;height:22px;max-width:100%;padding:0 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;cursor:pointer;border:0.5px solid var(--dsw-alias-border-l2)}
.ghp3-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.ghp3-chip:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.ghp3-ref{font-family:var(--dsh-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ghp3-state{flex:none;font-size:10px}
.ghp3-pending{flex:none;font-size:10px;line-height:14px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-state-warning-tertiary,var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2)));color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary))}
.ghp3-remove{pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;flex:none}
.ghp3-remove:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
`.trim()

/**
 * The in-composer pending issue chip.
 * @param props - the issue, translate function, and the open/remove callbacks.
 * @returns the floating chip row inside the composer card.
 */
export function GitHubPendingChip(props: {
  card: IssueCardVM
  t: Translate
  onOpenPanel(): void
  onRemove(): void
}) {
  const { card, t, onOpenPanel, onRemove } = props
  const tone = stateTone(card.state, card.stateReason)
  const ref = `${card.repo}#${String(card.number)}`
  return (
    <div className="ghp3-row" data-github-pending>
      <StyleSheet chunks={[CONTROLS_CSS, PENDING_CSS]} />
      <button type="button" className="ghp3-chip" title={`${ref} · ${card.title}\n${t('pending.tip')}`} onClick={onOpenPanel}>
        <GitHubIcon size={12} />
        <span className="ghp3-ref">{ref}</span>
        <span className="ghp3-state" style={{ color: TONE[tone].fg }}>{t(stateLabelKey(card.state))}</span>
        <span className="ghp3-pending">{t('dock.pending')}</span>
      </button>
      <button type="button" className="ghp3-remove" aria-label={t('dock.removeDraft')} onClick={onRemove}>
        <CloseGlyph size={12} />
      </button>
    </div>
  )
}
