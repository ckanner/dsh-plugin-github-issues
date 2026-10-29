import assert from 'node:assert/strict'
import test from 'node:test'

import { buildRepoIssuesQuery, searchStringForFilters } from '../src/github/queries.ts'

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

test('the repo issues connection filters by milestone only when asked', () => {
  const plain = buildRepoIssuesQuery({ owner: 'one2x-ai', name: 'mesh', states: ['OPEN'], first: 30, after: null })
  assert.ok(!plain.query.includes('filterBy'))
  assert.deepEqual(Object.keys(plain.variables).sort(), ['after', 'first', 'name', 'owner', 'states'])

  const filtered = buildRepoIssuesQuery({
    owner: 'one2x-ai',
    name: 'mesh',
    states: ['OPEN'],
    first: 30,
    after: null,
    milestone: 'v2.1',
  })
  assert.ok(filtered.query.includes('filterBy: { milestone: $milestone }'))
  assert.equal(filtered.variables.milestone, 'v2.1')
})
