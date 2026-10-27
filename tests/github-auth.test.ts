/**
 * Auth tests against a fake `gh` executable, so the machine's real credential is
 * never read and no network is used.
 *
 * A tiny shell script stands in for `gh`; each test controls what it prints.
 * That pins down the parsing tolerance (array vs object hosts, comma-separated
 * vs array scopes), the host-selection rule, and the three failure codes.
 */

import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { probeGh, resolveGhPath, resolveToken } from '../src/github/auth.ts'
import { GitHubApiError } from '../src/github/types.ts'

const SKIP_WINDOWS = process.platform === 'win32'
const SKIP = SKIP_WINDOWS ? 'requires a POSIX shell for the fake gh executable' : false

/** A `gh` stand-in: array-shaped hosts and a comma-separated scope string (gh 2.95). */
const HOSTS_ARRAY = JSON.stringify({
  hosts: {
    'github.com': [{
      state: 'success',
      active: true,
      host: 'github.com',
      login: 'ckanner',
      tokenSource: 'keyring',
      scopes: 'repo, read:org',
      gitProtocol: 'ssh',
    }],
  },
})

/** A `gh` stand-in: the older object-shaped host entry and an array of scopes. */
const HOSTS_OBJECT = JSON.stringify({
  hosts: {
    'github.com': {
      state: 'success',
      active: true,
      login: 'ckanner',
      tokenSource: 'keychain',
      scopes: ['repo', 'read:org'],
    },
  },
})

/**
 * Write an executable shell script and clean it up after the test.
 * @param t - the test context that owns the cleanup.
 * @param body - the shell body, after the shebang.
 * @returns the absolute path to the executable.
 */
function fakeGh(t: TestContext, body: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-plugin-gh-'))
  const file = join(directory, 'gh')
  writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  chmodSync(file, 0o755)
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return file
}

/** A script that answers token and status requests for one fake account. */
function signedInScript(hostsJson: string): string {
  return `if [ "$1" = "auth" ] && [ "$2" = "token" ]; then
  printf '%s\\n' 'ghp_faketoken_0123456789'
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s\\n' '${hostsJson}'
  exit 0
fi
exit 1`
}

test('resolveGhPath honours an explicit path', () => {
  assert.equal(resolveGhPath('/custom/bin/gh'), '/custom/bin/gh')
  const discovered = resolveGhPath(undefined)
  assert.ok(discovered === 'gh' || discovered.endsWith('/gh'))
})

test('probeGh parses gh 2.95\'s array hosts and comma-separated scopes', { skip: SKIP }, async (t) => {
  const path = fakeGh(t, signedInScript(HOSTS_ARRAY))
  const probe = await probeGh({ host: 'github.com', ghPath: path })
  assert.equal(probe.installed, true)
  assert.equal(probe.signedIn, true)
  assert.equal(probe.login, 'ckanner')
  assert.equal(probe.host, 'github.com')
  assert.equal(probe.tokenSource, 'keyring')
  assert.deepEqual(probe.scopes, ['repo', 'read:org'])
  assert.equal(probe.path, path)
  assert.equal(probe.error, undefined)
})

test('probeGh tolerates the older object host shape and scope arrays', { skip: SKIP }, async (t) => {
  const path = fakeGh(t, signedInScript(HOSTS_OBJECT))
  const probe = await probeGh({ host: 'github.com', ghPath: path })
  assert.equal(probe.signedIn, true)
  assert.equal(probe.login, 'ckanner')
  assert.deepEqual(probe.scopes, ['repo', 'read:org'])
})

test('probeGh prefers the configured host over another active host', { skip: SKIP }, async (t) => {
  const hosts = JSON.stringify({
    hosts: {
      'github.com': [{ state: 'success', active: false, host: 'github.com', login: 'ckanner', scopes: 'repo' }],
      'ghe.example.com': [{ state: 'success', active: true, host: 'ghe.example.com', login: 'ghe-user', scopes: 'repo' }],
    },
  })
  const path = fakeGh(t, signedInScript(hosts))
  const probe = await probeGh({ host: 'github.com', ghPath: path })
  assert.equal(probe.signedIn, true)
  assert.equal(probe.login, 'ckanner')
  assert.equal(probe.host, 'github.com')
})

test('probeGh reports a signed-out host without throwing', { skip: SKIP }, async (t) => {
  const path = fakeGh(t, `if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s\\n' '{"hosts":{}}'
  exit 0
fi
exit 1`)
  const probe = await probeGh({ host: 'github.com', ghPath: path })
  assert.equal(probe.installed, true)
  assert.equal(probe.signedIn, false)
  assert.deepEqual(probe.scopes, [])
  assert.ok(probe.error?.includes('Not signed in to github.com'))
})

test('probeGh reports a missing gh executable', async (t) => {
  const probe = await probeGh({ host: 'github.com', ghPath: '/nonexistent/dsh-plugin-github-issues-gh' })
  assert.equal(probe.installed, false)
  assert.equal(probe.signedIn, false)
  assert.ok(probe.error?.includes('not installed'))
})

test('probeGh reports unusable gh output without throwing', { skip: SKIP }, async (t) => {
  const path = fakeGh(t, `if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo 'not json' >&2
  exit 1
fi
exit 1`)
  const probe = await probeGh({ host: 'github.com', ghPath: path })
  assert.equal(probe.installed, true)
  assert.equal(probe.signedIn, false)
  assert.ok(probe.error?.includes('gh auth status failed'))
})

test('resolveToken returns the trimmed token plus the probed account facts', { skip: SKIP }, async (t) => {
  const path = fakeGh(t, signedInScript(HOSTS_ARRAY))
  const auth = await resolveToken({ host: 'github.com', ghPath: path })
  assert.equal(auth.token, 'ghp_faketoken_0123456789')
  assert.equal(auth.source, 'gh')
  assert.equal(auth.host, 'github.com')
  assert.equal(auth.login, 'ckanner')
  assert.deepEqual(auth.scopes, ['repo', 'read:org'])
})

test('resolveToken classifies a signed-out gh as gh_not_signed_in', { skip: SKIP }, async (t) => {
  const path = fakeGh(t, `if [ "$1" = "auth" ] && [ "$2" = "token" ]; then
  echo 'no oauth token found for github.com' >&2
  exit 1
fi
exit 1`)
  await assert.rejects(
    resolveToken({ host: 'github.com', ghPath: path }),
    (error: unknown) => {
      assert.ok(error instanceof GitHubApiError)
      assert.equal(error.code, 'gh_not_signed_in')
      return true
    },
  )
})

test('resolveToken classifies an unexpected gh failure as gh_failed', { skip: SKIP }, async (t) => {
  const path = fakeGh(t, `if [ "$1" = "auth" ] && [ "$2" = "token" ]; then
  echo 'error: keyring is locked' >&2
  exit 1
fi
exit 1`)
  await assert.rejects(
    resolveToken({ host: 'github.com', ghPath: path }),
    (error: unknown) => {
      assert.ok(error instanceof GitHubApiError)
      assert.equal(error.code, 'gh_failed')
      assert.ok(error.message.includes('keyring is locked'))
      return true
    },
  )
})

test('resolveToken classifies a missing gh as gh_missing', async () => {
  await assert.rejects(
    resolveToken({ host: 'github.com', ghPath: '/nonexistent/dsh-plugin-github-issues-gh' }),
    (error: unknown) => {
      assert.ok(error instanceof GitHubApiError)
      assert.equal(error.code, 'gh_missing')
      return true
    },
  )
})
