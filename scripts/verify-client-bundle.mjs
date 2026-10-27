/**
 * Verify the browser bundle against the loader contract.
 *
 * What matters is whether the page can load the bundle at all and whether it
 * contributes exactly the entries it claims. So this script bundles the client,
 * evaluates the artifact with the loader facade the HTML installs, and calls
 * `apply` with a context that records what it registers and mounts.
 *
 *   node scripts/verify-client-bundle.mjs
 *
 * @module dsh-plugin-github-issues/scripts/verify-client-bundle
 */

import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const require = createRequire(import.meta.url)
const packageName = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name

/** The module-table specifiers the loader answers for this bundle. */
const EXTERNAL = ['react', 'react/jsx-runtime']

const result = await build({
  entryPoints: [join(root, 'src', 'client', 'index.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: EXTERNAL,
  write: false,
  logLevel: 'warning',
  legalComments: 'none',
})

const body = result.outputFiles[0]?.text ?? ''
/** The same wrapper the build emits. */
const bundle = `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageName)}, factory: function (require) {
  var module = { exports: {} }; var exports = module.exports;
  (function (module, exports, require) {
${body}
  })(module, exports, require);
  return module.exports;
} });`

/** The registrations the bundle made, for assertion. */
const registrations = []

/** Stand-ins for the module table, so the bundle's requires resolve. */
const table = {
  react: require('react'),
  'react/jsx-runtime': require('react/jsx-runtime'),
}

const window = {
  __ModuleLoader__: {
    mode: 'queue',
    pendingQueue: [],
    load(registration) { registrations.push(registration) },
    create() { throw new Error('the verifier does not boot the module system') },
  },
}

// The bundle is a classic script: evaluating it is exactly what the page does.
new Function('window', 'require', 'module', 'exports', bundle)(
  window,
  specifier => {
    if (!(specifier in table)) throw new Error(`bundle required an unavailable module: ${specifier}`)
    return table[specifier]
  },
  { exports: {} },
  {},
)

assert.equal(registrations.length, 1, 'the bundle must register exactly once')
const registration = registrations[0]
assert.equal(registration.id, packageName, 'the registration id must be the package name')
assert.equal(typeof registration.factory, 'function', 'the registration must carry a factory')

const exports = registration.factory(specifier => {
  if (!(specifier in table)) throw new Error(`factory required an unavailable module: ${specifier}`)
  return table[specifier]
})

assert.equal(typeof exports.apply, 'function', 'the bundle must export apply')
assert.deepEqual(exports.inject, ['slots', 'locale', 'remote'], 'the bundle must declare its services')

/** Everything the bundle registered, in order. */
const entries = []
/** Contributions the bundle mounted. */
const mounted = []
/** Cleanups the bundle owns. */
const disposers = []

/** A minimal preferences value the fake namespace returns. */
const prefs = {
  view: 'assigned',
  state: 'open',
  handoffMode: 'draft',
  promptTemplate: 'x',
}

/** A minimal namespace the store can call while the verifier runs. */
const namespace = {
  status: () => Promise.resolve({
    ok: true,
    value: {
      mode: 'gh',
      ghInstalled: true,
      signedIn: true,
      host: 'github.com',
      scopes: ['repo'],
      missingProjectScope: false,
      config: { authMode: 'gh', host: 'github.com', handoffMode: 'draft', pollSeconds: 90 },
    },
  }),
  loadPrefs: () => Promise.resolve({ ok: true, value: prefs }),
  savePrefs: () => Promise.resolve({ ok: true, value: prefs }),
  catalog: () => Promise.resolve({
    ok: true,
    value: { viewer: null, orgs: [], repos: [], projects: [], projectsBlocked: false },
  }),
  listIssues: () => Promise.resolve({
    ok: true,
    value: { items: [], pageInfo: { hasNextPage: false, endCursor: null } },
  }),
  issueDetail: () => Promise.resolve({ ok: false, error: { code: 'not_found', message: 'not in this fixture' } }),
  refresh: () => Promise.resolve({ ok: true, value: { ok: true } }),
}

const ctx = {
  remote: {
    $mount(contribution) {
      mounted.push(contribution)
      return Promise.resolve(() => Promise.resolve())
    },
  },
  get(name) {
    return name === 'remote.githubIssues' ? namespace : undefined
  },
  slots: {
    inject(name, register) {
      register()
      return () => {}
    },
    register(options) {
      entries.push(options)
      return () => {}
    },
  },
  locale: {
    register() { return () => {} },
    bind() { return (key) => key },
  },
  effect(callback) {
    const dispose = callback()
    disposers.push(dispose)
  },
  layout: { selectPanel() {} },
}

exports.apply(ctx)

// The store's bootstrap is asynchronous; give it a turn before asserting.
await new Promise(resolve => { setTimeout(resolve, 80) })

assert.deepEqual(
  entries.map(entry => `${entry.name}:${entry.key ?? entry.id ?? ''}`),
  [
    'main:github',
    'sidebar.panellist:github',
    'conversation.input.dock:github-issues-handoff',
    'settings.section:github-issues',
  ],
  'the bundle must contribute the panel page, rail icon, handoff strip, and settings section',
)

assert.equal(mounted.length, 1, 'the bundle must mount exactly one Remote contribution')
assert.equal(mounted[0].package, packageName)
assert.deepEqual(
  mounted[0].descriptors.map(descriptor => `${descriptor.namespace}/${descriptor.method}`),
  [
    'githubIssues/status',
    'githubIssues/catalog',
    'githubIssues/listIssues',
    'githubIssues/issueDetail',
    'githubIssues/loadPrefs',
    'githubIssues/savePrefs',
    'githubIssues/refresh',
  ],
  'every method the browser calls must be mounted, or the call fails at the click',
)

// Clean up the store's poll timer so the verifier exits.
for (const dispose of disposers) dispose()
console.log(
  `client bundle verified: ${registration.id} registers ${String(entries.length)} slot entries`
  + ` and mounts ${String(mounted[0].descriptors.length)} Remote methods`,
)
