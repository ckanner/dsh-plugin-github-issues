import assert from 'node:assert/strict'
import test from 'node:test'

import { GITHUB_ISSUE_RULE } from '../src/client/reference.ts'

test('the sent-text rule finds owner/repo#number and builds the issue URL', () => {
  const text = '处理 GitHub Issue：one2x-ai/mesh#2469 修复登录态丢失\n链接：https://github.com/one2x-ai/mesh/issues/2469'
  const match = GITHUB_ISSUE_RULE.match(text, 0)
  assert.ok(match !== undefined)
  assert.equal(text.slice(match.start, match.end), 'one2x-ai/mesh#2469')
  assert.deepEqual(match.data, {
    repo: 'one2x-ai/mesh',
    number: 2469,
    url: 'https://github.com/one2x-ai/mesh/issues/2469',
  })
  // The URL itself is not matched a second time.
  assert.equal(GITHUB_ISSUE_RULE.match(text, match.end + 1), undefined)
})

test('the rule ignores malformed numbers and requires a slash', () => {
  assert.equal(GITHUB_ISSUE_RULE.match('one2x-ai/mesh#0', 0), undefined)
  assert.equal(GITHUB_ISSUE_RULE.match('one2x-ai#2469', 0), undefined)
  assert.equal(GITHUB_ISSUE_RULE.match('https://github.com/one2x-ai/mesh/issues/2469', 0), undefined)
})
