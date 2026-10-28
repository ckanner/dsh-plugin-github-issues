/**
 * The composer-handoff chips.
 *
 * A session that received an issue shows it in the compact dock row under the
 * composer, inline with the shipped step/token/cache meters: an issue icon, the
 * repository, `#number`, and the issue's state dot. The chip takes almost no
 * space; clicking it opens a small popover above the row (the same direction the
 * token-usage popover opens) with the title and the rest of the card.
 *
 * Nothing is rendered while the session has no issue.
 *
 * @module dsh-plugin-github-issues/client/views/Dock
 */

import { useEffect, useState } from 'react'
import type { Translate } from '../context.ts'
import type { ComposerIssueChip, DockProps } from '../viewmodel.ts'
import { Badge, Button, StyleSheet, TONE, CONTROLS_CSS } from './controls.tsx'
import { CloseGlyph, ExternalGlyph, GitHubIcon } from './Icon.tsx'
import { prGlyph, stateLabelKey, stateTone } from './format.ts'

/** The stylesheet chunk owned by this module. */
export const DOCK_CSS = `
.ghd-row{display:inline-flex;align-items:center;gap:6px;flex-wrap:nowrap;min-width:0;max-width:100%;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.ghd-chip{display:inline-flex;align-items:center;gap:5px;box-sizing:border-box;height:22px;max-width:300px;min-width:0;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit;font-size:11px;line-height:18px}
.ghd-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.ghd-chip:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.ghd-dot{width:7px;height:7px;border-radius:50%;flex:none}
.ghd-state{flex:none;font-size:10px;line-height:14px}
.ghd-prefix{font-family:var(--dsh-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ghd-num{font-family:var(--dsh-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);flex:none}
.ghd-extra{flex:none;font-size:10px;line-height:14px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary)}
.ghd-pop{position:fixed;z-index:60;box-sizing:border-box;width:340px;max-width:calc(100vw - 16px);padding:12px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));box-shadow:0 8px 24px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.ghd-pop-head{display:flex;align-items:center;gap:8px;min-width:0}
.ghd-pop-ref{font-family:var(--dsh-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;color:var(--dsw-alias-label-secondary);text-decoration:none;white-space:nowrap}
.ghd-pop-ref:hover{color:var(--dsw-alias-link);text-decoration:underline}
.ghd-pop-spacer{flex:1}
.ghd-pop-title{margin-top:6px;font-weight:500;color:var(--dsw-alias-label-primary);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden}
.ghd-pop-meta{margin-top:8px;display:flex;flex-direction:column;gap:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.ghd-pop-row{display:flex;gap:8px;min-width:0}
.ghd-pop-key{flex:none;width:64px;color:var(--dsw-alias-label-tertiary)}
.ghd-pop-val{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ghd-pop-actions{margin-top:10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ghd-pop-note{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.ghd-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.ghd-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
`.trim()

/** Where the popover is anchored, in viewport coordinates. */
interface PopoverAnchor {
  left: number
  bottom: number
}

/**
 * The floating detail card for one chip.
 * @param props - chip, anchor, and callbacks.
 * @returns the popover.
 */
function ChipPopover(props: {
  chip: ComposerIssueChip
  anchor: PopoverAnchor
  t: Translate
  onClose: () => void
  onOpenPanel: () => void
  onRemove: () => void
}) {
  const { chip, anchor, t, onClose, onOpenPanel, onRemove } = props
  const { card } = chip
  const state = stateTone(card.state, card.stateReason)
  const pr = card.linkedPRs[0]
  const prState = pr === undefined ? undefined : prGlyph(pr)
  const repoShort = card.repo.split('/')[1] ?? card.repo
  const session = chip.sessions[0]

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    const onPointer = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.ghd-pop') !== null || target?.closest('.ghd-chip') !== null) return
      onClose()
    }
    const onMove = (): void => onClose()
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer, true)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer, true)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [onClose])

  return (
    <div className="ghd-pop" style={{ left: anchor.left, bottom: anchor.bottom }} role="dialog" aria-label={card.title}>
      <StyleSheet chunks={[CONTROLS_CSS, DOCK_CSS]} />
      <div className="ghd-pop-head">
        <GitHubIcon size={13} />
        <a className="ghd-pop-ref" href={card.url} target="_blank" rel="noreferrer">
          {`${repoShort}#${String(card.number)}`}
        </a>
        <Badge tone={state}>{t(stateLabelKey(card.state))}</Badge>
        {chip.state === 'draft' && <Badge tone="warn">{t('dock.pending')}</Badge>}
        <span className="ghd-pop-spacer" />
        <button type="button" className="ghd-icon-btn" aria-label={t('panel.close')} onClick={onClose}>
          <CloseGlyph size={12} />
        </button>
      </div>
      <div className="ghd-pop-title">{card.title === '' ? t('dock.loading') : card.title}</div>
      <div className="ghd-pop-meta">
        <div className="ghd-pop-row">
          <span className="ghd-pop-key">{t('panel.repo')}</span>
          <span className="ghd-pop-val">{card.repo}</span>
        </div>
        <div className="ghd-pop-row">
          <span className="ghd-pop-key">{t('panel.milestone')}</span>
          <span className="ghd-pop-val">
            {card.milestone === undefined ? t('panel.noMilestone') : card.milestone.title}
          </span>
        </div>
        <div className="ghd-pop-row">
          <span className="ghd-pop-key">{t('panel.priority')}</span>
          <span className="ghd-pop-val">
            {card.priority === undefined ? t('panel.noPriority') : card.priority.name}
          </span>
        </div>
        <div className="ghd-pop-row">
          <span className="ghd-pop-key">{t('panel.linkedPRs')}</span>
          <span className="ghd-pop-val">
            {pr === undefined
              ? t('panel.noPRs')
              : `#${String(pr.number)} · ${t(prState?.label ?? 'panel.noPRs')}`}
          </span>
        </div>
        <div className="ghd-pop-row">
          <span className="ghd-pop-key">{t('dock.linked')}</span>
          <span className="ghd-pop-val">
            {session === undefined ? <span className="ghd-pop-note">{t('dock.pending')}</span> : session.title}
          </span>
        </div>
      </div>
      <div className="ghd-pop-actions">
        <Button size="sm" variant="outline" onClick={onOpenPanel}>
          <ExternalGlyph size={12} />
          {t('panel.openInPanel')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onRemove}>
          {chip.state === 'draft' ? t('dock.removeDraft') : t('dock.unlink')}
        </Button>
      </div>
    </div>
  )
}

/**
 * The composer strip of handoff chips.
 * @param props - chips, translate function, and the per-chip callbacks.
 * @returns the inline chip row, or `null` while the session has no issue.
 */
export function GitHubDock({ chips, t, onRemoveChip, onOpenChip }: DockProps) {
  const [openKey, setOpenKey] = useState<string | undefined>(undefined)
  const [anchor, setAnchor] = useState<PopoverAnchor | undefined>(undefined)
  if (chips.length === 0) return null

  const toggle = (chip: ComposerIssueChip, element: HTMLElement): void => {
    const key = `${chip.card.repo}#${String(chip.card.number)}`
    if (openKey === key) {
      setOpenKey(undefined)
      return
    }
    const rect = element.getBoundingClientRect()
    const width = 340
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
    setAnchor({ left, bottom: window.innerHeight - rect.top + 8 })
    setOpenKey(key)
  }

  const open = openKey === undefined
    ? undefined
    : chips.find(chip => `${chip.card.repo}#${String(chip.card.number)}` === openKey)

  return (
    <>
      <div className="ghd-row" data-github-handoff>
        <StyleSheet chunks={[CONTROLS_CSS, DOCK_CSS]} />
        {chips.map(chip => {
          const state = stateTone(chip.card.state, chip.card.stateReason)
          const repoShort = chip.card.repo.split('/')[1] ?? chip.card.repo
          const key = `${chip.card.repo}#${String(chip.card.number)}`
          return (
            <button
              key={key}
              type="button"
              className="ghd-chip"
              aria-expanded={openKey === key}
              title={`${chip.card.repo}#${String(chip.card.number)}`}
              onClick={event => toggle(chip, event.currentTarget)}
            >
              <GitHubIcon size={11} />
              {chip.state !== 'degraded' && (
                <span className="ghd-state" style={{ color: TONE[state].fg }}>{t(stateLabelKey(chip.card.state))}</span>
              )}
              <span className="ghd-prefix" title={chip.card.repo}>{chip.card.repo}</span>
              <span className="ghd-num">{`#${String(chip.card.number)}`}</span>
              {chip.state === 'draft' && <span className="ghd-extra">{t('dock.pending')}</span>}
            </button>
          )
        })}
      </div>
      {open !== undefined && anchor !== undefined && (
        <ChipPopover
          chip={open}
          anchor={anchor}
          t={t}
          onClose={() => setOpenKey(undefined)}
          onOpenPanel={() => { setOpenKey(undefined); onOpenChip(open) }}
          onRemove={() => { setOpenKey(undefined); onRemoveChip(open) }}
        />
      )}
    </>
  )
}
