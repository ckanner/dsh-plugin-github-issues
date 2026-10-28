/**
 * Preference validation and the state file: nothing untrusted may corrupt what
 * the panel reads back, and the plugin's own directory is the place it lands.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { applyPrefsPatch, PrefsStore } from '../src/github/state.ts'
import { DEFAULT_PREFS, DEFAULT_PROMPT_TEMPLATE } from '../src/vm.ts'

test('unknown filters keep the current value', () => {
  const next = applyPrefsPatch(DEFAULT_PREFS, { state: 'nope', handoffMode: 'explode', assignee: 'not a login!' })
  assert.equal(next.state, DEFAULT_PREFS.state)
  assert.equal(next.handoffMode, DEFAULT_PREFS.handoffMode)
  assert.equal(next.assignee, DEFAULT_PREFS.assignee)
})

test('known patches are applied', () => {
  const next = applyPrefsPatch(DEFAULT_PREFS, {
    state: 'all',
    assignee: 'ckanner',
    handoffMode: 'send',
    repo: 'one2x-ai/mesh',
    projectId: 'PVT_1',
    org: 'one2x-ai',
  })
  assert.equal(next.state, 'all')
  assert.equal(next.assignee, 'ckanner')
  assert.equal(next.handoffMode, 'send')
  assert.equal(next.repo, 'one2x-ai/mesh')
  assert.equal(next.projectId, 'PVT_1')
  assert.equal(next.org, 'one2x-ai')
})

test('null clears a selection (the wire form of "no value")', () => {
  const scoped = applyPrefsPatch(DEFAULT_PREFS, { org: 'one2x-ai', projectId: 'PVT_1', repo: 'one2x-ai/mesh' })
  assert.equal(scoped.org, 'one2x-ai')
  assert.equal(scoped.projectId, 'PVT_1')
  const cleared = applyPrefsPatch(scoped, { org: null, projectId: null, repo: null, pinned: null })
  assert.equal(cleared.org, undefined)
  assert.equal(cleared.projectId, undefined)
  assert.equal(cleared.repo, undefined)
  assert.equal(cleared.pinned, undefined)
})

test('the two assignee sentinels survive validation', () => {
  assert.equal(applyPrefsPatch(DEFAULT_PREFS, { assignee: '@me' }).assignee, '@me')
  assert.equal(applyPrefsPatch(DEFAULT_PREFS, { assignee: 'all' }).assignee, 'all')
})

test('an empty string clears an optional selection', () => {
  const withRepo = applyPrefsPatch(DEFAULT_PREFS, { repo: 'a/b' })
  const cleared = applyPrefsPatch(withRepo, { repo: '' })
  assert.equal(cleared.repo, undefined)
})

test('a malformed pin is ignored, a valid one is kept', () => {
  assert.equal(applyPrefsPatch(DEFAULT_PREFS, { pinned: { repo: 'nope', number: 1 } }).pinned, undefined)
  assert.equal(applyPrefsPatch(DEFAULT_PREFS, { pinned: { repo: 'a/b', number: -1 } }).pinned, undefined)
  assert.equal(applyPrefsPatch(DEFAULT_PREFS, { pinned: { repo: 'a/b', number: 1.5 } }).pinned, undefined)
  const kept = applyPrefsPatch(DEFAULT_PREFS, { pinned: { repo: 'a/b', number: 7 } })
  assert.deepEqual(kept.pinned, { repo: 'a/b', number: 7 })
  assert.equal(applyPrefsPatch(kept, { pinned: null }).pinned, undefined)
})

test('an empty template keeps the current one, an oversized one is clamped', () => {
  const custom = applyPrefsPatch(DEFAULT_PREFS, { promptTemplate: 'hello' })
  assert.equal(custom.promptTemplate, 'hello')
  assert.equal(applyPrefsPatch(custom, { promptTemplate: '' }).promptTemplate, 'hello')
  const huge = applyPrefsPatch(DEFAULT_PREFS, { promptTemplate: 'x'.repeat(9_999) })
  assert.equal(huge.promptTemplate.length, 4_000)
})

test('a fresh store answers with deployment defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-github-issues-'))
  try {
    const store = new PrefsStore(dir, 'send', '{{repo}}')
    const prefs = store.load()
    assert.equal(prefs.handoffMode, 'send')
    assert.equal(prefs.promptTemplate, '{{repo}}')
    assert.equal(prefs.assignee, DEFAULT_PREFS.assignee)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('saving creates an owner-only directory, a 0600 file, and survives reload', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'dsh-github-issues-')), 'nested')
  try {
    const store = new PrefsStore(dir, undefined, undefined)
    const saved = store.save({ state: 'closed', handoffMode: 'send', pinned: { repo: 'a/b', number: 3 } })
    assert.equal(saved.state, 'closed')
    assert.equal(saved.handoffMode, 'send')
    const file = join(dir, 'state.json')
    const mode = statSync(file).mode & 0o777
    assert.equal(mode, 0o600, `expected 0600, got ${mode.toString(8)}`)
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version: number; prefs: { state: string } }
    assert.equal(parsed.version, 2)
    assert.equal(parsed.prefs.state, 'closed')

    const reloaded = new PrefsStore(dir, undefined, undefined)
    assert.equal(reloaded.load().state, 'closed')
    assert.deepEqual(reloaded.load().pinned, { repo: 'a/b', number: 3 })
    assert.equal(reloaded.load().promptTemplate, DEFAULT_PROMPT_TEMPLATE)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a corrupt state file falls back to defaults instead of throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-github-issues-'))
  try {
    const store = new PrefsStore(dir, undefined, undefined)
    assert.equal(store.load().assignee, DEFAULT_PREFS.assignee)
    // Write junk through the store's own path, then reload from disk.
    writeFileSync(join(dir, 'state.json'), '{not json', 'utf8')
    const reloaded = new PrefsStore(dir, undefined, undefined)
    assert.equal(reloaded.load().assignee, DEFAULT_PREFS.assignee)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('issue → session links persist, dedupe, and unlink', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-github-issues-'))
  try {
    const store = new PrefsStore(dir, undefined, undefined)
    store.link('one2x-ai/mesh', 2469, 'session-a')
    store.link('one2x-ai/mesh', 2469, 'session-a')
    store.link('one2x-ai/mesh', 2469, 'session-b')
    store.link('cli/cli', 14800, 'session-a')
    const reloaded = new PrefsStore(dir, undefined, undefined)
    assert.deepEqual(
      reloaded.linksFor('one2x-ai/mesh', 2469).map(link => link.sessionId),
      ['session-a', 'session-b'],
    )
    const firstLink = reloaded.linksFor('one2x-ai/mesh', 2469)[0]
    assert.ok(firstLink !== undefined && firstLink.at > 0)

    reloaded.unlink('one2x-ai/mesh', 2469, 'session-a')
    const afterOne = new PrefsStore(dir, undefined, undefined)
    assert.deepEqual(afterOne.linksFor('one2x-ai/mesh', 2469).map(link => link.sessionId), ['session-b'])

    afterOne.unlink('one2x-ai/mesh', 2469)
    const afterAll = new PrefsStore(dir, undefined, undefined)
    assert.deepEqual(afterAll.linksFor('one2x-ai/mesh', 2469), [])
    assert.equal(afterAll.linksFor('cli/cli', 14800).length, 1, 'other issues keep their links')
    assert.equal(afterAll.load().assignee, DEFAULT_PREFS.assignee, 'prefs survive link writes')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
