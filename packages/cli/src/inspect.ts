// `pcbjs inspect`: from a live session's snapshot, else one compile here; project/inspect.ts renders the board.
import { realpathSync } from 'node:fs'
import { relative } from 'node:path'
import { resolveConfig } from './project/config.js'
import { pluginState } from './server/site.js'
import { compileServer, compileSlots, errorText } from './project/compile.js'
import { viteLoader } from './project/loader.js'
import type { BoardSlot } from './project/boards.js'
import { secs, type InspectRequest } from './project/dev-reuse.js'
import { ask, sessionLine, sessionOf } from './session/thin.js'
import { inspectMany, inspectOutput, pickTarget, type InspectResult } from './project/inspect.js'
import { freshCache } from '@pcbjs/compile/internal/cache'

export interface InspectOptions {
  entry?: string
  root?: string
  config?: string
  json?: boolean
  target?: string
  verbose?: boolean
  /** one query; `requests` takes several, answered from one compile */
  query?: string
  lengths?: boolean
  layer?: string
  requests?: InspectRequest[]
  /** compile here even when a running dev server holds a current board */
  /** compile here, every stage rebuilt; 'all' drops the route memos too */
  fresh?: boolean | 'all'
}

export async function inspect(opts: InspectOptions): Promise<number> {
  process.env.NODE_ENV ??= 'production'
  const requests: InspectRequest[] = opts.requests ?? [
    { ...(opts.query !== undefined ? { query: opts.query } : {}), ...(opts.lengths ? { lengths: true } : {}), ...(opts.layer ? { layer: opts.layer } : {}) },
  ]
  // naming one board of the config picks it, not an override worth a line
  const cfg = await resolveConfig(opts.entry === undefined ? [] : [opts.entry], 'build', opts.config, opts.root, () => {})
  if (cfg.entries.length > 1) throw new Error(`inspect looks at one board, name its entry: ${cfg.entries.map(e => `pcbjs inspect ${e.rel}`).join(', ')}`)
  const entry = cfg.entries[0]
  const print = (results: InspectResult[]) => {
    for (const l of inspectOutput(results, requests, !!opts.json)) console.log(l)
    return results.every(r => r.found) ? 0 : 1
  }
  if (opts.fresh) freshCache(cfg.root, opts.fresh === 'all')
  // a live session answers from its settled snapshot
  const root = realpathSync(cfg.root)
  const info = opts.fresh ? null : await sessionOf(root)
  if (info) {
    const e = await ask(info, 'pcbjs inspect', root, 'session/inspect', {
      project: root,
      entry: entry.file,
      requests,
      json: !!opts.json,
      verbose: !!opts.verbose,
      ...(opts.target ? { target: opts.target } : {}),
    })
    console.error(sessionLine(info, e))
    process.stderr.write(e.value.stderr)
    process.stdout.write(e.value.stdout)
    return e.value.exitCode
  }
  const state = pluginState(cfg)
  const errors = new Map<BoardSlot, unknown>()
  const t0 = performance.now()
  const server = await compileServer(cfg, { verbose: opts.verbose })
  try {
    await compileSlots(viteLoader(server), cfg, state.slots, errors)
  } finally {
    await server.close()
  }
  const s = state.slots[0]
  if (!s.compiled) {
    const t = errorText(errors.get(s), opts.verbose, cfg.root)
    console.error(`${s.entry.rel}  compile error: ${t.line}`)
    for (const l of t.detail) console.error(`  ${l}`)
    return 1
  }
  console.error(`compiled  ${s.entry.rel}  ${secs(performance.now() - t0)}`)
  const c = pickTarget(s.compiled, opts.target)
  if (typeof c === 'string') {
    console.error(`pcbjs: ${c}`)
    return 1
  }
  return print(inspectMany(c.board, relative(cfg.root, c.entry.file) || c.entry.rel, cfg.root, requests))
}
