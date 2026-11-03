// `pcbjs patch hold <route>`: the route's automatic legs as this compile leaves them, written as a hold into the .patches.ts file beside the entry; see docs/patches.md.
import { existsSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { patchesFile } from '@pcbjs/core/internal/patch'
import { holdPatch } from '@pcbjs/compile/internal/patches'
import { resolveConfig } from './project/config.js'
import { pluginState } from './server/site.js'
import type { BoardSlot } from './project/boards.js'
import { snapshotOf } from './project/report.js'
import { compileServer, compileSlots, errorText } from './project/compile.js'
import { viteLoader } from './project/loader.js'
import { pickTarget } from './project/inspect.js'
import { withPatch } from './project/patch-text.js'
import { sourceWriter } from './session/source-write.js'

export { withPatch, patchText } from './project/patch-text.js'

export interface PatchOptions {
  ref: string
  entry?: string
  config?: string
  target?: string
  root?: string
  verbose?: boolean
}

/** Compile the entry, take the route's hold and write it into the patches file, replacing a hold of the same route, through the live session when one serves the project. */
export async function patchHold(opts: PatchOptions): Promise<number> {
  process.env.NODE_ENV ??= 'production'
  const cfg = await resolveConfig(opts.entry === undefined ? [] : [opts.entry], 'build', opts.config, opts.root, () => {})
  if (cfg.entries.length > 1) throw new Error(`patch writes beside one board, name its entry with --entry: ${cfg.entries.map(e => e.rel).join(', ')}`)
  const state = pluginState(cfg)
  const errors = new Map<BoardSlot, unknown>()
  const server = await compileServer(cfg, { verbose: opts.verbose })
  try {
    await compileSlots(viteLoader(server), cfg, state.slots, errors)
  } finally {
    await server.close()
  }
  const s = state.slots[0]
  if (!s.compiled) {
    console.error(`${s.entry.rel}  compile error: ${errorText(errors.get(s), opts.verbose, cfg.root).line}`)
    return 1
  }
  const c = pickTarget(s.compiled, opts.target)
  if (typeof c === 'string') {
    console.error(`pcbjs: ${c}`)
    return 1
  }
  const p = holdPatch(c.board, opts.ref, snapshotOf(c.board))
  const file = patchesFile(s.entry.file)
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null
  const writer = await sourceWriter(cfg.root, 'pcbjs patch')
  const w = await writer.write(file, before, withPatch(before, p)).finally(() => writer.close())
  if (!w.applied) {
    console.error(`pcbjs: ${relative(cfg.root, file)}: ${w.reason ?? 'not written'}`)
    return 1
  }
  const n = 'hold' in p.op ? p.op.hold.tracks.length : 0
  console.log(`${before !== null ? 'wrote' : 'created'} ${relative(cfg.root, file)}: hold of ${p.ref}, ${n} track${n === 1 ? '' : 's'}, hash ${p.hash}`)
  return 0
}
