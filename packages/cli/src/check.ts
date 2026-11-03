import type { ResolvedConfig } from './project/config.js'
import { compileServer, compileSlots } from './project/compile.js'
import { viteLoader } from './project/loader.js'
import type { PluginState } from './server/site.js'
import { DATA_FORMATS } from './project/project.js'
import type { BoardSlot } from './project/boards.js'
import { boardFindings, boardLine, diffFindings, diffLine, findingLine, type Finding } from '@pcbjs/export/internal/findings'
import { typecheck } from './project/typecheck.js'
import { checkLines, checkReport, slotLines, totalLine, typecheckLines, writeReport, type CheckReport } from './project/report.js'
import { freshCache } from '@pcbjs/compile/internal/cache'

export interface OutputOptions {
  /** summary lines and findings only */
  quiet?: boolean
  /** Vite's own logging and the stack of a compile error */
  verbose?: boolean
  json?: string
}

/** No fab files and no site. With `watch`, recompile on every change, print the diff, typecheck again and rewrite the JSON. */
export async function check(opts: OutputOptions & { cfg: ResolvedConfig; state: PluginState; watch?: boolean; fresh?: boolean | 'all'; cache?: boolean }): Promise<number> {
  const { cfg, state } = opts
  if (opts.fresh) freshCache(cfg.root, opts.fresh === 'all')
  const server = await compileServer(cfg, { verbose: opts.verbose, watch: opts.watch })
  const errors = new Map<BoardSlot, unknown>()
  let t0 = performance.now()
  const run = async (): Promise<Map<string, Finding[]>> => {
    await compileSlots(viteLoader(server), cfg, state.slots, errors, { formats: DATA_FORMATS })
    const now = new Map<string, Finding[]>()
    for (const s of state.slots)
      if (s.compiled && !s.conflict) for (const c of s.compiled) now.set(`${c.board.name}|${c.board.variant?.name ?? ''}`, boardFindings(c.board, cfg.root))
    return now
  }
  // cached per file, see project/typecheck.ts
  const types = () => {
    const tc = typecheck(
      cfg.root,
      cfg.entries.map(e => e.file),
    )
    for (const l of typecheckLines(tc, opts.verbose)) console.log(l)
    return tc
  }
  const report = (tc: ReturnType<typeof typecheck>, say: boolean): CheckReport => {
    const r = checkReport(cfg, 'check', state.slots, s => errors.get(s as BoardSlot), tc, performance.now() - t0)
    if (!opts.json) return r
    const file = writeReport(cfg.root, opts.json, r)
    if (say) console.log(`json   ${file}`)
    return r
  }
  try {
    let last = await run()
    for (const l of checkLines(cfg.root, state.slots, s => errors.get(s as BoardSlot), opts)) console.log(l)
    const first = report(types(), true)
    if (!opts.watch) return first.exit
    console.log(`watching ${cfg.root} for changes, Ctrl-C to stop`)
    const graph = server.environments.ssr.moduleGraph
    let timer: NodeJS.Timeout | null = null,
      busy: Promise<void> | null = null
    const again = async () => {
      graph.invalidateAll()
      t0 = performance.now()
      const now = await run()
      const lines: string[] = []
      for (const s of state.slots) {
        if (!s.compiled || s.conflict) {
          lines.push(...slotLines(s, errors.get(s), { root: cfg.root, cap: 10, verbose: opts.verbose }))
          continue
        }
        for (const c of s.compiled) {
          const key = `${c.board.name}|${c.board.variant?.name ?? ''}`
          const d = diffFindings(last.get(key) ?? [], now.get(key) ?? [])
          lines.push(`${boardLine(c.board, c.entry.rel, c.ms)}  ${diffLine(d)}`)
          for (const f of d.added) lines.push(`  new  ${findingLine(f)}  ${f.id}`)
        }
      }
      last = now
      console.log(`\n${new Date().toLocaleTimeString()}  recompiled in ${Math.round(performance.now() - t0)} ms`)
      for (const l of lines) console.log(l)
      console.log(totalLine(state.slots))
      report(types(), false)
    }
    const inProject = (f: string) => f.startsWith(cfg.root) && !f.includes('/.pcbjs/') && !f.includes('/node_modules/') && /\.(m?[jt]sx?|json)$/.test(f)
    const changed = (f: string) => {
      if (!inProject(f)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        busy = (busy ?? Promise.resolve()).then(again).catch(e => console.error(`pcbjs: ${e?.message ?? e}`))
      }, 80)
    }
    server.watcher.add(cfg.root)
    server.watcher.on('change', changed)
    server.watcher.on('add', changed)
    server.watcher.on('unlink', changed)
    await new Promise<void>(done => {
      for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => done())
    })
    return 0
  } finally {
    await server.close()
  }
}
