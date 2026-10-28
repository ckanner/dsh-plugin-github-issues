/**
 * The handoff drop target.
 *
 * While an issue is dragged out of the right-sidebar list, this bar appears
 * above the composer card and the whole window accepts the drop. Dropping hands
 * the issue to the current Session exactly like the one-click handoff: the
 * prompt is written into the composer draft and the issue appears as a chip.
 *
 * @module dsh-plugin-github-issues/client/views/DropZone
 */

import type { DropZoneProps } from '../viewmodel.ts'
import { CONTROLS_CSS, StyleSheet } from './controls.tsx'
import { GitHubIcon } from './Icon.tsx'

/** The stylesheet chunk owned by the drop target. */
export const DROPZONE_CSS = `
.ghz-bar{display:flex;align-items:center;gap:8px;box-sizing:border-box;margin-bottom:6px;padding:10px 12px;border:1px dashed var(--dsw-alias-state-business-primary,var(--dsw-alias-border-l3));border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}
.ghz-bar strong{font-weight:600}
.ghz-hint{color:var(--dsw-alias-label-tertiary)}
`.trim()

/**
 * The drag-over bar; renders nothing when no drag is in flight.
 * @param props - the dragged issue and the drop/cancel callbacks.
 * @returns the highlighted drop bar.
 */
export function GitHubDropZone({ dragging, t, onDrop, onCancel }: DropZoneProps) {
  if (dragging === undefined) return null
  const ref = `${dragging.repo}#${String(dragging.number)}`
  return (
    <div
      className="ghz-bar"
      data-github-dropzone
      onDragOver={event => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={event => {
        event.preventDefault()
        event.stopPropagation()
        onDrop()
      }}
    >
      <StyleSheet chunks={[CONTROLS_CSS, DROPZONE_CSS]} />
      <GitHubIcon size={14} />
      <span>{t('drop.release')}</span>
      <strong>{ref}</strong>
      <span className="ghz-hint">{t('drop.hint')}</span>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        className="ghz-hint"
        style={{ border: 0, background: 'transparent', cursor: 'pointer', font: 'inherit' }}
        onClick={onCancel}
      >
        {t('drop.cancel')}
      </button>
    </div>
  )
}
