/**
 * The UserText rule that recognises issue references in sent messages.
 *
 * The composer card itself covers the typing surface; this rule is what keeps a
 * recognisable, clickable issue reference once the prompt lands in the
 * transcript. The model-visible text is unchanged: only the display is matched.
 *
 * @module dsh-plugin-github-issues/client/reference
 */

import type { GitHubIssueReferenceData } from './views/IssueReference.tsx'

/** One UserText match for the GitHub issue grammar. */
export interface GitHubIssueReferenceRule {
  id: 'github-issue'
  order: number
  match(text: string, from: number): {
    id: 'github-issue'
    start: number
    end: number
    data: GitHubIssueReferenceData
  } | undefined
}

/** The token grammar: `owner/repo#123`, not embedded in a longer word or URL. */
const ISSUE_TOKEN = /(?<![A-Za-z0-9_.\-/])([A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+)#([1-9][0-9]*)/g

/** The UserText rule registered with the conversation service. */
export const GITHUB_ISSUE_RULE: GitHubIssueReferenceRule = {
  id: 'github-issue',
  order: 40,
  match(text, from) {
    ISSUE_TOKEN.lastIndex = from
    for (let match = ISSUE_TOKEN.exec(text); match !== null; match = ISSUE_TOKEN.exec(text)) {
      const repo = match[1]
      const numberText = match[2]
      if (repo === undefined || numberText === undefined) continue
      const number = Number(numberText)
      if (!Number.isInteger(number) || number <= 0) continue
      return {
        id: 'github-issue',
        start: match.index,
        end: match.index + match[0].length,
        data: {
          repo,
          number,
          url: `https://github.com/${repo}/issues/${String(number)}`,
        },
      }
    }
    return undefined
  },
}
