/**
 * Prompt rendering: the handoff text must be complete, stable, and bounded.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { renderPrompt } from '../src/prompt.ts'
import { DEFAULT_PROMPT_TEMPLATE, type IssueCardVM } from '../src/vm.ts'

/** One field override; `undefined` is meaningful (it removes the value). */
type Overrides = { [K in keyof IssueCardVM]?: IssueCardVM[K] | undefined }

/** A card with every field present. */
function card(overrides: Overrides = {}): IssueCardVM {
  const base: IssueCardVM = {
    id: 'I_1',
    repo: 'one2x-ai/mesh',
    number: 2469,
    title: '修复登录态丢失',
    url: 'https://github.com/one2x-ai/mesh/issues/2469',
    state: 'OPEN',
    stateReason: null,
    isPrivate: true,
    issueType: { name: 'Bug', color: 'RED' },
    labels: [{ name: 'P1', color: 'fbca04' }, { name: 'status/in-progress', color: '1d76db' }],
    milestone: { title: 'v2.1', dueOn: '2026-11-02', state: 'OPEN', progress: 82.6 },
    assignees: [{ login: 'ckanner' }],
    updatedAt: '2026-10-27T12:50:56Z',
    commentCount: 8,
    bodyExcerpt: '登录态在刷新后丢失',
    priority: { source: 'label', name: 'P1', color: 'fbca04' },
    linkedPRs: [
      {
        number: 2527,
        title: 'fix session restore',
        url: 'https://github.com/one2x-ai/mesh/pull/2527',
        state: 'MERGED',
        isDraft: false,
        merged: true,
        reviewDecision: 'APPROVED',
        checks: 'SUCCESS',
        author: 'alice',
      },
    ],
  }
  return { ...base, ...overrides } as IssueCardVM
}

test('the default template renders every placeholder', () => {
  const text = renderPrompt(card(), DEFAULT_PROMPT_TEMPLATE)
  assert.match(text, /one2x-ai\/mesh#2469/)
  assert.match(text, /修复登录态丢失/)
  assert.match(text, /https:\/\/github\.com\/one2x-ai\/mesh\/issues\/2469/)
  assert.match(text, /Open/)
  assert.match(text, /v2\.1, due 2026-11-02, 82\.6%/)
  assert.match(text, /P1 \(label\)/)
  assert.match(text, /ckanner/)
  assert.match(text, /P1, status\/in-progress/)
  assert.match(text, /#2527 \(merged, checks success\)/)
  assert.match(text, /subagent_codex/)
})

test('a custom template replaces only its own placeholders', () => {
  const text = renderPrompt(card(), '{{repo}}#{{number}} — {{title}}')
  assert.equal(text, 'one2x-ai/mesh#2469 — 修复登录态丢失')
})

test('absent values read as explicit "none" rather than blank lines', () => {
  const text = renderPrompt(card({
    milestone: undefined,
    priority: undefined,
    assignees: [],
    labels: [],
    linkedPRs: [],
  }), '{{milestone}}|{{priority}}|{{assignees}}|{{labels}}|{{prs}}')
  assert.equal(text, '无|无|未指派|无|无')
})

test('a closed issue names its reason', () => {
  const text = renderPrompt(card({ state: 'CLOSED', stateReason: 'COMPLETED' }), '{{state}}')
  assert.equal(text, 'Closed (completed)')
  const duplicate = renderPrompt(card({ state: 'CLOSED', stateReason: 'DUPLICATE' }), '{{state}}')
  assert.equal(duplicate, 'Closed (DUPLICATE)')
})

test('project and issue-field priorities name their source', () => {
  const project = renderPrompt(card({ priority: { source: 'project', name: 'High' } }), '{{priority}}')
  assert.equal(project, 'High (project field)')
  const issueField = renderPrompt(card({ priority: { source: 'issue-field', name: 'Urgent' } }), '{{priority}}')
  assert.equal(issueField, 'Urgent (issue field)')
})

test('an oversized prompt is truncated with a marker', () => {
  const huge = renderPrompt(card(), `${'x'.repeat(9_000)}{{title}}`)
  assert.ok(huge.length <= 8_000, `expected <= 8000 chars, got ${String(huge.length)}`)
  assert.match(huge, /已截断/)
})

test('an empty template falls back to the built-in one', () => {
  const text = renderPrompt(card(), '')
  assert.match(text, /处理 GitHub Issue/)
})
