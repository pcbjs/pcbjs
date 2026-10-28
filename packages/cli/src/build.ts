import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build as viteBuild, preview as vitePreview } from 'vite'
import { resolveConfig } from './config.js'
import { CLIENT_DIR, viteConfig } from './vite.js'
import { pluginState, type PluginState } from './plugin.js'
import { boardDir, boardFile, writeFab, type Compiled } from './project.js'
import { boardsIndex, boardsPayload, type BoardSlot } from './boards.js'
import { CHECK_CAP, compileServer, compileSlots, errorText, logLevelFor, markStale, reportOf, slotLines, slotsFailed, totalLine, writeReport, type OutputOptions } from './check.js'
import { msText } from '@pcbjs/export/findings'
import { fabDate } from '@pcbjs/export/fab'
import { pageHtml, previewPrerendered, safeSegment, scriptJson, siteRoutes, type Rendered } from './prerender.js'
import { resolveRepo } from './repo.js'

export interface BuildOptions extends OutputOptions {
  entries?: string[]
  root?: string
  config?: string
  outDir?: string
  date?: string
}

export async function build(opts: BuildOptions): Promise<void> {
  // createServer would set NODE_ENV to development, giving the builds below Vue's development build
  process.env.NODE_ENV ??= 'production'
  const cfg = await resolveConfig(opts.entries ?? [], 'build', opts.config, opts.root)
  if (opts.outDir) cfg.outDir = resolve(cfg.root, opts.outDir)
  // one date for every file of every set: --date, else SOURCE_DATE_EPOCH, else now, see fabDate
  cfg.fabDate = fabDate(opts.date)
  // every fab set written is read back and compared with its board, see fab-check.ts in @pcbjs/export
  cfg.fabCheck = true
  const state = pluginState(cfg)
  const say = (line: string) => {
    if (!opts.quiet) console.log(line)
  }
  const rel = (p: string) => relative(cfg.root, p) || '.'

  // a failed entry does not stop the others
  const errors = new Map<BoardSlot, unknown>()
  const server = await compileServer(cfg, state, { verbose: opts.verbose })
  try {
    await compileSlots(server, cfg, state.slots, errors)
  } finally {
    await server.close()
  }
  const broken = state.slots.filter(s => !s.compiled || s.conflict)
  // every entry: one per board, one per target of a board with variants
  const all = state.slots.filter(s => s.compiled && !s.conflict).flatMap(s => s.compiled!) as Compiled[]
  // the repository link for cmd+click on a source range, built sites only
  const repo = resolveRepo(cfg.repo, cfg.root)
  if (repo) for (const c of all) c.site.repo = repo

  // a failed entry keeps its last fab set, marked stale
  if (!broken.length) rmSync(cfg.fabDir, { recursive: true, force: true })
  const fabs = new Map<Compiled, { dir: string; zip: string; files: number }>()
  for (const c of all) {
    const dir = join(cfg.fabDir, ...boardDir(c.board))
    if (broken.length) rmSync(dir, { recursive: true, force: true })
    const names = writeFab(c, dir)
    fabs.set(c, { dir, zip: join(dir, c.fab.zipName), files: names.length })
  }
  const more = opts.json ? `all in ${opts.json}` : 'all with --json <file>'
  for (const s of state.slots) for (const l of slotLines(s, errors.get(s), { root: cfg.root, cap: CHECK_CAP, verbose: opts.verbose, more })) console.log(l)
  const files = [...fabs.values()].reduce((n, f) => n + f.files, 0)
  if (all.length) say(`fab    ${rel(cfg.fabDir)}  ${all.length} set${all.length === 1 ? '' : 's'}, ${files} files`)
  const report = (pages: string[]) => {
    if (!opts.json) return
    const boards = state.slots.flatMap(s => reportOf(cfg, s, errors.get(s), { pages, fab: c => fabs.get(c) ?? null }))
    console.log(`json   ${writeReport(cfg, opts.json, { boards })}`)
  }

  if (broken.length) {
    for (const s of broken) {
      if (s.conflict) continue
      const marked = markStale(cfg, s.entry.rel, errorText(errors.get(s), false, cfg.root).line)
      if (marked.length) say(`stale  ${marked.join(', ')}`)
    }
    say(`site   not rebuilt: ${broken.length} entr${broken.length === 1 ? 'y' : 'ies'} failed, ${rel(cfg.outDir)} is from an earlier build`)
    console.log(totalLine(state.slots))
    report([])
    process.exitCode = 1
    return
  }

  // a relative base cannot name the routes' URLs, so only an absolute one is prerendered
  const t0 = performance.now()
  const vc = viteConfig(cfg, state, 'build')
  const logLevel = logLevelFor(cfg, opts.verbose)
  const prerender = isAbsoluteBase(cfg.base)
  if (!prerender) say(`site   base "${cfg.base}" is relative: client-rendered pages only, set an absolute base such as "/" to prerender every route`)
  state.inline = !prerender
  await viteBuild({ ...vc, logLevel, mode: 'production', build: { ...vc.build, manifest: true } })
  let pages: string[] = []
  if (prerender) {
    const ssrDir = join(cfg.root, '.pcbjs', 'cache', 'ssr')
    await viteBuild({
      ...vc,
      mode: 'production',
      logLevel: logLevel === 'info' ? 'warn' : logLevel,
      // everything is bundled, Vue included, so the bundle runs from the cache without the project resolving the client's dependencies
      ssr: { ...vc.ssr, noExternal: true },
      build: {
        ...vc.build,
        ssr: join(CLIENT_DIR, 'src', 'entry-server.ts'),
        outDir: ssrDir,
        emptyOutDir: true,
        copyPublicDir: false,
        rollupOptions: { output: { entryFileNames: 'entry-server.mjs', format: 'es' } },
      },
    })
    const data = buildPayload(state)
    pages = await prerenderSite(join(ssrDir, 'entry-server.mjs'), cfg.outDir, cfg.base, data)
    if (opts.verbose) say(`pages  ${pages.length} prerendered: ${pages.map(p => '/' + p).join(' ')}`)
  }
  cpSync(cfg.fabDir, join(cfg.outDir, 'fab'), { recursive: true })
  mkdirSync(join(cfg.outDir, 'boards'), { recursive: true })
  for (const c of all) {
    const file = join(cfg.outDir, ...boardFile(c.board).split('/').map(decodeURIComponent))
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify(c.site))
  }
  writeFileSync(join(cfg.outDir, 'boards.json'), JSON.stringify(boardsIndex(all, state.slots.length === 1), null, 2))
  const n = state.slots.length,
    targets = all.length > n ? `, ${all.length} entries` : ''
  say(`site   ${rel(cfg.outDir)}  ${n} board${n === 1 ? '' : 's'}${targets}${prerender ? `, ${pages.length} pages` : ''}  ${msText(performance.now() - t0)}`)
  console.log(totalLine(state.slots))
  report(pages)
  if (slotsFailed(state.slots)) process.exitCode = 1
}

/** The boards a built site carries: every entry's, never the isolated preview of dev. */
export const buildPayload = (state: PluginState): ReturnType<typeof boardsPayload> => boardsPayload(state.slots)

/** True for a base that names the site's URL path, such as `/` or `/repo/`, which prerendering needs. */
export const isAbsoluteBase = (base: string): boolean => base.startsWith('/')

/** Render every route with the SSR bundle to `<outDir>/<route>/index.html` and 404.html; returns the routes written. */
export async function prerenderSite(bundle: string, outDir: string, base: string, data: ReturnType<typeof boardsPayload>): Promise<string[]> {
  const { render } = (await import(pathToFileURL(bundle).href + `?t=${Date.now()}`)) as { render: (path: string, data: unknown) => Promise<Rendered> }
  const template = readFileSync(join(outDir, 'index.html'), 'utf8')
  const json = scriptJson(data)
  const b = base.endsWith('/') ? base : base + '/'
  const written: string[] = []
  // the root last, since the template is the root's index.html
  const routes = siteRoutes(data)
  for (const segs of [...routes.slice(1), routes[0]]) {
    if (!segs.every(safeSegment)) {
      console.warn(`pcbjs: no page for ${segs.join('/')}, the name cannot be a directory; the site still shows it from another page`)
      continue
    }
    const url = b + segs.map(encodeURIComponent).join('/')
    const r = await render(url, data)
    const dir = join(outDir, ...segs)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), pageHtml(template, json, r))
    written.push(segs.join('/'))
  }
  // static hosts such as GitHub Pages answer an unknown path with 404.html; the app then shows its own "no such board" page
  writeFileSync(join(outDir, '404.html'), pageHtml(template, json))
  return written
}

export async function preview(opts: BuildOptions & { port?: number; host?: string | boolean }): Promise<void> {
  const cfg = await resolveConfig(opts.entries ?? [], 'build', opts.config, opts.root)
  if (opts.outDir) cfg.outDir = resolve(cfg.root, opts.outDir)
  if (!existsSync(cfg.outDir)) throw new Error(`${cfg.outDir} does not exist: run pcbjs build first`)
  const vc = viteConfig(cfg, pluginState(cfg), 'build')
  // a prerendered site is served as a static host serves it, a client-rendered one with Vite's index.html fallback
  const prerendered = existsSync(join(cfg.outDir, '404.html')) && isAbsoluteBase(cfg.base)
  const server = await vitePreview({
    ...vc,
    preview: { port: opts.port ?? 4173, host: opts.host },
    ...(prerendered ? { appType: 'mpa' as const, plugins: [...(vc.plugins ?? []), previewPrerendered(cfg.outDir, cfg.base)] } : {}),
  })
  server.printUrls()
}
