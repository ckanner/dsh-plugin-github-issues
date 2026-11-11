import assert from 'node:assert/strict'
import test from 'node:test'

import { GITHUB_ISSUE_RULE } from '../src/client/reference.ts'

test('the sent-text rule turns the prompt heading into a card with title and state', () => {
  const text = [
    '处理 GitHub Issue：one2x-ai/mesh#2469 修复登录态丢失',
    '',
    '链接：https://github.com/one2x-ai/mesh/issues/2469',
    '',
    '| 字段 | 值 |',
    '| --- | --- |',
    '| 状态 | Open |',
  ].join('\n')
  const match = GITHUB_ISSUE_RULE.match(text, 0)
  assert.ok(match !== undefined)
  assert.equal(text.slice(match.start, match.end), '处理 GitHub Issue：one2x-ai/mesh#2469 修复登录态丢失')
  assert.deepEqual(match.data, {
    repo: 'one2x-ai/mesh',
    number: 2469,
    url: 'https://github.com/one2x-ai/mesh/issues/2469',
    title: '修复登录态丢失',
    state: 'Open',
  })
})

test('a leading handoff marker does not hide the heading', () => {
  const text = '\u200a处理 GitHub Issue：one2x-ai/mesh#2469 标题'
  const match = GITHUB_ISSUE_RULE.match(text, 0)
  assert.ok(match !== undefined)
  assert.equal(text.slice(match.start, match.end), '处理 GitHub Issue：one2x-ai/mesh#2469 标题')
})

test('the rule requires the prompt heading and a valid number', () => {
  assert.equal(GITHUB_ISSUE_RULE.match('one2x-ai/mesh#2469 只是普通文字', 0), undefined)
  assert.equal(GITHUB_ISSUE_RULE.match('处理 GitHub Issue：one2x-ai/mesh#0', 0), undefined)
  assert.equal(GITHUB_ISSUE_RULE.match('处理 GitHub Issue：one2x-ai#2469', 0), undefined)
})

test('the legacy state line is still recognised', () => {
  const text = '处理 GitHub Issue：one2x-ai/mesh#2469 标题\n状态：Open ｜ 里程碑：v2.1\n关联 PR：无'
  const match = GITHUB_ISSUE_RULE.match(text, 0)
  assert.equal(match?.data.state, 'Open')
})
