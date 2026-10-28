/**
 * Verify what `npm publish` would actually ship.
 *
 * The build produces two halves: the Host package under `lib/`, and the browser
 * bundle `lib/client.js` that the loader mounts from the package's `./client`
 * export. This check packs the package metadata (no scripts, so the prebuilt
 * artifact is inspected, not rebuilt) and asserts the files the DSH install path
 * needs are present and that development-only inputs stay out.
 *
 *   node scripts/verify-package-contents.mjs
 *
 * @module dsh-plugin-github-issues/scripts/verify-package-contents
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url).pathname
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/** Run `npm pack --dry-run` and return the file list it would ship. */
function packedFiles() {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
  })
  const [info] = JSON.parse(output)
  assert.ok(info !== undefined, 'npm pack --json returned no entry')
  return info.files.map(entry => entry.path)
}

const files = packedFiles()
const required = [
  'lib/index.js',
  'lib/client.js',
  'lib/types/index.d.ts',
  'cordis.patch.yml',
  'locale/en.json',
  'locale/zh.json',
  'icon.svg',
  'docs/README.zh.md',
  'README.md',
  'LICENSE',
  'package.json',
]
for (const path of required) {
  assert.ok(files.includes(path), `published package is missing ${path}`)
}

const forbidden = ['src/', 'tests/', 'scripts/', 'dev-types/', 'node_modules/', 'tsconfig']
for (const prefix of forbidden) {
  assert.ok(
    files.every(path => !path.startsWith(prefix)),
    `published package must not ship ${prefix}`,
  )
}

assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml', 'package must declare dsh.bundle.patch')
assert.equal(manifest.dsh?.client?.platform, 'web', 'package must declare dsh.client.platform = web')
assert.ok(manifest.exports?.['./client'] !== undefined, 'package must export ./client for the browser half')
assert.equal(manifest.private, undefined, 'package must be publishable')

console.log(`package verified: ${String(files.length)} files, host + browser halves present`)
