// The Vite config designs are evaluated with: the drafts, the schematic scope and the source ranges before esbuild, JSX of @pcbjs/core.
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeConfig, type InlineConfig, type Plugin } from 'vite'
import { sourceRangesPlugin, transformSourceRanges } from './source-ranges.js'
import { scopePlugin } from './scope-plugin.js'
import { draftsPlugin, type DraftCodes } from './loader.js'
import type { ResolvedConfig } from './config.js'

const here = dirname(fileURLToPath(import.meta.url))
/** The @pcbjs/cli package directory, from dist or src alike. */
export const PKG_DIR = resolve(here, '..', '..')
const require = createRequire(import.meta.url)
/** The viewer, @pcbjs/viewer, wherever the package manager put it. Vite serves it from source. */
export const CLIENT_DIR = dirname(require.resolve('@pcbjs/viewer/package.json'))
/** The directory holding the @pcbjs packages: packages/ in a checkout, node_modules/@pcbjs when installed. */
const PACKAGES_DIR = dirname(CLIENT_DIR)

/** pcbjs's own code, never a design file, with a @pcbjs/ui checkout served from its source. */
export const ownCode = (uiSrc?: string): string[] => [CLIENT_DIR, PKG_DIR, PACKAGES_DIR, ...(uiSrc ? [uiSrc] : [])]

/** The project root of a design file: one root, or the scope holding the file in a workspace. */
export interface Roots {
  of: string | ((file: string) => string | null)
  /** for a design file outside every root, such as `../lib/wire.ts` */
  shared: (file: string) => string | null
}

/** The drafts in place of their files, then the schematic scope and the source ranges of each design file. */
export function designPlugins(drafts: () => DraftCodes | null | undefined, roots: Roots, own: string[]): Plugin[] {
  const limitOf = (f: string) => drafts()?.get(f)?.limit ?? null
  return [draftsPlugin(drafts), scopePlugin(roots.of, own), sourceRangesPlugin(roots.of, own, limitOf), sharedSourceRanges(roots.shared, own, limitOf)]
}

/** What every pcbjs Vite server shares: the viewer as root, the cache under .pcbjs, files read from `allow` and pcbjs's own code. */
export function baseConfig(cfg: ResolvedConfig, mode: 'dev' | 'build', plugins: Plugin[], allow: string[], own: string[]): InlineConfig {
  return {
    root: CLIENT_DIR,
    base: mode === 'build' ? cfg.base : '/',
    configFile: false,
    envFile: false,
    cacheDir: join(cfg.root, '.pcbjs', 'cache', 'vite'),
    logLevel: 'info',
    clearScreen: false,
    plugins,
    server: { fs: { allow: [...allow, ...own] } },
    esbuild: { jsx: 'automatic', jsxImportSource: '@pcbjs/core', jsxDev: mode === 'dev' },
    ssr: { noExternal: [] },
  }
}

/** The config of a compile: the design plugins alone over the project's `vite` options. */
export function compileConfig(cfg: ResolvedConfig, drafts: DraftCodes | null = null): InlineConfig {
  const own = ownCode()
  const base = baseConfig(
    cfg,
    'build',
    designPlugins(() => drafts, { of: cfg.root, shared: () => cfg.root }, own),
    [cfg.root],
    own,
  )
  return cfg.vite ? mergeConfig(base, cfg.vite) : base
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
