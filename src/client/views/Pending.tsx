/**
 * The pending-handoff bar above the composer.
 *
 * It is the attachment-like preview for an issue that was just handed over: an
 * issue icon, the "pending" badge, `org/repo#number`, the title, and a remove
 * control. It sits above the input (where an attachment preview would sit), so
 * it is visible even in a blank Session whose composer dock row is not rendered.
 * Dragging the issue onto the composer and the panel's one-click handoff both
 * end up here until the prompt is sent (linked) or withdrawn.
 *
 * @module dsh-plugin-github-issues/client/views/Pending
 */

import type { DropZoneProps } from '../viewmodel.ts'
import { Badge, Button, CONTROLS_CSS, StyleSheet } from './controls.tsx'
import { CloseGlyph, GitHubIcon } from './Icon.tsx'

/** The stylesheet chunk owned by the pending bar. */
export const PENDING_CSS = `
.ghp2-bar{display:flex;align-items:center;gap:8px;box-sizing:border-box;margin-bottom:6px;padding:7px 10px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}
.ghp2-ref{font-family:var(--dsh-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ghp2-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ghp2-actions{display:flex;align-items:center;gap:2px;flex:none}
.ghp2-remove{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.ghp2-remove:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
`.trim()

/**
 * The pending handoff bar.
 * @param props - the card, translate function, and the open/remove callbacks.
 * @returns the bar above the composer.
 */
export function GitHubPendingBar(props: {
  card: NonNullable<DropZoneProps['dragging']>
  t: DropZoneProps['t']
  onOpenPanel(): void
  onRemove(): void
}) {
  const { card, t, onOpenPanel, onRemove } = props
  const ref = `${card.repo}#${String(card.number)}`
  return (
    <div className="ghp2-bar" data-github-pending>
      <StyleSheet chunks={[CONTROLS_CSS, PENDING_CSS]} />
      <GitHubIcon size={14} />
      <Badge tone="warn">{t('dock.pending')}</Badge>
      <span className="ghp2-ref">{ref}</span>
      <span className="ghp2-title" title={card.title}>{card.title}</span>
      <span className="ghp2-actions">
        <Button size="sm" variant="ghost" onClick={onOpenPanel}>{t('panel.openInPanel')}</Button>
        <button type="button" className="ghp2-remove" aria-label={t('dock.removeDraft')} onClick={onRemove}>
          <CloseGlyph size={12} />
        </button>
      </span>
    </div>
  )
}
