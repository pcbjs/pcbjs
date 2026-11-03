// The Vite config of a built site and of the session's dev server: the design plugins of project/vite-base.ts, the viewer and its boards.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import type { InlineConfig, Plugin } from 'vite'
import { mergeConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { baseConfig, CLIENT_DIR, designPlugins, ownCode, type Roots } from '../project/vite-base.js'
import type { ResolvedConfig } from '../project/config.js'
import { sitePlugin, type PluginState } from './site.js'
import { modelsPlugin } from './models-plugin.js'
import { linkedDepsPlugin, withDeps } from './linked-deps.js'

const require = createRequire(import.meta.url)
/** @pcbjs/ui, prebuilt: the viewer's components, prebundled in dev so no library component compiles there. */
const UI_DIR = dirname(require.resolve('@pcbjs/ui/package.json'))

/** The @pcbjs/ui folder `--ui-src` serves from its source: the one given, else the installed package, which ships dist only outside a checkout. */
export function uiSource(dir: string | null): string {
  const at = dir ? resolve(dir) : UI_DIR
  if (!existsSync(join(at, 'src', 'index.ts'))) throw new Error(`--ui-src needs a pcbjs checkout: ${at} has no src/index.ts`)
  return at
}

/** @pcbjs/ui and its per-view entries, prebundled together so they share their chunks */
const UI_ENTRIES = ['@pcbjs/ui', '@pcbjs/ui/view2d', '@pcbjs/ui/view3d', '@pcbjs/ui/sch', '@pcbjs/ui/checks', '@pcbjs/ui/panels']

/** three and every addon the client imports, pre-bundled up front so the first 3D view does not re-optimise and reload the page */
const THREE_DEPS = [
  'three',
  'three/addons/controls/OrbitControls.js',
  'three/addons/environments/RoomEnvironment.js',
  'three/addons/geometries/RoundedBoxGeometry.js',
  'three/addons/utils/BufferGeometryUtils.js',
]

/** The Vite config of a built site; `inline` false for a prerendered site, whose pages carry the boards. */
export function viteConfig(cfg: ResolvedConfig, state: PluginState, inline = true): InlineConfig {
  return configOf(cfg, state, 'build', null, sitePlugin(state, inline))
}

/** The folders a dev server serves and the project of each design file in them. */
export interface Served extends Roots {
  folders: string[]
}

/** A site's config, or with `served` the session's dev server, where project `vite` options do not apply; `boards` serves the board module. */
export function configOf(cfg: ResolvedConfig, state: PluginState, mode: 'dev' | 'build', served: Served | null, boards: Plugin): InlineConfig {
  const own = ownCode(state.uiSrc)
  const ui = state.uiSrc
    ? [
        { find: /^@pcbjs\/ui$/, replacement: join(state.uiSrc, 'src', 'index.ts') },
        { find: /^@pcbjs\/ui\/(view2d|view3d|sch|checks|panels)$/, replacement: join(state.uiSrc, 'src', 'entries', '$1.ts') },
        { find: /^@pcbjs\/ui\/style\.css$/, replacement: join(state.uiSrc, 'src', 'style.css') },
      ]
    : []
  const plugins = [
    ...designPlugins(() => state.drafts, served ?? { of: cfg.root, shared: () => cfg.root }, own),
    vue(),
    modelsPlugin(cfg, state, mode),
    boards,
    ...(mode === 'dev' && !state.uiSrc ? [linkedDepsPlugin(withDeps('@pcbjs/ui', UI_DIR))] : []),
  ]
  const base: InlineConfig = {
    ...baseConfig(cfg, mode, plugins, served ? served.folders : [cfg.root], own),
    resolve: { alias: [{ find: 'vue', replacement: dirname(require.resolve('vue/package.json')) }, ...ui] },
    optimizeDeps: { entries: [join(CLIENT_DIR, 'index.html'), join(CLIENT_DIR, 'pane.html')], include: ['vue', ...(state.uiSrc ? ['clipper-lib'] : UI_ENTRIES), ...THREE_DEPS] },
    // the 3D view is one large chunk on purpose; Vite's advisory about it is noise on every build
    build: { outDir: cfg.outDir, emptyOutDir: true, chunkSizeWarningLimit: 4096 },
  }
  return cfg.vite && !served ? mergeConfig(base, cfg.vite) : base
}
