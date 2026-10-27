/**
 * The full-page GitHub Issues panel.
 *
 * One scrollable page, laid out like the shipped management pages: a 960px
 * content column, a draggable header, view tabs, the view's scope picker, a local
 * filter, and the issue list. When a row is selected the list keeps its width and
 * the detail pane opens beside it.
 *
 * The page owns only local UI state (the filter text); every list request and
 * every mutation goes through `PanelActions`.
 *
 * @module dsh-plugin-github-issues/client/views/Page
 */

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Prefs } from '../../vm.ts'
import type { PageProps } from '../viewmodel.ts'
import {
  Button, CommandBlock, EmptyState, ErrorBanner, IconButton, Select, Spinner, StyleSheet,
  TextInput, Toast, CONTROLS_CSS, PROJECT_SCOPE_COMMAND,
} from './controls.tsx'
import { CloseGlyph, GitHubIcon, RefreshGlyph, SearchGlyph } from './Icon.tsx'
import { IssueDetailPane, ISSUE_DETAIL_CSS } from './IssueDetail.tsx'
import { IssueRow, ISSUE_ROW_CSS } from './IssueRow.tsx'

/** The page root: fills the panel seat and scrolls on its own. */
export const PAGE_ROOT_STYLE: CSSProperties = {
  height: '100%',
  overflow: 'auto',
  boxSizing: 'border-box',
  color: 'var(--dsw-alias-label-primary)',
  background: 'var(--dsw-alias-bg-base)',
}

/** The centered 960px content column of the page. */
export const PAGE_CONTENT_STYLE: CSSProperties = {
  width: '100%',
  maxWidth: 960,
  margin: '0 auto',
  boxSizing: 'border-box',
  padding: '0 clamp(24px, 4vw, 48px) 48px',
}

/** The page header: draggable title strip with top clearance for the frame. */
export const PAGE_HEAD_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  flexWrap: 'wrap',
  paddingTop: 'calc(28px + var(--dsh-frame-top-clearance, 0px))',
}

/** The page title. */
export const PAGE_H1_STYLE: CSSProperties = {
  margin: 0,
  fontSize: 20,
  lineHeight: '28px',
  fontWeight: 500,
  color: 'var(--dsw-alias-label-primary)',
}

/** The secondary line under the page title. */
export const PAGE_SUBTITLE_STYLE: CSSProperties = {
  marginTop: 2,
  fontSize: 13,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-secondary)',
}

/** The page shell and list styles shared with the settings section. */
export const PAGE_CSS = `
.ghp-page{box-sizing:border-box;height:100%;overflow:auto;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:var(--dsh-content-font-size,14px)}
.ghp-content{box-sizing:border-box;width:100%;max-width:960px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}
.ghp-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
.ghp-title-block{min-width:0}
.ghp-h1{margin:0;font-size:20px;line-height:28px;font-weight:500;color:var(--dsw-alias-label-primary)}
.ghp-subtitle{margin-top:2px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.ghp-head-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.ghp-tabs{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:18px}
.ghp-tab{height:28px;padding:0 10px;border:0;border-radius:var(--dsw-radius-lg,14px);background:transparent;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;cursor:pointer;white-space:nowrap}
.ghp-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.ghp-tab[aria-selected=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:500}
.ghp-tab:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.ghp-picker{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px}
.ghp-notice{display:flex;flex-direction:column;gap:6px;box-sizing:border-box;width:100%;padding:10px 12px;border:0.5px solid var(--dsw-alias-state-warn-primary);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-bg-layer-1));font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.ghp-filters{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:16px 0 8px}
.ghp-search{display:flex;align-items:center;gap:6px;flex:1;min-width:180px;max-width:360px;height:32px;padding:0 4px 0 10px;box-sizing:border-box;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,8px);color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-base)}
.ghp-search:hover{border-color:var(--dsw-alias-border-l2)}
.ghp-search:focus-within{border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-link))}
.ghp-search .gh-input{flex:1;min-width:0;height:30px;width:auto;padding:0;border:0;background:transparent}
.ghp-search .gh-input:hover,.ghp-search .gh-input:focus{border:0}
.ghp-search-icon{display:inline-flex;align-items:center;color:var(--dsw-alias-label-tertiary);flex:none}
.ghp-muted{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.ghp-body{display:block;margin-top:4px}
.ghp-split{display:flex;align-items:flex-start;gap:24px}
.ghp-list-pane{flex:1;min-width:0}
.ghp-footer{display:flex;justify-content:center;padding-top:16px}
.ghp-skeleton-row{display:flex;flex-direction:column;gap:6px;padding:12px 8px;border-top:0.5px solid var(--dsw-alias-border-l2)}
.ghp-skeleton-row:first-child{border-top:0}
.ghp-skeleton-line{height:10px;border-radius:var(--dsw-radius-xs,4px);background:var(--dsw-alias-bg-skeleton,var(--dsw-alias-bg-layer-2));animation:gh-pulse 1.4s ease-in-out infinite}
@keyframes gh-pulse{0%,100%{opacity:.55}50%{opacity:1}}
@media (max-width:760px){.ghp-split{flex-direction:column}.ghp-split .ghx-pane{flex:1 1 auto;width:100%;padding-left:0;border-left:0;padding-top:16px;border-top:0.5px solid var(--dsw-alias-border-l2)}}
`.trim()

/** The ordered view tabs the panel offers. */
const VIEWS: readonly Prefs['view'][] = ['assigned', 'created', 'open', 'repo', 'project']

/** Locale keys for each view tab label. */
const VIEW_LABEL: Record<Prefs['view'], string> = {
  assigned: 'panel.assigned',
  created: 'panel.created',
  open: 'panel.open',
  repo: 'panel.repo',
  project: 'panel.project',
}

/** Locale keys for each state filter option. */
const STATE_LABEL: Record<Prefs['state'], string> = {
  open: 'panel.state.open',
  closed: 'panel.state.closed',
  all: 'panel.state.all',
}

/**
 * The GitHub Issues page.
 * @param props - the panel snapshot, actions, and translate function.
 * @returns the scrollable page.
 */
export function GitHubPage({ snapshot, actions, t }: PageProps) {
  const [filter, setFilter] = useState('')
  const view = snapshot.prefs.view
  const needsCatalog = view === 'repo' || view === 'project'

  // The repository/project pickers expand their catalog on first use only.
  useEffect(() => {
    if (!needsCatalog || snapshot.catalog !== undefined) return
    actions.loadCatalog()
  }, [needsCatalog, snapshot.catalog, actions])

  const items = snapshot.list?.items
  const filtered = useMemo(() => {
    const all = items ?? []
    const query = filter.trim().toLowerCase()
    if (query === '') return all
    return all.filter(card => {
      const haystack = `${card.repo}#${card.number} ${card.title} ${card.labels.map(label => label.name).join(' ')}`
      return haystack.toLowerCase().includes(query)
    })
  }, [items, filter])

  const stateOptions = (Object.keys(STATE_LABEL) as Prefs['state'][]).map(state => ({
    value: state,
    label: t(STATE_LABEL[state]),
  }))

  const repos = snapshot.catalog?.repos ?? []
  const repoOptions = [
    { value: '', label: t('panel.allRepos') },
    ...repos.map(repo => ({
      value: repo.nameWithOwner,
      label: repo.isPrivate ? `${repo.nameWithOwner} · ${t('panel.private')}` : repo.nameWithOwner,
    })),
  ]
  const projectOptions = (snapshot.catalog?.projects ?? []).map(project => ({
    value: project.id,
    label: `${project.title} · ${project.owner}`,
  }))

  const totalCount = snapshot.list?.totalCount
  // The detail pane owns the error while a selected issue's detail is still pending.
  const waitingForDetail = snapshot.selected !== undefined && snapshot.detail === undefined
  const listError = snapshot.error !== undefined && !waitingForDetail ? snapshot.error : undefined
  const showSkeleton = snapshot.loading && snapshot.list === undefined
  const showEmpty = !snapshot.loading && listError === undefined && filtered.length === 0
  const noAuth = snapshot.status?.signedIn === false
  const subtitle = snapshot.status?.signedIn === true && snapshot.status.login !== undefined
    ? t('settings.signedIn', { login: snapshot.status.login })
    : snapshot.loading ? t('panel.loading') : ''
  const split = snapshot.selected !== undefined

  return (
    <section className="ghp-page" style={PAGE_ROOT_STYLE} data-github-panel aria-label={t('panel')}>
      <StyleSheet chunks={[CONTROLS_CSS, PAGE_CSS, ISSUE_ROW_CSS, ISSUE_DETAIL_CSS]} />
      <div className="ghp-content" style={PAGE_CONTENT_STYLE}>
        <header className="ghp-head" style={PAGE_HEAD_STYLE} data-window-drag>
          <div className="ghp-title-block">
            <h1 className="ghp-h1" style={PAGE_H1_STYLE}>{t('panel')}</h1>
            {subtitle !== '' && <div className="ghp-subtitle" style={PAGE_SUBTITLE_STYLE}>{subtitle}</div>}
          </div>
          <div className="ghp-head-actions">
            <Button variant="outline" onClick={() => actions.refresh()} disabled={snapshot.loading}>
              {snapshot.loading ? <Spinner size={12} /> : <RefreshGlyph size={13} />}
              {snapshot.loading ? t('panel.loading') : t('panel.refresh')}
            </Button>
            <Select
              ariaLabel={t('panel.stateFilter')}
              label={t('panel.stateFilter')}
              value={snapshot.prefs.state}
              options={stateOptions}
              onChange={value => actions.setStateFilter(value as Prefs['state'])}
            />
          </div>
        </header>

        <div className="ghp-tabs" role="tablist" aria-label={t('panel.view')}>
          {VIEWS.map(candidate => (
            <button
              key={candidate}
              type="button"
              role="tab"
              className="ghp-tab"
              aria-selected={view === candidate}
              onClick={() => actions.setView(candidate)}
            >
              {t(VIEW_LABEL[candidate])}
            </button>
          ))}
        </div>

        {view === 'repo' && (
          <div className="ghp-picker">
            {snapshot.catalog === undefined
              ? <span className="ghp-muted">{t('panel.loading')}</span>
              : (
                <>
                  <Select
                    label={t('panel.repo')}
                    value={snapshot.prefs.repo ?? ''}
                    options={repoOptions}
                    ariaLabel={t('panel.repo')}
                    onChange={value => actions.setRepo(value === '' ? undefined : value)}
                  />
                  {repos.length === 0 && <span className="ghp-muted">{t('panel.noRepos')}</span>}
                </>
              )}
          </div>
        )}

        {view === 'project' && (
          <div className="ghp-picker">
            {snapshot.catalog === undefined
              ? <span className="ghp-muted">{t('panel.loading')}</span>
              : (
                <>
                  <Select
                    label={t('panel.project')}
                    value={snapshot.prefs.projectId ?? ''}
                    options={projectOptions}
                    placeholder={t('panel.selectProject')}
                    ariaLabel={t('panel.project')}
                    disabled={snapshot.projectsBlocked}
                    onChange={value => actions.setProject(value === '' ? undefined : value)}
                  />
                  {!snapshot.projectsBlocked && projectOptions.length === 0 && (
                    <span className="ghp-muted">{t('panel.noProjects')}</span>
                  )}
                  {snapshot.projectsBlocked && (
                    <div className="ghp-notice" role="note">
                      <span>{t('panel.projectsBlocked')}</span>
                      <CommandBlock
                        command={PROJECT_SCOPE_COMMAND}
                        copyLabel={t('panel.copyCommand')}
                        onCopy={() => actions.copyText(PROJECT_SCOPE_COMMAND)}
                      />
                    </div>
                  )}
                </>
              )}
          </div>
        )}

        <div className="ghp-filters">
          <div className="ghp-search">
            <span className="ghp-search-icon" aria-hidden="true"><SearchGlyph size={13} /></span>
            <TextInput
              value={filter}
              onChange={setFilter}
              placeholder={t('panel.search')}
              ariaLabel={t('panel.search')}
            />
            {filter !== '' && (
              <IconButton label={t('panel.clearSearch')} onClick={() => setFilter('')}>
                <CloseGlyph size={12} />
              </IconButton>
            )}
          </div>
          {totalCount !== undefined && (
            <span className="ghp-muted">{t('panel.total', { count: totalCount })}</span>
          )}
        </div>

        <div className={split ? 'ghp-body ghp-split' : 'ghp-body'}>
          <div className="ghp-list-pane">
            {listError !== undefined && (
              <ErrorBanner
                message={t('panel.error', { message: listError.message })}
                retryLabel={t('panel.refresh')}
                onRetry={() => actions.refresh()}
              >
                {listError.code === 'missing_scope' && (
                  <CommandBlock
                    command={PROJECT_SCOPE_COMMAND}
                    copyLabel={t('panel.copyCommand')}
                    onCopy={() => actions.copyText(PROJECT_SCOPE_COMMAND)}
                  />
                )}
              </ErrorBanner>
            )}

            {showSkeleton && (
              <div className="ghp-list" aria-hidden="true">
                {[0, 1, 2, 3, 4].map(index => (
                  <div key={index} className="ghp-skeleton-row">
                    <div className="ghp-skeleton-line" style={{ width: `${String(30 + index * 8)}%` }} />
                    <div className="ghp-skeleton-line" style={{ width: `${String(70 + (index % 3) * 8)}%` }} />
                  </div>
                ))}
              </div>
            )}

            {showEmpty && (
              <EmptyState
                icon={<GitHubIcon size={28} />}
                title={noAuth ? t('panel.emptyAuth') : snapshot.list?.notice ?? t('panel.empty')}
              />
            )}

            <div className="ghp-list">
              {filtered.map(card => (
                <IssueRow
                  key={card.id}
                  card={card}
                  t={t}
                  selected={snapshot.selected?.id === card.id}
                  onSelect={selected => actions.selectIssue(selected)}
                  promptText={target => actions.promptText(target)}
                />
              ))}
            </div>

            {snapshot.list !== undefined && snapshot.list.pageInfo.hasNextPage && (
              <div className="ghp-footer">
                <Button variant="outline" size="sm" onClick={() => actions.loadMore()} disabled={snapshot.loadingMore}>
                  {snapshot.loadingMore && <Spinner size={12} />}
                  {snapshot.loadingMore ? t('panel.loading') : t('panel.loadMore')}
                </Button>
              </div>
            )}
            {snapshot.list !== undefined && !snapshot.list.pageInfo.hasNextPage && filtered.length > 0 && (
              <div className="ghp-footer">
                <span className="ghp-muted">{t('panel.showing', { count: filtered.length })}</span>
              </div>
            )}
          </div>

          {split && <IssueDetailPane snapshot={snapshot} actions={actions} t={t} />}
        </div>
      </div>

      {snapshot.toast !== undefined && (
        <Toast text={t(snapshot.toast)} onDismiss={() => actions.clearToast()} dismissLabel={t('panel.close')} />
      )}
    </section>
  )
}
