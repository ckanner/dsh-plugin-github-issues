/**
 * Run the offline render smoke test: bundle it with esbuild, execute it from the
 * package directory so `react-dom` resolves, then remove the temporary artifact.
 *
 *   node scripts/render-smoke.mjs
 *
 * @module dsh-plugin-github-issues/scripts/render-smoke
 */

import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outfile = join(here, '.render-smoke.cjs')

execFileSync(process.execPath, [
  '--input-type=module',
  '-e',
  `
    import { build } from 'esbuild'
    await build({
      entryPoints: [${JSON.stringify(join(here, 'render-smoke.tsx'))}],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: 'node22',
      jsx: 'automatic',
      external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
      outfile: ${JSON.stringify(outfile)},
      logLevel: 'warning',
      legalComments: 'none',
    })
  `,
], { cwd: root, stdio: 'inherit' })
try {
  execFileSync(process.execPath, [outfile], { cwd: root, stdio: 'inherit' })
} finally {
  rmSync(outfile, { force: true })
}
