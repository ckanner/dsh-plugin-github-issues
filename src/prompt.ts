/**
 * Turning one issue into the prompt a handoff writes into the composer.
 *
 * Kept apart from the UI so the exact wording is testable, and so the Host can
 * reuse it when it needs to describe an issue without the browser.
 *
 * @module dsh-plugin-github-issues/prompt
 */

import type { PromptIssue } from './github/types.ts'
import { DEFAULT_PROMPT_TEMPLATE } from './vm.ts'

/** Fill one `{{token}}` occurrence. */
function fill(template: string, token: string, value: string): string {
  return template.split(`{{${token}}}`).join(value)
}

/** A human-readable state line. */
function stateText(issue: PromptIssue): string {
  if (issue.state === 'OPEN') return 'Open'
  return issue.stateReason === 'COMPLETED' ? 'Closed (completed)' : `Closed (${issue.stateReason ?? 'no reason'})`
}

/** The linked-PR line, naming each PR's state so the agent knows what exists. */
function prsText(issue: PromptIssue): string {
  if (issue.linkedPRs.length === 0) return '无'
  return issue.linkedPRs
    .map(pr => {
      const state = pr.merged ? 'merged' : pr.state.toLowerCase()
      return `#${String(pr.number)} (${state}${pr.checks === null ? '' : `, checks ${pr.checks.toLowerCase()}`})`
    })
    .join('、')
}

/** The milestone line. */
function milestoneText(issue: PromptIssue): string {
  if (issue.milestone === undefined) return '无'
  const due = issue.milestone.dueOn === null ? '' : `, due ${issue.milestone.dueOn}`
  const progress = issue.milestone.progress === null ? '' : `, ${String(issue.milestone.progress)}%`
  return `${issue.milestone.title}${due}${progress}`
}

/** The priority line, including where the value came from. */
function priorityText(issue: PromptIssue): string {
  if (issue.priority === undefined) return '无'
  const source = issue.priority.source === 'project'
    ? 'project field'
    : issue.priority.source === 'issue-field' ? 'issue field' : 'label'
  return `${issue.priority.name} (${source})`
}

/**
 * Render the handoff prompt for one issue.
 * @param issue - the card the user dragged or clicked.
 * @param template - the configured template; `{{token}}` placeholders are replaced.
 * @returns the prompt text, trimmed to a size the composer handles comfortably.
 */
export function renderPrompt(issue: PromptIssue, template: string): string {
  const source = template === '' ? DEFAULT_PROMPT_TEMPLATE : template
  let text = source
  text = fill(text, 'repo', issue.repo)
  text = fill(text, 'number', String(issue.number))
  text = fill(text, 'title', issue.title)
  text = fill(text, 'url', issue.url)
  text = fill(text, 'state', stateText(issue))
  text = fill(text, 'milestone', milestoneText(issue))
  text = fill(text, 'priority', priorityText(issue))
  text = fill(text, 'assignees', issue.assignees.length === 0 ? '未指派' : issue.assignees.map(a => a.login).join(', '))
  text = fill(text, 'labels', issue.labels.length === 0 ? '无' : issue.labels.map(l => l.name).join(', '))
  text = fill(text, 'prs', prsText(issue))
  if (text.length > 8_000) return `${text.slice(0, 7_990)}\n…（已截断）`
  return text
}

/** The invisible draft placeholder that keeps the native send enabled. */
export const EMPTY_DRAFT_HOLD = '\u200b\n'

/**
 * Compose the message a pending issue card sends.
 *
 * The card carries the issue prompt; the user's own words are optional and are
 * appended after a blank line. The invisible composer placeholder is stripped.
 *
 * @param prompt - the rendered issue prompt from the card.
 * @param memo - the user's text from the composer (may contain the placeholder).
 * @returns the text to submit.
 */
export function composeHandoffPrompt(prompt: string, memo: string): string {
  const extra = memo.replace(/\u200b/g, '').replace(/^\n+/, '').trim()
  return extra === '' ? prompt : `${prompt}\n\n${extra}`
}
