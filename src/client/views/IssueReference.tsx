/**
 * The issue card rendered in sent user text.
 *
 * The handoff prompt starts with `处理 GitHub Issue：owner/repo#number title`; the
 * conversation's UserText registry replaces that line with the same 240×64 card
 * the composer shows (minus the remove control), and a click opens the issue URL.
 *
 * @module dsh-plugin-github-issues/client/views/IssueReference
 */

import { StyleSheet } from './controls.tsx'
import { GitHubIcon } from './Icon.tsx'

/** The stylesheet chunk owned by the sent-message issue card. */
export const ISSUE_REFERENCE_CSS = `
.ghx-issue-card{display:inline-flex;align-items:center;gap:10px;box-sizing:border-box;width:240px;max-width:100%;height:64px;padding:0 12px;border:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-specific-input-major,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);text-decoration:none;vertical-align:middle;font-family:inherit;margin:6px 0}
.ghx-issue-card:hover{border-color:var(--dsw-alias-border-l3,rgba(0,0,0,.18))}
.ghx-issue-card:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.ghx-issue-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:var(--dsw-radius-md,8px);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 12%,transparent);color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.ghx-issue-body{display:flex;flex-direction:column;flex:1;min-width:0}
.ghx-issue-name{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:14px;font-weight:500;line-height:22px}
.ghx-issue-meta{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;line-height:15px;color:var(--dsw-alias-label-tertiary,#8a9099)}
`.trim()

/** The data the UserText rule attaches to one issue card. */
export interface GitHubIssueReferenceData {
  repo: string
  number: number
  url: string
  /** The prompt's title on the heading line, when present. */
  title?: string
  /** The state from the metadata table, when present. */
  state?: string
}

/**
 * Render one issue card in a sent user message.
 * @param props - the UserText node and its original spelling.
 * @returns the 240×64 card linked to the issue URL.
 */
export function GitHubIssueReference(props: {
  node: { data: GitHubIssueReferenceData }
  raw: string
}) {
  const { repo, number, url, title, state } = props.node.data
  const ref = `${repo}#${String(number)}`
  const meta = [state, title].filter(part => part !== undefined && part !== '').join(' · ')
  return (
    <>
      <StyleSheet chunks={[ISSUE_REFERENCE_CSS]} />
      <a
        className="ghx-issue-card"
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        title={ref}
        aria-label={ref}
      >
        <span className="ghx-issue-icon" aria-hidden="true"><GitHubIcon size={16} /></span>
        <span className="ghx-issue-body">
          <span className="ghx-issue-name">{ref}</span>
          <span className="ghx-issue-meta">{meta === '' ? 'GitHub Issue' : meta}</span>
        </span>
      </a>
    </>
  )
}
