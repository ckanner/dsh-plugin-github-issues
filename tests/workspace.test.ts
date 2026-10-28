import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveHandoffWorkspace, type WorkspaceCandidate } from '../src/workspace.ts'

/** Three Workspaces in display order, with one linked Session each. */
const workspaces: WorkspaceCandidate[] = [
  { workspaceId: 'ws-oho', path: '/Users/ronan/Documents/projects/dsh-oho', sessionIds: ['s-main'] },
  { workspaceId: 'ws-mesh', path: '/Users/ronan/Documents/projects/mesh', sessionIds: ['s-mesh'] },
  { workspaceId: 'ws-alert', path: '/Users/ronan/Documents/projects/meclaw-alert', sessionIds: ['s-alert'] },
]

test('the source Session workspace wins', () => {
  assert.equal(
    resolveHandoffWorkspace({
      repo: 'one2x-ai/mesh',
      currentSessionId: 's-alert',
      linkedSessionIds: ['s-mesh'],
      workspaces,
    }),
    'ws-alert',
  )
})

test('a Session already linked to the repository picks its workspace', () => {
  assert.equal(
    resolveHandoffWorkspace({
      repo: 'one2x-ai/mesh',
      currentSessionId: 's-unknown',
      linkedSessionIds: ['s-mesh'],
      workspaces,
    }),
    'ws-mesh',
  )
})

test('a workspace directory matching the repository name is used', () => {
  assert.equal(resolveHandoffWorkspace({ repo: 'one2x-ai/mesh', workspaces }), 'ws-mesh')
  assert.equal(resolveHandoffWorkspace({ repo: 'one2x-ai/Mesh', workspaces }), 'ws-mesh')
})

test('a workspace title without a path also matches the repository name', () => {
  const titled: WorkspaceCandidate[] = [
    { workspaceId: 'ws-titled', title: 'mesh', sessionIds: [] },
    { workspaceId: 'ws-other', title: 'meclaw-apps', sessionIds: [] },
  ]
  assert.equal(resolveHandoffWorkspace({ repo: 'one2x-ai/mesh', workspaces: titled }), 'ws-titled')
})

test('no rule matches, so the Host chooses the current workspace', () => {
  assert.equal(
    resolveHandoffWorkspace({ repo: 'one2x-ai/unknown-repo', currentSessionId: 's-gone', workspaces }),
    undefined,
  )
})

test('an archived linked Session does not block the directory rule', () => {
  assert.equal(
    resolveHandoffWorkspace({ repo: 'one2x-ai/mesh', linkedSessionIds: ['s-gone'], workspaces }),
    'ws-mesh',
  )
})

test('an empty catalog falls through to the Host default', () => {
  assert.equal(resolveHandoffWorkspace({ repo: 'one2x-ai/mesh', workspaces: [] }), undefined)
})
