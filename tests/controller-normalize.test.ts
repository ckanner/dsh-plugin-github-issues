import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeRequest } from '../src/github/list-request.ts'

test('the wire validator carries the milestone filters through', () => {
  const request = normalizeRequest({
    org: 'one2x-ai',
    repos: ['one2x-ai/mesh'],
    assignee: '@me',
    state: 'open',
    milestone: '  KAIROS 正式商用前 APPI 合规  ',
    milestoneNumber: 2,
    first: 30,
  })
  assert.equal(request.milestone, 'KAIROS 正式商用前 APPI 合规')
  assert.equal(request.milestoneNumber, 2)
  assert.deepEqual(request.repos, ['one2x-ai/mesh'])
  assert.equal(request.assignee, '@me')
})

test('the wire validator drops malformed milestone values', () => {
  const request = normalizeRequest({ repos: ['a/b'], milestone: '', milestoneNumber: -1 })
  assert.equal(request.milestone, undefined)
  assert.equal(request.milestoneNumber, undefined)
})
