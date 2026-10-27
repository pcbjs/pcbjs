import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { InlineConfig, Plugin } from 'vite'
import { mergeConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { pcbjsPlugin, type PluginState } from './plugin.js'
import { sourceRangesPlugin, transformSourceRanges } from './source-ranges.js'
import { scopePlugin } from './scope-plugin.js'
import { modelsPlugin } from './models.js'
import { draftsPlugin } from './drafts.js'
import type { ResolvedConfig } from './config.js'
import type { Workspace } from './scope-state.js'
import { scopeOf } from './scopes.js'

const here = dirname(fileURLToPath(import.meta.url))
/** The @pcbjs/cli package directory, from dist or src alike. */
export const PKG_DIR = resolve(here, '..')
const require = createRequire(import.meta.url)
/** The viewer, @pcbjs/viewer, wherever the package manager put it. Vite serves it from source. */
export const CLIENT_DIR = dirname(require.resolve('@pcbjs/viewer/package.json'))
/** The directory holding the @pcbjs packages: packages/ in a checkout, node_modules/@pcbjs when installed. */
const PACKAGES_DIR = dirname(CLIENT_DIR)

/** three and every addon the client imports, pre-bundled up front so the first 3D view does not re-optimise and reload the page */
const THREE_DEPS = [
  'three',
  'three/addons/controls/OrbitControls.js',
  'three/addons/environments/RoomEnvironment.js',
  'three/addons/geometries/RoundedBoxGeometry.js',
  'three/addons/utils/BufferGeometryUtils.js',
]

/** The Vite config of a project; with `ws`, of a workspace server, where `cfg` is the displayed scope and project `vite` options do not apply. */
export function viteConfig(cfg: ResolvedConfig, state: PluginState, mode: 'dev' | 'build', ws?: Workspace): InlineConfig {
  const limitOf = (f: string) => state.drafts?.get(f)?.limit ?? null
  const base: InlineConfig = {
    root: CLIENT_DIR,
    base: mode === 'build' ? cfg.base : '/',
    configFile: false,
    envFile: false,
    cacheDir: join(cfg.root, '.pcbjs', 'cache'),
    logLevel: 'info',
    clearScreen: false,
    plugins: [draftsPlugin(() => state.drafts), scopePlugin(ws ? (f => scopeOf(ws.scopes, f)?.dir ?? null) : cfg.root, [CLIENT_DIR, PKG_DIR, PACKAGES_DIR]), sourceRangesPlugin(ws ? (f => scopeOf(ws.scopes, f)?.dir ?? null) : cfg.root, [CLIENT_DIR, PKG_DIR, PACKAGES_DIR], limitOf), sharedSourceRanges(ws ? (f => scopeOf(ws.scopes, f)?.dir ?? ws.displayed?.dir ?? null) : () => cfg.root, [CLIENT_DIR, PKG_DIR, PACKAGES_DIR], limitOf), vue(), modelsPlugin(cfg, state, mode), pcbjsPlugin(cfg, CLIENT_DIR, state, mode, ws)],
    resolve: { alias: { vue: dirname(require.resolve('vue/package.json')) } },
    server: { fs: { allow: [...(ws ? ws.folders : [cfg.root]), PKG_DIR, PACKAGES_DIR] } },
    optimizeDeps: { entries: [join(CLIENT_DIR, 'index.html')], include: ['vue', ...THREE_DEPS] },
    esbuild: { jsx: 'automatic', jsxImportSource: '@pcbjs/core', jsxDev: mode === 'dev' },
    ssr: { noExternal: [] },
    // the 3D view is one large chunk on purpose; Vite's advisory about it is noise on every build
    build: { outDir: cfg.outDir, emptyOutDir: true, chunkSizeWarningLimit: 4096 },
  }
  return cfg.vite && !ws ? mergeConfig(base, cfg.vite) : base
}

// source ranges for design files outside the root, such as `../lib/wire.ts`; the files under it are sourceRangesPlugin's
function sharedSourceRanges(rootOf: (file: string) => string | null, exclude: string[], limitOf: (file: string) => number | null): Plugin {
  const under = (file: string, dir: string) => file === dir || file.startsWith(dir.endsWith(sep) ? dir : dir + sep)
  return {
    name: 'pcbjs:shared-source-ranges',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0]
      if (file.startsWith('\0') || !/\.tsx?$/.test(file) || file.endsWith('.d.ts') || file.includes(`${sep}node_modules${sep}`) || file.includes(`${sep}.pcbjs${sep}`)) return null
      if (exclude.some(d => under(file, d))) return null
      const root = rootOf(file)
      if (!root || under(file, root)) return null
      const rel = relative(root, file)
      if (isAbsolute(rel) || !rel.startsWith('..')) return null
      return transformSourceRanges(code, id, rel.split(sep).join('/'), limitOf(file))
    },
  }
}
