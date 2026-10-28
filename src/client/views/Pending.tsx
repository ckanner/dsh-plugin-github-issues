/**
 * The pending-handoff attachment card above the composer.
 *
 * It represents the issue that was just handed to this Session: a card in the
 * composer's attachment area, with the issue logo, state, `org/repo#number`, the
 * title, a "pending" badge, and a remove control. The user can keep typing below
 * it; on send the prompt goes out and the card is replaced by the linked chip in
 * the bottom dock. It is visible in blank Sessions too, where the dock row under
 * the input is not rendered.
 *
 * @module dsh-plugin-github-issues/client/views/Pending
 */

import type { IssueCardVM } from '../../vm.ts'
import type { Translate } from '../context.ts'
import { Badge, CONTROLS_CSS, StyleSheet } from './controls.tsx'
import { CloseGlyph, GitHubIcon } from './Icon.tsx'
import { stateLabelKey, stateTone } from './format.ts'

/** The stylesheet chunk owned by the pending card. */
export const PENDING_CSS = `
.ghp2-card{display:flex;align-items:flex-start;gap:8px;box-sizing:border-box;margin-bottom:8px;padding:8px 10px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}
.ghp2-logo{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border-radius:8px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary)}
.ghp2-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.ghp2-head{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
.ghp2-ref{font-family:var(--dsh-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ghp2-state{font-size:10px;line-height:14px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2));flex:none}
.ghp2-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.ghp2-hint{color:var(--dsw-alias-label-tertiary);font-size:11px}
.ghp2-actions{margin-left:auto;display:flex;align-items:center;gap:2px;flex:none}
.ghp2-open{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11px;padding:2px 4px;border-radius:6px}
.ghp2-open:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.ghp2-remove{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.ghp2-remove:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
`.trim()

/**
 * The pending issue card.
 * @param props - the issue, translate function, and the open/remove callbacks.
 * @returns the attachment-like card above the composer.
 */
export function GitHubPendingCard(props: {
  card: IssueCardVM
  t: Translate
  onOpenPanel(): void
  onRemove(): void
}) {
  const { card, t, onOpenPanel, onRemove } = props
  const tone = stateTone(card.state, card.stateReason)
  const ref = `${card.repo}#${String(card.number)}`
  return (
    <div className="ghp2-card" data-github-pending>
      <StyleSheet chunks={[CONTROLS_CSS, PENDING_CSS]} />
      <span className="ghp2-logo"><GitHubIcon size={16} /></span>
      <span className="ghp2-main">
        <span className="ghp2-head">
          <span className="ghp2-ref">{ref}</span>
          <span className="ghp2-state" style={{ color: `var(--dsw-alias-state-${tone}-primary)` }}>
            {t(stateLabelKey(card.state))}
          </span>
          <Badge tone="warn">{t('dock.pending')}</Badge>
        </span>
        <span className="ghp2-title" title={card.title}>{card.title}</span>
        <span className="ghp2-hint">{t('pending.hint')}</span>
      </span>
      <span className="ghp2-actions">
        <button type="button" className="ghp2-open" onClick={onOpenPanel}>{t('panel.openInPanel')}</button>
        <button type="button" className="ghp2-remove" aria-label={t('dock.removeDraft')} onClick={onRemove}>
          <CloseGlyph size={12} />
        </button>
      </span>
    </div>
  )
}
