/**
 * The co-visible right-sidebar issue list.
 *
 * It exists for drag-and-drop: the right sidebar stays open beside the
 * Conversation, so a row can be dragged from here into the composer without
 * leaving the session. A row click instead opens the same issue in the main
 * GitHub panel. The filter is the panel's cascade, so both views always agree.
 *
 * @module dsh-plugin-github-issues/client/views/Sidebar
 */

import { useMemo, useState } from 'react'
import type { SidebarProps } from '../viewmodel.ts'
import { Button, CONTROLS_CSS, EmptyState, Spinner, StyleSheet, TONE, TextInput } from './controls.tsx'
import { GitHubIcon } from './Icon.tsx'
import { stateLabelKey, stateTone } from './format.ts'

/** The stylesheet chunk owned by the sidebar page. */
export const SIDEBAR_CSS = `
.ghs-wrap{display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px}
.ghs-head{display:flex;align-items:center;gap:8px;padding:10px 12px 6px;flex:none}
.ghs-scope{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.ghs-search{padding:0 12px 8px;flex:none}
.ghs-list{flex:1;min-height:0;overflow:auto;padding:2px 6px 6px}
.ghs-row{display:flex;gap:8px;align-items:flex-start;box-sizing:border-box;padding:7px 8px;border-radius:8px;cursor:grab;user-select:none}
.ghs-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ghs-row:active{cursor:grabbing}
.ghs-row:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}
.ghs-dot{width:7px;height:7px;border-radius:50%;flex:none;margin-top:6px}
.ghs-row-main{flex:1;min-width:0}
.ghs-row-head{display:flex;align-items:center;gap:6px;min-width:0}
.ghs-ref{font-family:var(--dsh-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ghs-state{font-size:10px;line-height:14px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);flex:none}
.ghs-title{margin-top:2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden}
.ghs-empty{padding:24px 12px}
.ghs-loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:28px 12px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.ghs-hint{padding:8px 12px 10px;border-top:0.5px solid var(--dsw-alias-border-l2);flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
`.trim()

/**
 * The sidebar issue list.
 * @param props - snapshot, actions, and the translate function.
 * @returns the scrollable list with a search filter.
 */
export function GitHubSidebar({ snapshot, actions, t }: SidebarProps) {
  const [query, setQuery] = useState('')
  const items = snapshot.list?.items
  const filtered = useMemo(() => {
    const all = items ?? []
    const needle = query.trim().toLowerCase()
    if (needle === '') return all
    return all.filter(card => (
      `${card.repo}#${String(card.number)} ${card.title}`.toLowerCase().includes(needle)
    ))
  }, [items, query])

  const scope = snapshot.prefs.projectId === undefined
    ? snapshot.prefs.org ?? t('panel.scopeGlobal')
    : t('panel.project')

  return (
    <div className="ghs-wrap" data-github-sidebar>
      <StyleSheet chunks={[CONTROLS_CSS, SIDEBAR_CSS]} />
      <div className="ghs-head">
        <span className="ghs-scope" title={scope}>
          {`${scope} · ${String(snapshot.list?.totalCount ?? 0)}`}
        </span>
        <Button size="sm" variant="ghost" onClick={() => actions.refresh()} disabled={snapshot.loading}>
          {t('panel.refresh')}
        </Button>
      </div>
      <div className="ghs-search">
        <TextInput
          value={query}
          onChange={setQuery}
          ariaLabel={t('sidebar.search')}
          placeholder={t('sidebar.search')}
        />
      </div>
      {snapshot.list === undefined
        ? (
          <div className="ghs-loading">
            <Spinner />
            {t('panel.loading')}
          </div>
        )
        : filtered.length === 0
          ? (
            <div className="ghs-empty">
              <EmptyState title={t('sidebar.empty')} hint={t('sidebar.emptyHint')} icon={<GitHubIcon size={18} />} />
            </div>
          )
          : (
            <div className="ghs-list" role="list">
              {filtered.map(card => {
                const tone = stateTone(card.state, card.stateReason)
                const ref = `${card.repo}#${String(card.number)}`
                return (
                  <div
                    key={`${ref}`}
                    className="ghs-row"
                    role="listitem"
                    draggable
                    tabIndex={0}
                    title={`${ref}\n${card.title}`}
                    onDragStart={event => {
                      actions.dragIssue(card)
                      event.dataTransfer.effectAllowed = 'copy'
                      event.dataTransfer.setData('text/plain', ref)
                    }}
                    onDragEnd={() => actions.endDrag()}
                    onClick={() => actions.openInPanel(card)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        actions.openInPanel(card)
                      }
                    }}
                  >
                    <span className="ghs-dot" style={{ background: TONE[tone].dot }} aria-hidden="true" />
                    <div className="ghs-row-main">
                      <div className="ghs-row-head">
                        <span className="ghs-ref">{ref}</span>
                        <span className="ghs-state">{t(stateLabelKey(card.state))}</span>
                      </div>
                      <div className="ghs-title">{card.title}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
      <div className="ghs-hint">{t('sidebar.dragHint')}</div>
    </div>
  )
}
