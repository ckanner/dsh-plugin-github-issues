/**
 * The full-page GitHub Issues panel.
 *
 * One scrollable page, laid out like the shipped management pages: a 960px
 * content column, a draggable header, the scope cascade (organization → project →
 * repository → assignee → state), a local filter, and the issue list. When a row
 * is selected the list keeps its width and the detail pane opens beside it.
 *
 * The page owns only local UI state (the filter text and the repository combobox
 * input); every list request and every mutation goes through `PanelActions`.
 *
 * @module dsh-plugin-github-issues/client/views/Page
 */

import { useEffect, useId, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { IssueCardVM, Prefs } from '../../vm.ts'
import type { PageProps } from '../viewmodel.ts'
import {
  Button, CommandBlock, EmptyState, ErrorBanner, IconButton, Select, Spinner, StyleSheet,
  TextInput, Toast, CONTROLS_CSS, PROJECT_SCOPE_COMMAND,
} from './controls.tsx'
import { CloseGlyph, GitHubIcon, RefreshGlyph, SearchGlyph } from './Icon.tsx'
import { IssueDetailPane, ISSUE_DETAIL_CSS } from './IssueDetail.tsx'
import { ISSUE_ROW_CSS, IssueRow } from './IssueRow.tsx'

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
.ghp-scope{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;align-items:end;margin-top:18px}
.ghp-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.ghp-field-label{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ghp-field .gh-select-wrap{width:100%;min-width:0}
.ghp-field .gh-select-wrap .gh-field-label{display:none}
.ghp-field .gh-select{width:100%;height:30px;box-sizing:border-box}
.ghp-field .gh-input{width:100%;height:30px;box-sizing:border-box}
.ghp-notice{display:flex;flex-direction:column;gap:6px;box-sizing:border-box;width:100%;padding:10px 12px;border:0.5px solid var(--dsw-alias-state-warn-primary);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-bg-layer-1));font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin-top:12px}
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

/** Locale keys for each state filter option. */
const STATE_LABEL: Record<Prefs['state'], string> = {
  open: 'panel.state.open',
  closed: 'panel.state.closed',
  all: 'panel.state.all',
}

/** One option a native datalist offers. */
interface ComboOption {
  value: string
  label: string
}

/**
 * One labelled control in the scope grid. The label sits above every control so
 * selects and the repository combobox share one baseline.
 * @param props - label and the control.
 * @returns the labelled field cell.
 */
function Field(props: { label: string, children: ReactNode }) {
  return (
    <div className="ghp-field">
      <span className="ghp-field-label">{props.label}</span>
      {props.children}
    </div>
  )
}

/**
 * A searchable picker: a text input backed by a native `<datalist>`.
 * @param props - label, current selection, options, and the change callback.
 * @returns the labelled combobox.
 */
function ScopeCombo(props: {
  label: string
  value: string | undefined
  placeholder: string
  options: readonly ComboOption[]
  disabled?: boolean
  onChange: (value: string | undefined) => void
}) {
  const { label, value, placeholder, options, disabled, onChange } = props
  const listId = useId()
  const selected = options.find(option => option.value === value)
  const [text, setText] = useState(selected?.label ?? '')

  // The parent owns the selection: follow it when it changes elsewhere.
  useEffect(() => {
    const current = options.find(option => option.value === value)
    setText(current?.label ?? '')
  }, [value, options])

  return (
    <>
      <input
        className="gh-input"
        list={listId}
        value={text}
        disabled={disabled === true}
        placeholder={placeholder}
        aria-label={label}
        onChange={event => {
          const next = event.target.value
          setText(next)
          if (next === '') {
            onChange(undefined)
            return
          }
          const match = options.find(option => option.label === next || option.value === next)
          if (match !== undefined) onChange(match.value)
        }}
        onBlur={() => {
          // A half-typed name reverts to the actual selection.
          const current = options.find(option => option.value === value)
          setText(current?.label ?? '')
        }}
      />
      <datalist id={listId}>
        {options.map(option => <option key={option.value} value={option.label} />)}
      </datalist>
    </>
  )
}

/**
 * The GitHub Issues page.
 * @param props - the panel snapshot, actions, and translate function.
 * @returns the scrollable page.
 */
export function GitHubPage({ snapshot, actions, t, resolveSession }: PageProps) {
  const [filter, setFilter] = useState('')
  const prefs = snapshot.prefs

  // The viewer/organization catalog expands on first use only.
  useEffect(() => {
    if (snapshot.catalog === undefined) actions.loadCatalog()
  }, [snapshot.catalog, actions])

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

  const orgs = snapshot.catalog?.orgs ?? []
  const orgOptions = [
    { value: '', label: t('panel.allOrgs') },
    ...orgs.map(org => ({ value: org.login, label: org.name === undefined ? org.login : `${org.login} · ${org.name}` })),
  ]
  const projectOptions = [
    { value: '', label: t('panel.allProjects') },
    ...(snapshot.orgProjects ?? []).map(project => ({ value: project.id, label: project.title })),
  ]
  const repoSource = prefs.org === undefined
    ? (snapshot.catalog?.repos ?? [])
    : (snapshot.orgRepos?.items ?? [])
  const repoOptions: ComboOption[] = repoSource.map(repo => ({
    value: repo.nameWithOwner,
    label: `${repo.nameWithOwner}${repo.isPrivate ? ` · ${t('panel.private')}` : ''}${repo.isFork === true ? ` · ${t('panel.fork')}` : ''}`,
  }))
  const assigneeOptions = [
    { value: '@me', label: t('panel.assignee.me') },
    { value: 'all', label: t('panel.assignee.all') },
  ]

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
  const scopeHint =
    prefs.org === undefined
      ? t('panel.scopeGlobal')
      : `${prefs.org}${prefs.projectId === undefined ? '' : ` · ${t('panel.project')}`}${prefs.repo === undefined ? '' : ` · ${prefs.repo}`}`

  return (
    <section className="ghp-page" style={PAGE_ROOT_STYLE} data-github-panel aria-label={t('panel')}>
      <StyleSheet chunks={[CONTROLS_CSS, PAGE_CSS, ISSUE_ROW_CSS, ISSUE_DETAIL_CSS]} />
      <div className="ghp-content" style={PAGE_CONTENT_STYLE}>
        <header className="ghp-head" style={PAGE_HEAD_STYLE} data-window-drag>
          <div className="ghp-title-block">
            <h1 className="ghp-h1" style={PAGE_H1_STYLE}>{t('panel')}</h1>
            {(subtitle !== '' || scopeHint !== '') && (
              <div className="ghp-subtitle" style={PAGE_SUBTITLE_STYLE}>
                {subtitle}
                {subtitle !== '' && scopeHint !== '' ? ' · ' : ''}
                {scopeHint}
              </div>
            )}
          </div>
          <div className="ghp-head-actions">
            <Button variant="ghost" onClick={() => actions.openInSidebar()}>
              {t('panel.openSidebar')}
            </Button>
            <Button variant="outline" onClick={() => actions.refresh()} disabled={snapshot.loading}>
              {snapshot.loading ? <Spinner size={12} /> : <RefreshGlyph size={13} />}
              {snapshot.loading ? t('panel.loading') : t('panel.refresh')}
            </Button>
          </div>
        </header>

        <div className="ghp-scope">
          <Field label={t('panel.org')}>
            <Select
              ariaLabel={t('panel.org')}
              value={prefs.org ?? ''}
              options={orgOptions}
              onChange={value => actions.setOrg(value === '' ? undefined : value)}
            />
          </Field>
          <Field label={t('panel.project')}>
            <Select
              ariaLabel={t('panel.project')}
              value={prefs.org === undefined ? '' : prefs.projectId ?? ''}
              options={projectOptions}
              disabled={prefs.org === undefined || snapshot.projectsBlocked}
              onChange={value => actions.setProject(value === '' ? undefined : value)}
            />
          </Field>
          <Field label={t('panel.repoFilter')}>
            <ScopeCombo
              label={t('panel.repoFilter')}
              value={prefs.repo}
              placeholder={prefs.org === undefined ? t('panel.allRepos') : `${t('panel.allRepos')}（${String(repoOptions.length)}）`}
              options={repoOptions}
              onChange={repo => actions.setRepo(repo)}
            />
          </Field>
          <Field label={t('panel.assignee')}>
            <Select
              ariaLabel={t('panel.assignee')}
              value={prefs.assignee}
              options={assigneeOptions}
              onChange={value => actions.setAssignee(value)}
            />
          </Field>
          <Field label={t('panel.stateFilter')}>
            <Select
              ariaLabel={t('panel.stateFilter')}
              value={prefs.state}
              options={stateOptions}
              onChange={value => actions.setStateFilter(value as Prefs['state'])}
            />
          </Field>
        </div>

        {prefs.org === undefined && (
          <div className="ghp-notice" role="note">
            <span>{t('panel.pickOrgHint')}</span>
          </div>
        )}

        {snapshot.projectsBlocked && prefs.org !== undefined && (
          <div className="ghp-notice" role="note">
            <span>{t('panel.projectsBlocked')}</span>
            <CommandBlock
              command={PROJECT_SCOPE_COMMAND}
              copyLabel={t('panel.copyCommand')}
              onCopy={() => actions.copyText(PROJECT_SCOPE_COMMAND)}
            />
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
          {snapshot.scopeLoading && <span className="ghp-muted">{t('panel.loadingScope')}</span>}
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
                title={noAuth ? t('panel.emptyAuth') : snapshot.list?.notice ?? emptyTitle(prefs, snapshot.list?.totalCount, t)}
              />
            )}

            <div className="ghp-list">
              {filtered.map((card: IssueCardVM) => (
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

          {split && <IssueDetailPane snapshot={snapshot} actions={actions} t={t} resolveSession={resolveSession} />}
        </div>
      </div>

      {snapshot.toast !== undefined && (
        <Toast text={t(snapshot.toast)} onDismiss={() => actions.clearToast()} dismissLabel={t('panel.close')} />
      )}
    </section>
  )
}

/**
 * The empty-state sentence for the current cascade.
 * @param prefs - the active filters.
 * @param total - the project's total item count, when GitHub reported one.
 * @param t - translate function.
 * @returns the sentence to show.
 */
function emptyTitle(prefs: Prefs, total: number | undefined, t: PageProps['t']): string {
  const projectId = prefs.org === undefined ? undefined : prefs.projectId
  if (projectId !== undefined && prefs.assignee === '@me') {
    return t('panel.emptyProjectMe', { count: total ?? 0 })
  }
  if (projectId !== undefined && prefs.state === 'open') {
    return t('panel.emptyProjectOpen')
  }
  return t('panel.empty')
}
