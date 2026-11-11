/**
 * The inline GitHub-issue reference rendered in sent user text.
 *
 * The handoff prompt names the issue as `owner/repo#number`; the conversation's
 * UserText registry turns that token into this clickable chip, so a sent message
 * keeps a recognisable issue reference and any click opens the issue URL.
 *
 * @module dsh-plugin-github-issues/client/views/IssueReference
 */

import { StyleSheet } from './controls.tsx'
import { GitHubIcon } from './Icon.tsx'

/** The stylesheet chunk owned by the inline issue reference. */
export const ISSUE_REFERENCE_CSS = `
.ghx-inline-issue{display:inline-flex;align-items:center;gap:4px;box-sizing:border-box;height:20px;max-width:100%;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-family:var(--dsh-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:18px;text-decoration:none;vertical-align:middle}
.ghx-inline-issue:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.ghx-inline-issue:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.ghx-inline-issue-label{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
`.trim()

/** The data the UserText rule attaches to one issue reference. */
export interface GitHubIssueReferenceData {
  repo: string
  number: number
  url: string
}

/**
 * Render one inline GitHub-issue reference.
 * @param props - the UserText node and its original spelling.
 * @returns a link chip that opens the issue URL.
 */
export function GitHubIssueReference(props: {
  node: { data: GitHubIssueReferenceData }
  raw: string
}) {
  const { repo, number, url } = props.node.data
  const label = `${repo.split('/')[1] ?? repo}#${String(number)}`
  return (
    <>
      <StyleSheet chunks={[ISSUE_REFERENCE_CSS]} />
      <a
        className="ghx-inline-issue"
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        title={`${repo}#${String(number)}`}
        aria-label={`${repo}#${String(number)}`}
      >
        <GitHubIcon size={12} />
        <span className="ghx-inline-issue-label">{label}</span>
      </a>
    </>
  )
}
