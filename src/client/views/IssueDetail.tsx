/**
 * The issue detail pane shown beside the panel list.
 *
 * It renders exactly what the Host's `IssueDetailVM` carries: body text as
 * pre-wrap plain text, milestone progress, labels, assignees, linked and
 * mentioning pull requests, and the comment/update footer. The pane never
 * fetches anything itself; every action goes through `PanelActions`, and every
 * string through the namespace translate function.
 *
 * @module dsh-plugin-github-issues/client/views/IssueDetail
 */

import type { Translate } from '../context.ts'
import type { LinkedPRVM } from '../../vm.ts'
import type { PageProps } from '../viewmodel.ts'
import {
  Badge, Button, Chip, EmptyState, ErrorBanner, IconButton, ProgressBar, TONE,
} from './controls.tsx'
import { CloseGlyph, CopyGlyph, ExternalGlyph, GitHubIcon, PinGlyph } from './Icon.tsx'
import {
  checksGlyph, formatDue, labelsWithoutPriority, prGlyph, prioritySourceLabel, priorityTone,
  relativeTime, reviewGlyph, stateLabelKey, stateTone,
} from './format.ts'

/** The stylesheet chunk owned by this module. */
export const ISSUE_DETAIL_CSS = `
.ghx-pane{display:flex;flex-direction:column;gap:12px;box-sizing:border-box;flex:0 0 380px;width:380px;min-width:0;padding-left:20px;border-left:0.5px solid var(--dsw-alias-border-l2)}
.ghx-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
.ghx-ref{font-family:var(--dsh-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.ghx-ref:hover{color:var(--dsw-alias-link);text-decoration:underline}
.ghx-head-spacer{flex:1;min-width:0}
.ghx-title{margin:0;font-size:16px;line-height:24px;font-weight:500;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}
.ghx-title a{color:inherit;text-decoration:none}
.ghx-title a:hover{text-decoration:underline}
.ghx-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.ghx-body{margin:0;max-height:320px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;box-sizing:border-box;padding:10px 12px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;color:var(--dsw-alias-label-primary)}
.ghx-section{display:flex;flex-direction:column;gap:6px}
.ghx-section-title{margin:0;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.02em}
.ghx-muted{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.ghx-chips{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.ghx-assignees{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ghx-assignee{display:inline-flex;align-items:center;gap:5px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.ghx-avatar{width:18px;height:18px;border-radius:50%;flex:none;object-fit:cover}
.ghx-avatar-fallback{display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:9px;font-weight:600;text-transform:uppercase}
.ghx-prs{display:flex;flex-direction:column;gap:6px}
.ghx-pr{display:flex;flex-direction:column;gap:2px;box-sizing:border-box;padding:6px 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-1)}
.ghx-pr-head{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
.ghx-pr-title{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.ghx-pr-link{font-family:var(--dsh-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:18px;color:var(--dsw-alias-link);text-decoration:none}
.ghx-pr-link:hover{text-decoration:underline}
.ghx-glyph{font-size:12px;line-height:1}
.ghx-skeleton{display:flex;flex-direction:column;gap:8px}
.ghx-skeleton-line{height:12px;border-radius:var(--dsw-radius-xs,4px);background:var(--dsw-alias-bg-skeleton,var(--dsw-alias-bg-layer-2));animation:gh-pulse 1.4s ease-in-out infinite}
@keyframes gh-pulse{0%,100%{opacity:.55}50%{opacity:1}}
`.trim()

/** Props of the local pull-request row. */
interface LinkedPRRowProps {
  /** The pull request to render. */
  pr: LinkedPRVM
  /** Namespace translate function. */
  t: Translate
}

/**
 * One linked/mentioned pull request inside the detail pane.
 * @param props - the PR and the translate function.
 * @returns a compact card with state, checks, review, and failing checks.
 */
function LinkedPRRow({ pr, t }: LinkedPRRowProps) {
  const state = prGlyph(pr)
  const checks = checksGlyph(pr)
  const review = reviewGlyph(pr)
  const failing = pr.failingChecks ?? []
  return (
    <div className="ghx-pr">
      <div className="ghx-pr-head">
        <a className="ghx-pr-link" href={pr.url} target="_blank" rel="noreferrer">#{pr.number}</a>
        <Badge tone={state.tone} title={t(state.label)}>
          <span className="ghx-glyph" aria-hidden="true">{state.glyph}</span>
          {t(state.label)}
        </Badge>
        {checks !== undefined && (
          <span title={t(checks.label, { count: failing.length })} style={{ color: TONE[checks.tone].dot }}>
            <span className="ghx-glyph" aria-hidden="true">{checks.glyph}</span>
            <span className="ghx-muted"> {t(checks.label, { count: failing.length })}</span>
          </span>
        )}
        {review !== undefined && (
          <span title={t(review.label)} style={{ color: TONE[review.tone].dot }}>
            <span className="ghx-glyph" aria-hidden="true">{review.glyph}</span>
            <span className="ghx-muted"> {t(review.label)}</span>
          </span>
        )}
      </div>
      <div className="ghx-pr-title">{pr.title}</div>
      {failing.length > 0 && (
        <div className="ghx-muted">
          {t('panel.checks.failure', { count: failing.length })}: {failing.slice(0, 4).join(', ')}
          {failing.length > 4 ? '…' : ''}
        </div>
      )}
    </div>
  )
}

/** Props of the metadata footer of the pane. */
interface FooterProps {
  /** Comment count to show. */
  commentCount: number
  /** ISO time of the last update. */
  updatedAt: string
  /** Namespace translate function. */
  t: Translate
}

/**
 * The comment/update footer line.
 * @param props - counts, timestamp, and translate function.
 * @returns the footer line.
 */
function DetailFooter({ commentCount, updatedAt, t }: FooterProps) {
  return (
    <div className="ghx-muted">
      {t('panel.comments', { count: commentCount })}
      {' · '}
      {t('panel.updated', { time: relativeTime(updatedAt) })}
    </div>
  )
}

/**
 * The issue detail pane of the GitHub panel.
 * @param props - the panel snapshot, actions, and translate function.
 * @returns the pane, or `null` when no issue is selected.
 */
export function IssueDetailPane({ snapshot, actions, t }: PageProps) {
  const card = snapshot.detail ?? snapshot.selected
  if (card === undefined) return null

  const detail = snapshot.detail
  const error = snapshot.error
  const detailFailed = detail === undefined && !snapshot.detailLoading && error !== undefined
  const showSkeleton = detail === undefined && snapshot.detailLoading
  const showHint = detail === undefined && !snapshot.detailLoading && error === undefined
  const tone = stateTone(card.state, card.stateReason)
  const body = detail?.body !== undefined && detail.body !== '' ? detail.body : detail?.bodyExcerpt

  return (
    <aside className="ghx-pane" aria-label={t('panel.detail')}>
      <div className="ghx-head">
        <a className="ghx-ref" href={card.url} target="_blank" rel="noreferrer">{card.repo}#{card.number}</a>
        <Badge tone={tone}>{t(stateLabelKey(card.state))}</Badge>
        {card.priority !== undefined && (
          <Badge tone={priorityTone(card.priority.name)} title={t(prioritySourceLabel(card.priority.source))}>
            {card.priority.name}
          </Badge>
        )}
        {card.issueType !== undefined && <Badge tone="neutral" title={t('panel.type')}>{card.issueType.name}</Badge>}
        <span className="ghx-head-spacer" />
        <IconButton label={t('panel.close')} onClick={() => actions.closeDetail()}>
          <CloseGlyph size={14} />
        </IconButton>
      </div>

      <h2 className="ghx-title">
        <a href={card.url} target="_blank" rel="noreferrer">{card.title}</a>
      </h2>

      <div className="ghx-actions">
        <a className="gh-btn gh-btn-outline gh-btn-sm" href={card.url} target="_blank" rel="noreferrer">
          <ExternalGlyph size={12} />
          {t('panel.openOnGitHub')}
        </a>
        <Button size="sm" variant="ghost" onClick={() => actions.copyPrompt(card)}>
          <CopyGlyph size={12} />
          {t('panel.copyPrompt')}
        </Button>
        <Button size="sm" variant="primary" onClick={() => actions.handoff(card)}>{t('panel.handoff')}</Button>
        <Button size="sm" variant="ghost" onClick={() => actions.pin(card)}>
          <PinGlyph size={12} />
          {t('panel.pin')}
        </Button>
      </div>

      {detailFailed && error !== undefined && (
        <ErrorBanner
          message={t('panel.error', { message: error.message })}
          retryLabel={t('panel.retry')}
          onRetry={() => actions.selectIssue(card)}
        />
      )}

      {showSkeleton && (
        <div className="ghx-skeleton" aria-hidden="true">
          <div className="ghx-skeleton-line" style={{ width: '92%' }} />
          <div className="ghx-skeleton-line" style={{ width: '78%' }} />
          <div className="ghx-skeleton-line" style={{ width: '85%' }} />
        </div>
      )}

      {showHint && (
        <EmptyState title={t('panel.detail.empty')} icon={<GitHubIcon size={24} />} />
      )}

      {detail !== undefined && (
        <>
          <pre className="ghx-body" style={{ whiteSpace: 'pre-wrap' }}>
            {body === undefined || body === '' ? t('panel.noBody') : body}
          </pre>

          <section className="ghx-section">
            <h3 className="ghx-section-title">{t('panel.milestone')}</h3>
            {detail.milestone === undefined
              ? <div className="ghx-muted">{t('panel.noMilestone')}</div>
              : (
                <>
                  <div style={{ fontSize: 'var(--dsh-content-font-size-secondary, 13px)', lineHeight: '20px', fontWeight: 500 }}>{detail.milestone.title}</div>
                  {detail.milestone.dueOn !== null && (
                    <div className="ghx-muted">{t('panel.due', { date: formatDue(detail.milestone.dueOn) })}</div>
                  )}
                  {detail.milestone.progress !== null && (
                    <ProgressBar
                      value={detail.milestone.progress}
                      label={t('panel.progress', { percent: detail.milestone.progress })}
                    />
                  )}
                </>
              )}
          </section>

          <section className="ghx-section">
            <h3 className="ghx-section-title">{t('panel.labels')}</h3>
            <div className="ghx-chips">
              {labelsWithoutPriority(detail).length === 0
                ? <span className="ghx-muted">—</span>
                : labelsWithoutPriority(detail).map(label => (
                  <Chip key={label.name} label={label.name} color={label.color} />
                ))}
            </div>
          </section>

          <section className="ghx-section">
            <h3 className="ghx-section-title">{t('panel.assignees')}</h3>
            <div className="ghx-assignees">
              {detail.assignees.length === 0
                ? <span className="ghx-muted">{t('panel.noAssignees')}</span>
                : detail.assignees.map(assignee => (
                  <span key={assignee.login} className="ghx-assignee">
                    {assignee.avatarUrl === undefined
                      ? (
                        <span className="ghx-avatar ghx-avatar-fallback" aria-hidden="true">
                          {assignee.login.slice(0, 1)}
                        </span>
                      )
                      : <img className="ghx-avatar" src={assignee.avatarUrl} alt="" width={18} height={18} loading="lazy" />}
                    {assignee.login}
                  </span>
                ))}
            </div>
          </section>

          <section className="ghx-section">
            <h3 className="ghx-section-title">{t('panel.linkedPRs')}</h3>
            {detail.linkedPRs.length === 0
              ? <div className="ghx-muted">{t('panel.noPRs')}</div>
              : (
                <div className="ghx-prs">
                  {detail.linkedPRs.map(pr => <LinkedPRRow key={pr.number} pr={pr} t={t} />)}
                </div>
              )}
          </section>

          {detail.mentionedPRs.length > 0 && (
            <section className="ghx-section">
              <h3 className="ghx-section-title">{t('panel.mentionedPRs')}</h3>
              <div className="ghx-prs">
                {detail.mentionedPRs.map(pr => <LinkedPRRow key={pr.number} pr={pr} t={t} />)}
              </div>
            </section>
          )}

          <DetailFooter commentCount={detail.commentCount} updatedAt={detail.updatedAt} t={t} />
        </>
      )}
    </aside>
  )
}
