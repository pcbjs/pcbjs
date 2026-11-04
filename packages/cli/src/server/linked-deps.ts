import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'
import { fileKey, under } from '../project/files.js'

/** A prebundled package and its folder, real path. */
export interface Dep {
  name: string
  dir: string
}

/** ms of quiet in a linked dist before it is prebundled again; a library build writes its files over a second or so */
const SETTLE_MS = 400

const BUILT = /\.(m?js|css)$/

/** A package outside node_modules, a linked development tree: its dist changes without the lockfile, which keys Vite's prebundle. */
export const isLinked = (dir: string) => !fileKey(dir).split('/').includes('node_modules')

/** A package and the @pcbjs packages it depends on, real paths: the prebundle bundles their dists with it, so a rebuild of any of them changes it. */
export function withDeps(name: string, dir: string): Dep[] {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const req = createRequire(join(dir, 'package.json'))
  const deps = Object.keys(pkg.dependencies ?? {}).filter(n => n.startsWith('@pcbjs/'))
  return [{ name, dir }, ...deps.map(n => ({ name: n, dir: dirname(req.resolve(`${n}/package.json`)) }))]
}

/** Content hash of a package's built JavaScript and CSS, empty when it has no dist. */
export function distStamp(dir: string): string {
  const dist = join(dir, 'dist')
  if (!existsSync(dist)) return ''
  const files = readdirSync(dist, { recursive: true, encoding: 'utf8' })
    .filter(f => BUILT.test(f))
    .sort()
  const h = createHash('sha256')
  for (const f of files)
    h.update(f)
      .update('\0')
      .update(readFileSync(join(dist, f)))
      .update('\0')
  return h.digest('hex').slice(0, 16)
}

/** The prebundle's banner, which Vite hashes with its config, so a new stamp re-optimizes on start and on demand. */
const bannerOf = (deps: Dep[]) => `/* pcbjs linked ${deps.map(d => `${d.name} ${distStamp(d.dir)}`).join(', ')} */`

/** Prebundles linked `deps` again whenever their dist changes, at start and while the server runs, then reloads the page. */
export function linkedDepsPlugin(deps: Dep[]): Plugin {
  const linked = deps.filter(d => isLinked(d.dir))
  const dists = linked.map(d => join(d.dir, 'dist'))
  return {
    name: 'pcbjs:linked-deps',
    apply: 'serve',
    config: () => (linked.length ? { optimizeDeps: { esbuildOptions: { banner: { js: bannerOf(linked) } } } } : undefined),
    configureServer(server) {
      if (!linked.length) return
      const env = server.environments.client
      let timer: NodeJS.Timeout | undefined
      const refresh = () => {
        const esb = env.config.optimizeDeps.esbuildOptions!
        const js = bannerOf(linked)
        if (esb.banner?.js === js) return
        esb.banner = { ...esb.banner, js }
        server.config.logger.info(`[pcbjs] ${linked.map(d => d.name).join(', ')} rebuilt, prebundling again`, { timestamp: true })
        env.depsOptimizer?.run()
      }
      const changed = (f: string) => {
        if (!BUILT.test(f) || !dists.some(d => under(f, d))) return
        clearTimeout(timer)
        timer = setTimeout(refresh, SETTLE_MS)
      }
      server.watcher.add(dists)
      for (const ev of ['add', 'change', 'unlink'] as const) server.watcher.on(ev, changed)
      server.httpServer?.on('close', () => clearTimeout(timer))
    },
  }
}
