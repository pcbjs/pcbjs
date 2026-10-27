import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { createLogger, createServer, type Logger, type LogLevel, type ViteDevServer } from 'vite'
import type { ResolvedConfig } from './config.js'
import { viteConfig } from './vite.js'
import type { PluginState } from './plugin.js'
import { compileEntry, type Compiled } from './project.js'
import { markConflicts, type BoardSlot } from './boards.js'
import { boardFindings, boardLine, counts, routingLines, diffFindings, diffLine, failing, findingLine, formatFindings, orderFindings, type Finding, type TargetFindings } from '@pcbjs/export/findings'
import { variantSlug } from '@pcbjs/core/variants'
import { countModels } from '@pcbjs/core/model-source'
import { typecheck, typeErrorLine } from './typecheck.js'

export interface OutputOptions {
  /** summary lines and findings only */
  quiet?: boolean
  /** Vite's own logging and the stack of a compile error */
  verbose?: boolean
  json?: string
}

/** Silent unless --verbose or the project config asks for one. */
export function logLevelFor(cfg: ResolvedConfig, verbose?: boolean): 'info' | 'warn' | 'error' | 'silent' {
  if (verbose) return 'info'
  return (cfg.vite?.logLevel as any) ?? 'silent'
}

/** Without Vite's report of a module that fails to evaluate: pcbjs prints the one line, the stack with --verbose. */
export function quietLogger(level: LogLevel): Logger {
  const logger = createLogger(level, { allowClearScreen: false })
  const error = logger.error.bind(logger)
  logger.error = (msg, o) => { if (!strip(msg).includes('Error when evaluating SSR module')) error(msg, o) }
  return logger
}

/** No HTTP, no HMR socket, no file watcher unless `watch`. */
export async function compileServer(cfg: ResolvedConfig, state: PluginState, o: { verbose?: boolean; watch?: boolean } = {}): Promise<ViteDevServer> {
  const vc = viteConfig(cfg, state, 'build')
  return createServer({
    ...vc, logLevel: logLevelFor(cfg, o.verbose), customLogger: quietLogger(logLevelFor(cfg, o.verbose)),
    server: { ...vc.server, middlewareMode: true, ws: false, hmr: false, watch: o.watch ? {} : null },
    optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', mode: 'production',
  })
}

const strip = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, '')

/** One line, then with --verbose the code frame and the stack below it. */
export function errorText(e: any, verbose?: boolean, root?: string): { line: string; detail: string[] } {
  const msg = strip(String(e?.message ?? e))
  const first = msg.split('\n').find(l => l.trim()) ?? msg
  const rel = (f: string) => (root && f.startsWith(root + '/') ? f.slice(root.length + 1) : f)
  // Vite's location of a syntax error, else the first frame of the stack in the project
  let loc = e?.loc?.file ? `${rel(e.loc.file)}:${e.loc.line}:${e.loc.column}: ` : ''
  if (!loc && root && !/\.(m?[jt]sx?):\d+:\d+/.test(first)) {
    for (const l of strip(String(e?.stack ?? '')).split('\n')) {
      const m = /^\s+at (?:.*\()?(?:file:\/\/)?(\/[^()]+?):(\d+):(\d+)\)?$/.exec(l)
      if (m && m[1].startsWith(root + '/') && !m[1].includes('/node_modules/')) { loc = `${rel(m[1])}:${m[2]}:${m[3]}: `; break }
    }
  }
  const detail: string[] = []
  if (verbose) {
    const rest = msg.split('\n').slice(msg.split('\n').indexOf(first) + 1).filter(l => l.trim())
    detail.push(...rest)
    if (e?.frame) detail.push(...strip(String(e.frame)).split('\n'))
    const stack = strip(String(e?.stack ?? '')).split('\n').filter(l => /^\s+at /.test(l))
    detail.push(...stack)
  }
  return { line: `${loc}${first}`, detail }
}

/** Keeps on after a failure; the error of a failed one goes in `slot.error`. */
export async function compileSlots(server: ViteDevServer, cfg: ResolvedConfig, slots: BoardSlot[], errors: Map<BoardSlot, unknown>): Promise<void> {
  for (const s of slots) {
    try { s.compiled = await compileEntry(server, cfg, s.entry, false); s.error = null; errors.delete(s) } catch (e: any) {
      s.error = strip(String(e?.message ?? e))
      s.compiled = null
      errors.set(s, e)
    }
  }
  markConflicts(slots)
}

/** One per target of a board with variants. */
export interface ReportBoard {
  name: string
  target: string | null
  entry: string
  status: 'ok' | 'fail' | 'error'
  stats: Compiled['board']['stats'] | null
  /** phase timings in ms when the compiler records them */
  timings: unknown
  /** absent on a board without automatic routes */
  routing?: Compiled['board']['routing']
  ms: number | null
  counts: ReturnType<typeof counts> | null
  /** see docs/schematic-graphic.md */
  schematic?: import('@pcbjs/core/sch-model').SchStats
  /** parts by where their 3D body comes from */
  models?: ReturnType<typeof countModels>
  drc: Finding[]
  erc: Finding[]
  fab: { dir: string; zip: string } | null
  pages: string[]
  error?: string
}
export interface Report { boards: ReportBoard[] }

export function reportOf(cfg: ResolvedConfig, s: BoardSlot, e: unknown, extra: { fab?: (c: Compiled) => ReportBoard['fab']; pages?: string[] } = {}): ReportBoard[] {
  const rel = (p: string) => relative(cfg.root, p) || '.'
  if (!s.compiled || s.conflict) {
    const err = s.conflict ?? errorText(e, false, cfg.root).line
    return [{ name: s.entry.rel, target: null, entry: s.entry.rel, status: 'error', stats: null, timings: null, ms: null, counts: null, drc: [], erc: [], fab: null, pages: [], error: err }]
  }
  return s.compiled.map(c => {
    const b = c.board
    const f = boardFindings(b, cfg.root)
    const slug = b.variant ? variantSlug(b.variant.name) : null
    const pages = (extra.pages ?? []).filter(p => p === `board/${b.name}` || (slug ? p === `board/${b.name}/${slug}` : false))
    const fab = extra.fab?.(c) ?? null
    return {
      name: b.name, target: b.variant?.name ?? null, entry: c.entry.rel, status: failing(b) ? 'fail' : 'ok',
      stats: b.stats, timings: b.timings ?? null, ...(b.routing ? { routing: b.routing } : {}), ms: Math.round(c.ms), counts: counts(b), ...(b.schematic.drawing ? { schematic: b.schematic.drawing.stats } : {}), models: countModels(c.site.footprints),
      drc: orderFindings(f.filter(x => x.kind === 'drc')), erc: orderFindings(f.filter(x => x.kind === 'erc')),
      fab: fab ? { dir: rel(fab.dir), zip: rel(fab.zip) } : null, pages,
    }
  })
}

export function writeReport(cfg: ResolvedConfig, file: string, report: Report): string {
  const abs = resolve(cfg.root, file)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, JSON.stringify(report, null, 2) + '\n')
  return relative(cfg.root, abs) || abs
}

/** A line per target, then the findings of every target merged, at most `cap` lines per rule; every one with `verbose`. */
export function slotLines(s: BoardSlot, e: unknown, o: { root: string; cap: number; verbose?: boolean; more?: string }): string[] {
  if (s.conflict) return [`${s.entry.rel}  error: ${s.conflict}`]
  if (!s.compiled) {
    const t = errorText(e, o.verbose, o.root)
    return [`${s.entry.rel}  compile error: ${t.line}`, ...t.detail.map(l => `  ${l}`)]
  }
  const out = s.compiled.map(c => boardLine(c.board, c.entry.rel, c.ms))
  out.push(...routingLines(s.compiled.map(c => c.board)))
  const targets: TargetFindings[] = s.compiled.map(c => ({ target: c.board.variant?.name, findings: boardFindings(c.board, o.root) }))
  out.push(...formatFindings(targets, { cap: o.cap, more: o.more, all: o.verbose }))
  return out
}

/** Every board's counts added up. */
export function totalLine(slots: BoardSlot[]): string {
  let de = 0, dw = 0, un = 0, ee = 0, ew = 0, bad = 0, failed = 0
  for (const s of slots) {
    if (!s.compiled || s.conflict) { failed++; continue }
    for (const c of s.compiled) {
      const k = counts(c.board)
      de += k.drcErrors; dw += k.drcWarnings; un += k.unconnected; ee += k.ercErrors; ew += k.ercWarnings
      if (failing(c.board)) bad++
    }
  }
  const ok = !bad && !failed
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`
  return `${ok ? 'ok  ' : 'FAIL'}  DRC ${n(de, 'error')}, ${n(dw, 'warning')}, ${un} unconnected  ERC ${n(ee, 'error')}, ${n(ew, 'warning')}${failed ? `  ${failed} entr${failed === 1 ? 'y' : 'ies'} failed to compile` : ''}`
}

export const slotsFailed = (slots: BoardSlot[]): boolean => slots.some(s => !s.compiled || s.conflict || s.compiled.some(c => failing(c.board)))

/** Mark a failed entry's outputs stale: its board JSON gets `stale: true` and the error, each fab directory a STALE file. */
export function markStale(cfg: ResolvedConfig, entry: string, error: string): string[] {
  const index = join(cfg.outDir, 'boards.json')
  if (!existsSync(index)) return []
  let boards: { name: string; variant?: string; file: string; entry: string }[] = []
  try { boards = JSON.parse(readFileSync(index, 'utf8')).boards ?? [] } catch { return [] }
  const marked: string[] = []
  const note = `STALE: the last compile of ${entry} failed, these files are from an earlier build.\n${error}\n`
  for (const b of boards.filter(b => b.entry === entry)) {
    const file = join(cfg.outDir, ...b.file.split('/').map(decodeURIComponent))
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8'))
        writeFileSync(file, JSON.stringify({ ...data, stale: true, staleError: error }))
        marked.push(relative(cfg.root, file))
      } catch { /* not ours */ }
    }
    const segs = [b.name, ...(b.variant ? [variantSlug(b.variant)] : [])]
    for (const dir of [join(cfg.fabDir, ...segs), join(cfg.outDir, 'fab', ...segs)]) {
      if (!existsSync(dir)) continue
      writeFileSync(join(dir, 'STALE'), note)
      marked.push(relative(cfg.root, join(dir, 'STALE')))
    }
  }
  return marked
}

export const CHECK_CAP = 10

/** No fab files and no site. With `watch`, recompile on every change and print the diff. */
export async function check(opts: OutputOptions & { cfg: ResolvedConfig; state: PluginState; watch?: boolean }): Promise<number> {
  const { cfg, state } = opts
  const server = await compileServer(cfg, state, { verbose: opts.verbose, watch: opts.watch })
  const errors = new Map<BoardSlot, unknown>()
  const run = async (): Promise<Map<string, Finding[]>> => {
    await compileSlots(server, cfg, state.slots, errors)
    const now = new Map<string, Finding[]>()
    for (const s of state.slots) if (s.compiled && !s.conflict) for (const c of s.compiled) now.set(`${c.board.name}|${c.board.variant?.name ?? ''}`, boardFindings(c.board, cfg.root))
    return now
  }
  const print = () => {
    for (const s of state.slots) for (const l of slotLines(s, errors.get(s), { root: cfg.root, cap: CHECK_CAP, verbose: opts.verbose, more: opts.json ? `all in ${opts.json}` : 'all with --verbose or --json <file>' })) console.log(l)
    console.log(totalLine(state.slots))
    if (opts.json) console.log(`json   ${writeReport(cfg, opts.json, { boards: state.slots.flatMap(s => reportOf(cfg, s, errors.get(s))) })}`)
  }
  try {
    let last = await run()
    print()
    // cached per file, see typecheck.ts
    const tc = typecheck(cfg.root, cfg.entries.map(e => e.file))
    if (tc) {
      console.log(`typecheck  ${tc.errors.length ? `${tc.errors.length} error${tc.errors.length === 1 ? '' : 's'}` : 'ok'}  ${Math.round(tc.ms)} ms${tc.cached ? ', cached' : ''}`)
      for (const e of tc.errors.slice(0, 20)) console.log(typeErrorLine(e, opts.verbose))
      if (tc.errors.length > 20) console.log(`  and ${tc.errors.length - 20} more, all with npx tsc --noEmit`)
    }
    if (!opts.watch) return slotsFailed(state.slots) || tc?.errors.length ? 1 : 0
    console.log(`watching ${cfg.root} for changes, Ctrl-C to stop`)
    const graph = server.environments.ssr.moduleGraph
    let timer: NodeJS.Timeout | null = null, busy: Promise<void> | null = null
    const again = async () => {
      graph.invalidateAll()
      const t0 = performance.now()
      const now = await run()
      const lines: string[] = []
      for (const s of state.slots) {
        if (!s.compiled || s.conflict) { lines.push(...slotLines(s, errors.get(s), { root: cfg.root, cap: 10, verbose: opts.verbose })); continue }
        for (const c of s.compiled) {
          const key = `${c.board.name}|${c.board.variant?.name ?? ''}`
          const d = diffFindings(last.get(key) ?? [], now.get(key) ?? [])
          lines.push(`${boardLine(c.board, c.entry.rel, c.ms)}  ${diffLine(d)}`)
          for (const f of d.added) lines.push(`  new  ${findingLine(f)}`)
        }
      }
      last = now
      console.log(`\n${new Date().toLocaleTimeString()}  recompiled in ${Math.round(performance.now() - t0)} ms`)
      for (const l of lines) console.log(l)
      console.log(totalLine(state.slots))
      if (opts.json) writeReport(cfg, opts.json, { boards: state.slots.flatMap(s => reportOf(cfg, s, errors.get(s))) })
    }
    const inProject = (f: string) => f.startsWith(cfg.root) && !f.includes('/.pcbjs/') && !f.includes('/node_modules/') && /\.(m?[jt]sx?|json)$/.test(f)
    const changed = (f: string) => {
      if (!inProject(f)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; busy = (busy ?? Promise.resolve()).then(again).catch(e => console.error(`pcbjs: ${e?.message ?? e}`)) }, 80)
    }
    server.watcher.add(cfg.root)
    server.watcher.on('change', changed)
    server.watcher.on('add', changed)
    server.watcher.on('unlink', changed)
    await new Promise<void>(done => { for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => done()) })
    return 0
  } finally {
    await server.close()
  }
}
