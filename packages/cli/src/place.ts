// `pcbjs place [--write]`: where the placer, the solvers and the follower pass put each part with an auto slot; `--write`
// writes it into the source as each part's `at`, the one way to freeze a placement; see docs/placement.md.
import { readFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import type { AutoPlaced } from '@pcbjs/core/model'
import { freezeEdits } from '@pcbjs/compile/internal/freeze'
import { resolveConfig } from './project/config.js'
import { pluginState } from './server/site.js'
import type { BoardSlot } from './project/boards.js'
import { compileServer, compileSlots, errorText } from './project/compile.js'
import { viteLoader } from './project/loader.js'
import { textDoc } from '@pcbjs/core/internal/textdoc'
import { sourceWriter } from './session/source-write.js'

export interface PlaceOptions {
  entries?: string[]
  config?: string
  root?: string
  write?: boolean
  verbose?: boolean
}

/** Compile, list each auto placement, and with `write` freeze every one into its file, through the live session when one serves the project. */
export async function placeCommand(opts: PlaceOptions): Promise<number> {
  process.env.NODE_ENV ??= 'production'
  const cfg = await resolveConfig(opts.entries ?? [], 'build', opts.config, opts.root, () => {})
  const state = pluginState(cfg)
  const errors = new Map<BoardSlot, unknown>()
  const server = await compileServer(cfg, { verbose: opts.verbose })
  try {
    await compileSlots(viteLoader(server), cfg, state.slots, errors)
  } finally {
    await server.close()
  }
  let failed = 0
  const all: AutoPlaced[] = []
  for (const s of state.slots) {
    if (!s.compiled) {
      console.error(`${s.entry.rel}  compile error: ${errorText(errors.get(s), opts.verbose, cfg.root).line}`)
      failed++
      continue
    }
    const placed = s.compiled[0].board.placed ?? []
    for (const p of placed) console.log(`${s.entry.rel}  ${p.ref}  at="${p.at}"  ${p.by}${p.src ? `  ${p.src.file}:${p.src.line}` : ''}`)
    if (!placed.length) console.log(`${s.entry.rel}  no part with an auto slot`)
    all.push(...placed)
  }
  if (!opts.write || !all.length) return failed ? 1 : 0
  const { files, missed } = placementEdits(cfg.root, all)
  const writer = await sourceWriter(cfg.root, 'pcbjs place')
  try {
    for (const f of files) {
      const w = await writer.write(f.file, f.before, f.after)
      if (!w.applied) {
        console.error(`${relative(cfg.root, f.file)}: ${w.reason ?? 'not written'}`)
        failed++
      } else console.log(`wrote ${relative(cfg.root, f.file)}: ${f.edits} edit${f.edits === 1 ? '' : 's'}${w.via === 'editor' ? ' through the editor' : ''}`)
    }
  } finally {
    writer.close()
  }
  for (const p of missed)
    console.error(
      `${p.ref}: not frozen, its element ${p.src ? `at ${p.src.file}:${p.src.line} ` : ''}has no literal at or places several parts; write its at by hand: at="${p.at}"`,
    )
  return failed || missed.length ? 1 : 0
}

export interface Frozen {
  file: string
  before: string
  after: string
  edits: number
}

/** Each file's text before and after its placements are frozen, with how many edits, and the placements no element could take. */
export function placementEdits(
  root: string,
  placed: readonly AutoPlaced[],
  text: (file: string) => string = f => readFileSync(f, 'utf8'),
): { files: Frozen[]; missed: AutoPlaced[] } {
  const byFile = new Map<string, AutoPlaced[]>()
  const missed: AutoPlaced[] = []
  for (const p of placed) {
    if (!p.src) {
      missed.push(p)
      continue
    }
    const abs = isAbsolute(p.src.file) ? p.src.file : join(root, p.src.file)
    byFile.set(abs, [...(byFile.get(abs) ?? []), p])
  }
  const files: Frozen[] = []
  for (const [file, list] of byFile) {
    const src = text(file)
    const r = freezeEdits(file, src, list)
    missed.push(...r.missed)
    const doc = textDoc(src)
    if (r.edits.length) files.push({ file, before: src, after: doc.apply(r.edits.map(doc.edit)), edits: r.edits.length })
  }
  return { files, missed }
}
