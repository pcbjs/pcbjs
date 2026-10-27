// Bundles the plugin and the injector of @pcbjs/compile/scope into one CommonJS file, since tsserver loads plugins with require.
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await build({
  entryPoints: [resolve(here, 'src/index.ts')],
  outfile: resolve(here, 'dist/index.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  logLevel: 'warning',
  alias: { typescript: resolve(here, 'scripts/ts-shim.cjs') },
})
