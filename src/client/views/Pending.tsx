/**
 * The pending-handoff card rendered *inside* the composer card.
 *
 * It registers into `conversation.input.overlay`, the floating layer inside the
 * resident composer card. The visual language is the shipped draft-attachment
 * card (`ui-attachment`'s `FileCard`): a 240×64 rounded card with a type glyph,
 * two text lines and a hover-only remove control. The card is not editable; the
 * host reserves vertical space above the editor while it is present, so typing
 * can never land on top of it.
 *
 * @module dsh-plugin-github-issues/client/views/Pending
 */

import type { IssueCardVM } from '../../vm.ts'
import type { Translate } from '../context.ts'
import { CloseGlyph, GitHubIcon } from './Icon.tsx'
import { stateLabelKey } from './format.ts'
import { CONTROLS_CSS, StyleSheet } from './controls.tsx'

/** The stylesheet chunk owned by the in-composer pending card. */
export const PENDING_CSS = `
.ghp3-rail{position:absolute;top:8px;left:10px;right:10px;z-index:2;display:flex;align-items:flex-start;pointer-events:none}
.ghp3-card{pointer-events:auto;position:relative;display:inline-flex;align-items:center;gap:10px;box-sizing:border-box;width:240px;max-width:100%;height:64px;padding:0 12px;border:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-specific-input-major,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);text-align:left;font-family:inherit;cursor:pointer}
.ghp3-card:hover{border-color:var(--dsw-alias-border-l3,rgba(0,0,0,.18))}
.ghp3-card:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.ghp3-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:var(--dsw-radius-md,8px);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 12%,transparent);color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.ghp3-body{display:flex;flex-direction:column;flex:1;min-width:0;padding:8px 0}
.ghp3-name{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:14px;font-weight:500;line-height:22px;color:var(--dsw-alias-label-primary)}
.ghp3-meta{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;line-height:15px;color:var(--dsw-alias-label-tertiary,#8a9099)}
.ghp3-remove{position:absolute;top:6px;right:6px;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:none;border-radius:50%;background:var(--dsw-alias-button-contrast-fill,#000000b8);color:var(--dsw-alias-label-primary-inverted,#fff);opacity:0;cursor:pointer;transition:opacity .2s ease-in-out}
.ghp3-card:hover .ghp3-remove,.ghp3-card:focus-within .ghp3-remove,.ghp3-remove:focus-visible{opacity:1}
.ghp3-card:hover .ghp3-name,.ghp3-card:focus-within .ghp3-name{padding-right:18px}
@media (hover:none),(pointer:coarse){.ghp3-remove{opacity:1}}
@media (prefers-reduced-motion:reduce){.ghp3-remove{transition:none}}
`.trim()

/**
 * The in-composer pending issue card.
 * @param props - the issue, translate function, and the open/remove callbacks.
 * @returns the attachment-style card inside the composer card.
 */
export function GitHubPendingCard(props: {
  card: IssueCardVM
  t: Translate
  onOpenPanel(): void
  onRemove(): void
}) {
  const { card, t, onOpenPanel, onRemove } = props
  const ref = `${card.repo}#${String(card.number)}`
  const state = t(stateLabelKey(card.state))
  return (
    <div className="ghp3-rail" data-github-pending>
      <StyleSheet chunks={[CONTROLS_CSS, PENDING_CSS]} />
      <div
        className="ghp3-card"
        role="button"
        tabIndex={0}
        aria-label={`${ref} · ${card.title}`}
        title={`${ref} · ${card.title}\n${t('pending.tip')}`}
        onClick={onOpenPanel}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onOpenPanel()
        }}
      >
        <span className="ghp3-icon" aria-hidden="true"><GitHubIcon size={16} /></span>
        <span className="ghp3-body">
          <span className="ghp3-name">{ref}</span>
          <span className="ghp3-meta">{state} · {card.title === '' ? t('pending.noTitle') : card.title}</span>
        </span>
        <button
          type="button"
          className="ghp3-remove"
          aria-label={t('dock.removeDraft')}
          onClick={event => {
            event.stopPropagation()
            onRemove()
          }}
        >
          <CloseGlyph size={12} />
        </button>
      </div>
    </div>
  )
}

/** Backwards-compatible alias kept for the render smoke test and older imports. */
export const GitHubPendingChip = GitHubPendingCard
