import assert from 'node:assert/strict'
import test from 'node:test'

import { buildLinkedCardsQuery, buildRepoIssuesQuery, searchStringForFilters } from '../src/github/queries.ts'

test('the cascade search gains a quoted milestone qualifier', () => {
  const search = searchStringForFilters({
    org: 'one2x-ai',
    repos: ['one2x-ai/mesh'],
    assignee: '@me',
    state: 'open',
    milestone: 'KAIROS 正式商用前 APPI 合规',
  })
  assert.ok(search.includes('milestone:"KAIROS 正式商用前 APPI 合规"'))
  assert.ok(search.includes('org:one2x-ai'))
  assert.ok(search.includes('assignee:@me'))
})

test('milestone quotes and backslashes are escaped', () => {
  const search = searchStringForFilters({ repos: [], assignee: 'all', state: 'open', milestone: 'a"b\\c' })
  assert.ok(search.includes('milestone:"a\\"b\\\\c"'))
})

test('the repo issues connection carries assignee and milestone filters', () => {
  const plain = buildRepoIssuesQuery({ owner: 'one2x-ai', name: 'mesh', states: ['OPEN'], first: 30, after: null })
  assert.ok(!plain.query.includes('filterBy'))
  assert.deepEqual(Object.keys(plain.variables).sort(), ['after', 'first', 'name', 'owner', 'states'])

  const filtered = buildRepoIssuesQuery({
    owner: 'one2x-ai',
    name: 'mesh',
    states: ['OPEN'],
    first: 30,
    after: null,
    assignee: 'ckanner',
    milestone: 'v2.1',
  })
  assert.ok(filtered.query.includes('filterBy: { assignee: $assignee, milestoneNumber: $milestone }'))
  assert.equal(filtered.variables.assignee, 'ckanner')
  assert.equal(filtered.variables.milestone, 'v2.1')
})

test('the linked-card refresh aliases each issue and skips the body fragment', () => {
  const query = buildLinkedCardsQuery('one2x-ai', 'mesh', [2469, 2530])
  assert.ok(query.query.includes('i0: issue(number: 2469)'))
  assert.ok(query.query.includes('i1: issue(number: 2530)'))
  assert.ok(query.query.includes('fragment LinkedIssueCardFields'))
  assert.ok(!query.query.includes('body\n'))
  assert.deepEqual(query.variables, { owner: 'one2x-ai', name: 'mesh' })
})

test('a milestone-only repo page does not declare an unused assignee variable', () => {
  const page = buildRepoIssuesQuery({
    owner: 'one2x-ai',
    name: 'mesh',
    states: ['OPEN', 'CLOSED'],
    first: 30,
    after: 'cursor',
    milestone: 'v2.1',
  })
  assert.ok(page.query.includes('filterBy: { milestoneNumber: $milestone }'))
  assert.ok(!page.query.includes('$assignee'))
  assert.equal(page.variables.milestone, 'v2.1')
})
