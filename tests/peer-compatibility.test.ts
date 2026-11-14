import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const semver = require('semver') as { satisfies(v: string, range: string): boolean }
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
test('host library peers accept real DSH dependency tuples without borrowing the host version', () => {
  for (const [name, supported, rejected] of [
    ['@deepseek-ai/cordis', ['4.0.5', '4.0.9', '4.1.0'], ['0.2.2', '4.2.0', '5.0.0']],
    ['@deepseek-ai/schemastery', ['3.19.0', '3.19.2'], ['0.2.2', '3.20.0', '4.0.0']],
    ['@deepseek-ai/dsh-typert-protocol', ['0.2.1-rc.5', '0.2.2-rc.3', '0.2.2-rc.99'], ['0.2.1-rc.4', '0.3.0', '1.0.0']],
  ] as const) {
    for (const version of supported) assert.equal(semver.satisfies(version, manifest.peerDependencies[name]), true, `${name}@${version}`)
    for (const version of rejected) assert.equal(semver.satisfies(version, manifest.peerDependencies[name]), false, `${name}@${version}`)
    assert.equal(manifest.peerDependenciesMeta[name].optional, true)
  }
})
