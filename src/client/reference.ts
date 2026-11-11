/**
 * The UserText rule that recognises the handoff prompt's issue heading.
 *
 * The composer card covers the typing surface; this rule is what gives a sent
 * message the same card presentation. It replaces the prompt line
 * `处理 GitHub Issue：owner/repo#number title` with the issue card and folds the
 * metadata table's state into the card's second line. The model-visible text is
 * unchanged: only the display is matched.
 *
 * @module dsh-plugin-github-issues/client/reference
 */

import type { GitHubIssueReferenceData } from './views/IssueReference.tsx'

/** One UserText match for the handoff prompt heading. */
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

/** The prompt heading; the optional tail is the title on the same line. */
const ISSUE_HEADING = /处理 GitHub Issue：([A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+)#([1-9][0-9]*)(?:[ \t]+([^\n]+))?/g

/** The state cell of the default metadata table, or the legacy state line. */
const STATE_TABLE = /\|\s*状态\s*\|\s*([^|\n]+?)\s*\|/u
const STATE_LEGACY = /状态：([^\n｜|]+)/u

/**
 * Extract the issue's state from the prompt body.
 * @param text - the whole user message.
 * @returns the state label, when the prompt carries one.
 */
function stateOf(text: string): string | undefined {
  const table = STATE_TABLE.exec(text)
  if (table?.[1] !== undefined) return table[1].trim()
  const legacy = STATE_LEGACY.exec(text)
  return legacy?.[1]?.trim()
}

/** The UserText rule registered with the conversation service. */
export const GITHUB_ISSUE_RULE: GitHubIssueReferenceRule = {
  id: 'github-issue',
  order: 40,
  match(text, from) {
    ISSUE_HEADING.lastIndex = from
    for (let match = ISSUE_HEADING.exec(text); match !== null; match = ISSUE_HEADING.exec(text)) {
      // Only a real prompt heading at a line start. The handoff draft starts with
      // a whitespace marker, so the heading may be preceded by that whitespace.
      const before = match.index === 0 ? '' : (text[match.index - 1] ?? '')
      if (before !== '' && before !== '\n' && !/\s/u.test(before)) continue
      const repo = match[1]
      const numberText = match[2]
      if (repo === undefined || numberText === undefined) continue
      const number = Number(numberText)
      if (!Number.isInteger(number) || number <= 0) continue
      const title = match[3]?.trim()
      const state = stateOf(text)
      return {
        id: 'github-issue',
        start: match.index,
        end: match.index + match[0].length,
        data: {
          repo,
          number,
          url: `https://github.com/${repo}/issues/${String(number)}`,
          ...title === undefined || title === '' ? {} : { title },
          ...state === undefined || state === '' ? {} : { state },
        },
      }
    }
    return undefined
  },
}
