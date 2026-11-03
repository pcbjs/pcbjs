// A one-shot compile of every entry in this process, for `q`, `script`, `repl`, `test` and `shot` when no session is live, named as a snapshot `local-<hash>`; the SVGs and the GLB are made when asked for.
import { createHash } from 'node:crypto'
import { compileServer, compileSlots, errorText } from './compile.js'
import { viteLoader } from './loader.js'
import { DATA_FORMATS } from './project.js'
import type { ResolvedConfig } from './config.js'
import { slotsFor, type BoardSlot } from './boards.js'
import { snapshotBoards, type QBoard } from './query.js'
import { boardFindings } from '@pcbjs/export/internal/findings'
import { freshCache } from '@pcbjs/compile/internal/cache'

export interface Local {
  snapshot: string
  slots: BoardSlot[]
  boards: QBoard[]
  /** a line per entry that failed to compile */
  errors: string[]
}

export async function compileHere(cfg: ResolvedConfig, o: { verbose?: boolean; fresh?: boolean | 'all' } = {}): Promise<Local> {
  process.env.NODE_ENV ??= 'production'
  if (o.fresh) freshCache(cfg.root, o.fresh === 'all')
  const state = { slots: slotsFor(cfg.entries) }
  const failures = new Map<BoardSlot, unknown>()
  const server = await compileServer(cfg, { verbose: o.verbose })
  try {
    await compileSlots(viteLoader(server), cfg, state.slots, failures, { formats: DATA_FORMATS })
  } finally {
    await server.close()
  }
  const h = createHash('sha1')
  for (const s of state.slots)
    for (const c of s.compiled ?? []) h.update(JSON.stringify([c.board.name, c.board.variant?.name ?? null, c.board.items.length, c.board.items.map(i => i.uid ?? i.id)]))
  const snapshot = `local-${h.digest('hex').slice(0, 8)}`
  const errors = state.slots
    .filter(s => !s.compiled || s.conflict)
    .map(s => `${s.entry.rel}  ${s.conflict ? `error: ${s.conflict}` : `compile error: ${errorText(failures.get(s), o.verbose, cfg.root).line}`}`)
  return { snapshot, slots: state.slots, boards: snapshotBoards(state.slots, snapshot, cfg.root, c => boardFindings(c.board, cfg.root)), errors }
}
