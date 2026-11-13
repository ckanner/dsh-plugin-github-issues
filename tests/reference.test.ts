import assert from 'node:assert/strict'
import test from 'node:test'

import { GITHUB_ISSUE_RULE } from '../src/client/reference.ts'
import { PROMPT_BLOCK_END, PROMPT_BLOCK_START } from '../src/prompt.ts'

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

test('the rule hides the whole machine prompt block and leaves the user memo', () => {
  const prompt = [
    '处理 GitHub Issue：one2x-ai/mesh#2469 修复登录态丢失',
    '',
    '链接：https://github.com/one2x-ai/mesh/issues/2469',
    '',
    '| 状态 | Open |',
    '',
    '要求：先读 Issue 正文。',
  ].join('\n')
  const memo = '看一下这个 issue 吧，现在什么情况？'
  const text = `${PROMPT_BLOCK_START}${prompt}${PROMPT_BLOCK_END}\n\n${memo}`
  const match = GITHUB_ISSUE_RULE.match(text, 0)
  assert.ok(match !== undefined)
  assert.equal(match.start, 0)
  assert.equal(match.end, PROMPT_BLOCK_START.length + prompt.length + PROMPT_BLOCK_END.length)
  assert.equal(text.slice(match.end), `\n\n${memo}`)
  assert.equal(match.data.repo, 'one2x-ai/mesh')
  assert.equal(match.data.title, '修复登录态丢失')
  assert.equal(match.data.state, 'Open')
})

test('the fallback hides the prompt tail through the requirement line', () => {
  const text = '处理 GitHub Issue：one2x-ai/mesh#2469 标题\n\n链接：x\n\n| 状态 | Open |\n\n要求：先读。\n\n用户补充的话'
  const match = GITHUB_ISSUE_RULE.match(text, 0)
  assert.ok(match !== undefined)
  assert.equal(text.slice(match.end), '\n\n用户补充的话')
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
