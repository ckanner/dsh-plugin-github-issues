/**
 * Verify what `npm publish` would actually ship.
 *
 * The build produces two halves: the Host package under `lib/`, and the browser
 * bundle `lib/client.js` that the loader mounts from the package's `./client`
 * export. This check packs the package to a temporary directory (scripts are
 * disabled, so the prebuilt artifact is inspected, not rebuilt), then reads the
 * tarball's own file list. A tarball is inspected instead of `npm pack --json`
 * because some npm versions still run lifecycle scripts on a dry run and their
 * stdout makes the JSON unparsable.
 *
 *   node scripts/verify-package-contents.mjs
 *
 * @module dsh-plugin-github-issues/scripts/verify-package-contents
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url).pathname
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/** Pack the package into a temporary directory and return the tarball's files. */
function packedFiles() {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-plugin-github-issues-pack-'))
  try {
    const packed = execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', directory], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, npm_config_ignore_scripts: 'true' },
    })
    const tarball = join(directory, packed.trim().split('\n').pop() ?? '')
    const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    return listing
      .split('\n')
      .map(path => path.trim())
      .filter(path => path !== '' && !path.endsWith('/'))
      .map(path => path.replace(/^package\//, ''))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
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
  'assets/panel.png',
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
