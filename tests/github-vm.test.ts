/**
 * Mapper unit tests, driven by the trimmed live JSON from the research notes.
 *
 * Nothing here touches the network: every fixture is a snapshot of a real
 * GraphQL answer, so the precedence rules (project field, org issue field,
 * label), the check glyph inputs, and the excerpt layout are pinned down.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  bodyExcerpt, checkStateOf, failingChecksOf, pickPriority, priorityFromIssueFields,
  priorityFromLabels, priorityFromProjectValue, toAssigneeVMs, toIssueCardVM, toIssueDetailVM,
  toLabelVMs, toLinkedPRVM, toMilestoneVM, toProjectItemCardVM,
} from '../src/github/vm.ts'
import type {
  RawIssue, RawIssueFieldValues, RawLabel, RawProjectItem, RawTimelineItem,
} from '../src/github/vm.ts'

/** A linked pull request as GitHub reports it on an issue (`mesh#2469` shape). */
const LINKED_PR = {
  number: 2527,
  title: 'Fix panel flicker on remesh',
  url: 'https://github.com/one2x-ai/mesh/pull/2527',
  state: 'MERGED',
  isDraft: false,
  merged: true,
  reviewDecision: null,
  updatedAt: '2026-10-27T11:00:00Z',
  author: { login: 'ckanner' },
  statusCheckRollup: {
    state: 'FAILURE',
    contexts: {
      nodes: [
        { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'FAILURE' },
        { __typename: 'StatusContext', context: 'ci/legacy', state: 'ERROR' },
        { __typename: 'CheckRun', name: 'deploy', status: 'COMPLETED', conclusion: 'SKIPPED' },
      ],
    },
  },
}

/** An open issue card node, modelled on `one2x-ai/mesh#2469`. */
const ISSUE: RawIssue = {
  __typename: 'Issue',
  id: 'I_kwDOtest2469',
  number: 2469,
  title: 'Panel flickers when mesh scale changes',
  url: 'https://github.com/one2x-ai/mesh/issues/2469',
  state: 'OPEN',
  stateReason: null,
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-27T12:50:56Z',
  issueType: { name: 'Bug', color: 'RED' },
  repository: { nameWithOwner: 'one2x-ai/mesh', isPrivate: true },
  labels: {
    nodes: [
      { name: 'source/dev', color: '1d76db' },
      { name: 'P2', color: 'fbca04' },
    ],
  },
  milestone: { title: 'M5 mesh scale', dueOn: '2026-11-02', state: 'OPEN', progressPercentage: 82.6 },
  assignees: { nodes: [{ login: 'ckanner', avatarUrl: 'https://avatars.githubusercontent.com/u/1?s=32&v=4' }] },
  comments: { totalCount: 8 },
  body: '## Summary\n\nWhen the panel [remeshes](https://example.com), it **flickers**.\n\n```ts\nconst x = 1\n```\n',
  closedByPullRequestsReferences: { nodes: [LINKED_PR] },
  issueFieldValues: { nodes: [] },
}

/** `issueFieldValues` with the org-level Priority field set to High. */
const ISSUE_FIELD_VALUES: RawIssueFieldValues = {
  nodes: [
    {
      __typename: 'IssueFieldSingleSelectValue',
      name: 'High',
      color: 'RED',
      field: { name: 'Priority' },
    },
  ],
}

test('toIssueCardVM maps the live card shape', () => {
  const card = toIssueCardVM(ISSUE)
  assert.equal(card.id, 'I_kwDOtest2469')
  assert.equal(card.repo, 'one2x-ai/mesh')
  assert.equal(card.number, 2469)
  assert.equal(card.state, 'OPEN')
  assert.equal(card.stateReason, null)
  assert.equal(card.isPrivate, true)
  assert.deepEqual(card.issueType, { name: 'Bug', color: 'RED' })
  assert.deepEqual(card.labels, [
    { name: 'source/dev', color: '1d76db' },
    { name: 'P2', color: 'fbca04' },
  ])
  assert.deepEqual(card.milestone, {
    title: 'M5 mesh scale',
    dueOn: '2026-11-02',
    state: 'OPEN',
    progress: 82.6,
  })
  assert.deepEqual(card.assignees, [
    { login: 'ckanner', avatarUrl: 'https://avatars.githubusercontent.com/u/1?s=32&v=4' },
  ])
  assert.equal(card.updatedAt, '2026-10-27T12:50:56Z')
  assert.equal(card.commentCount, 8)
  assert.equal(card.linkedPRs.length, 1)
  const [pullRequest] = card.linkedPRs
  assert.ok(pullRequest !== undefined)
  assert.equal(pullRequest.number, 2527)
  assert.equal(pullRequest.state, 'MERGED')
  assert.equal(pullRequest.merged, true)
  assert.equal(pullRequest.reviewDecision, null)
  assert.equal(pullRequest.checks, 'FAILURE')
  assert.deepEqual(pullRequest.failingChecks, ['build', 'ci/legacy'])
  assert.equal(pullRequest.author, 'ckanner')
  // The excerpt drops the heading and the link target, and stays one line.
  assert.ok(card.bodyExcerpt !== undefined)
  assert.ok(!card.bodyExcerpt.includes('##'))
  assert.ok(!card.bodyExcerpt.includes(']('))
  assert.ok(!card.bodyExcerpt.includes('\n'))
})

test('priority precedence is project, then issue field, then label', () => {
  // Label only.
  assert.deepEqual(ISSUE.labels?.nodes === undefined ? undefined : toIssueCardVM(ISSUE).priority, {
    source: 'label',
    name: 'P2',
    color: 'fbca04',
  })

  // Org Issue Field outranks the label.
  const withField = toIssueCardVM({ ...ISSUE, issueFieldValues: ISSUE_FIELD_VALUES })
  assert.deepEqual(withField.priority, { source: 'issue-field', name: 'High', color: 'RED' })

  // A project item's selected value outranks both.
  const withProject = toIssueCardVM(
    { ...ISSUE, issueFieldValues: ISSUE_FIELD_VALUES },
    { projectPriority: { source: 'project', name: 'Urgent', color: 'PINK' } },
  )
  assert.deepEqual(withProject.priority, { source: 'project', name: 'Urgent', color: 'PINK' })

  // No source at all: the optional field is absent rather than `undefined`.
  const unprioritised = toIssueCardVM({ ...ISSUE, labels: { nodes: [] }, issueFieldValues: { nodes: [] } })
  assert.equal(Object.hasOwn(unprioritised, 'priority'), false)
})

test('priority helpers read each source defensively', () => {
  assert.deepEqual(priorityFromProjectValue({
    __typename: 'ProjectV2ItemFieldSingleSelectValue',
    name: 'Medium',
    color: 'YELLOW',
  }), { source: 'project', name: 'Medium', color: 'YELLOW' })
  assert.deepEqual(priorityFromProjectValue({
    __typename: 'ProjectV2ItemFieldTextValue',
    text: 'P0-ish',
  }), { source: 'project', name: 'P0-ish' })
  assert.deepEqual(priorityFromProjectValue({
    __typename: 'ProjectV2ItemFieldNumberValue',
    number: 3,
  }), { source: 'project', name: '3' })
  assert.equal(priorityFromProjectValue(null), undefined)
  assert.equal(priorityFromProjectValue({ __typename: 'ProjectV2ItemFieldDateValue', date: '2026-01-01' }), undefined)

  assert.deepEqual(priorityFromIssueFields(ISSUE_FIELD_VALUES), {
    source: 'issue-field',
    name: 'High',
    color: 'RED',
  })
  assert.equal(priorityFromIssueFields({ nodes: [{ __typename: 'IssueFieldTextValue', name: 'ignored' }] }), undefined)
  assert.equal(priorityFromIssueFields(null), undefined)

  const labels: RawLabel[] = [
    { name: 'p3', color: 'aaaaaa' },
    { name: 'P1', color: 'bbbbbb' },
    { name: 'P9', color: 'cccccc' },
  ]
  // Lowest number wins, case-insensitively, and P9 is not a priority.
  assert.deepEqual(priorityFromLabels(labels), { source: 'label', name: 'P1', color: 'bbbbbb' })
  assert.equal(priorityFromLabels([{ name: 'priority/high' }]), undefined)

  assert.deepEqual(
    pickPriority({ source: 'project', name: 'Urgent' }, { source: 'issue-field', name: 'High' }),
    { source: 'project', name: 'Urgent' },
  )
  assert.deepEqual(
    pickPriority(undefined, { source: 'issue-field', name: 'High' }),
    { source: 'issue-field', name: 'High' },
  )
})

test('toIssueDetailVM maps cross-referenced PRs and excludes closing PRs', () => {
  const timeline: RawTimelineItem[] = [
    {
      __typename: 'CrossReferencedEvent',
      source: {
        __typename: 'PullRequest',
        number: 2485,
        title: 'Part one',
        url: 'https://github.com/one2x-ai/mesh/pull/2485',
        state: 'MERGED',
        isDraft: false,
        merged: true,
        reviewDecision: 'APPROVED',
        statusCheckRollup: { state: 'SUCCESS', contexts: { nodes: [] } },
        author: { login: 'ckanner' },
      },
    },
    { __typename: 'CrossReferencedEvent', source: { __typename: 'Issue' } },
    { __typename: 'CrossReferencedEvent', source: { __typename: 'PullRequest', number: 2527 } },
    { __typename: 'CrossReferencedEvent', source: { __typename: 'PullRequest', number: 2485 } },
    { __typename: 'ReferencedEvent' },
  ]
  const detail = toIssueDetailVM(ISSUE, timeline)
  assert.equal(detail.body, ISSUE.body)
  // 2527 is the closing PR already on the card; 2485 appears once.
  assert.equal(detail.mentionedPRs.length, 1)
  assert.equal(detail.mentionedPRs[0]?.number, 2485)
  assert.equal(detail.mentionedPRs[0]?.checks, 'SUCCESS')
  assert.equal(detail.mentionedPRs[0]?.reviewDecision, 'APPROVED')
  // The detail still carries the card fields, including the closing PR.
  assert.equal(detail.linkedPRs.length, 1)
})

test('check helpers map rollup state and failing names', () => {
  assert.equal(checkStateOf(null), null)
  assert.equal(checkStateOf(undefined), null)
  assert.equal(checkStateOf({ state: 'SUCCESS' }), 'SUCCESS')
  assert.equal(checkStateOf({ state: 'PENDING' }), 'PENDING')
  assert.equal(checkStateOf({ state: 'WEIRD' }), null)
  assert.deepEqual(failingChecksOf({ state: 'FAILURE', contexts: { nodes: [
    { __typename: 'CheckRun', name: 'a', conclusion: 'FAILURE' },
    { __typename: 'CheckRun', name: 'b', conclusion: 'TIMED_OUT' },
    { __typename: 'CheckRun', name: 'c', conclusion: 'CANCELLED' },
    { __typename: 'CheckRun', name: 'd', conclusion: 'ACTION_REQUIRED' },
    { __typename: 'CheckRun', name: 'e', conclusion: 'NEUTRAL' },
    { __typename: 'StatusContext', context: 'f', state: 'FAILURE' },
    { __typename: 'StatusContext', context: 'g', state: 'ERROR' },
    { __typename: 'CheckRun', name: 'h', conclusion: 'FAILURE' },
  ] } }), ['a', 'b', 'c', 'd', 'f'])
  assert.deepEqual(failingChecksOf({ state: 'PENDING', contexts: { nodes: [
    { __typename: 'CheckRun', name: 'still-running', status: 'IN_PROGRESS', conclusion: null },
  ] } }), [])
})

test('toLinkedPRVM omits failingChecks when nothing failed', () => {
  const pullRequest = toLinkedPRVM({
    number: 2527,
    title: 'Fix panel flicker',
    url: 'https://github.com/one2x-ai/mesh/pull/2527',
    state: 'MERGED',
    isDraft: false,
    merged: true,
    reviewDecision: 'APPROVED',
    author: { login: 'ckanner' },
    statusCheckRollup: { state: 'SUCCESS', contexts: { nodes: [] } },
  })
  assert.equal(pullRequest.state, 'MERGED')
  assert.equal(pullRequest.checks, 'SUCCESS')
  assert.equal(Object.hasOwn(pullRequest, 'failingChecks'), false)
  assert.equal(pullRequest.isDraft, false)
  assert.equal(pullRequest.author, 'ckanner')
})

test('bodyExcerpt strips markdown and truncates', () => {
  assert.equal(bodyExcerpt(''), undefined)
  assert.equal(bodyExcerpt('   \n\t '), undefined)
  const excerpt = bodyExcerpt('### Title\n\nSee [the docs](https://example.com/a) for `details`.', 200)
  assert.equal(excerpt, 'Title See the docs for details.')
  const long = bodyExcerpt('word '.repeat(100), 40)
  assert.ok(long !== undefined)
  assert.equal(long.length, 40)
  assert.ok(long.endsWith('…'))
  const untruncated = bodyExcerpt('short', 40)
  assert.equal(untruncated, 'short')
})

test('milestone, label, and assignee mappers drop malformed nodes', () => {
  assert.equal(toMilestoneVM(null), undefined)
  assert.equal(toMilestoneVM({ title: '' }), undefined)
  assert.deepEqual(toMilestoneVM({ title: 'M5', dueOn: null, state: 'CLOSED', progressPercentage: null }), {
    title: 'M5',
    dueOn: null,
    state: 'CLOSED',
    progress: null,
  })
  const openMilestone = toMilestoneVM({ title: 'M5' })
  assert.ok(openMilestone !== undefined)
  assert.equal(openMilestone.state, 'OPEN')

  assert.deepEqual(toLabelVMs([{ name: 'P2', color: 'fbca04' }, { name: null }, null]), [
    { name: 'P2', color: 'fbca04' },
  ])
  assert.deepEqual(toLabelVMs(undefined), [])
  assert.deepEqual(toLabelVMs([{ name: 'P2' }]), [{ name: 'P2', color: '' }])

  assert.deepEqual(toAssigneeVMs([
    { login: 'ckanner', avatarUrl: 'https://avatars.githubusercontent.com/u/1?s=32&v=4' },
    { login: null },
    null,
  ]), [{ login: 'ckanner', avatarUrl: 'https://avatars.githubusercontent.com/u/1?s=32&v=4' }])
  assert.deepEqual(toAssigneeVMs([{ login: 'ckanner' }]), [{ login: 'ckanner' }])
  assert.deepEqual(toAssigneeVMs(undefined), [])
})

test('toProjectItemCardVM maps issues, PRs, and skips drafts', () => {
  const issueItem: RawProjectItem = {
    id: 'PVTI_issue',
    type: 'ISSUE',
    priority: { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'Urgent', color: 'PINK' },
    content: { ...ISSUE, repository: { nameWithOwner: 'one2x-ai/mesh', isPrivate: true } },
  }
  const issueCard = toProjectItemCardVM(issueItem)
  assert.ok(issueCard !== undefined)
  assert.equal(issueCard.number, 2469)
  assert.deepEqual(issueCard.priority, { source: 'project', name: 'Urgent', color: 'PINK' })

  const pullRequestItem: RawProjectItem = {
    id: 'PVTI_pr',
    type: 'PULL_REQUEST',
    content: {
      __typename: 'PullRequest',
      id: 'PR_kwDOtest',
      number: 2527,
      title: 'Fix panel flicker',
      url: 'https://github.com/one2x-ai/mesh/pull/2527',
      state: 'MERGED',
      isDraft: false,
      merged: true,
      updatedAt: '2026-10-27T11:00:00Z',
      repository: { nameWithOwner: 'one2x-ai/mesh', isPrivate: true },
      labels: { nodes: [] },
      comments: { totalCount: 2 },
      body: 'Fixes the flicker.',
    },
  }
  const pullRequestCard = toProjectItemCardVM(pullRequestItem)
  assert.ok(pullRequestCard !== undefined)
  // A merged pull request renders as a closed issue-like card.
  assert.equal(pullRequestCard.state, 'CLOSED')
  assert.equal(pullRequestCard.number, 2527)
  assert.equal(pullRequestCard.repo, 'one2x-ai/mesh')
  assert.equal(pullRequestCard.commentCount, 2)

  assert.equal(toProjectItemCardVM({
    id: 'PVTI_draft',
    type: 'DRAFT_ISSUE',
    content: { __typename: 'DraftIssue', id: 'DI_1', title: 'Draft', body: '' },
  }), undefined)
  assert.equal(toProjectItemCardVM({ id: 'PVTI_empty', content: null }), undefined)
  assert.equal(toProjectItemCardVM(null), undefined)
})
