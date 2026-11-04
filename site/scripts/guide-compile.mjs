import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'
import { resolveConfig } from '@pcbjs/cli/internal/config'
import { pluginState } from '@pcbjs/cli/internal/site'
import { compileServer, compileSlots } from '@pcbjs/cli/internal/compile'
import { viteLoader } from '@pcbjs/cli/internal/loader'
import { sourceMap } from './source-map.mjs'
import { pcbSvg, schSvg } from './preview-svg.mjs'

const [metadata, output] = process.argv.slice(2)
const example = JSON.parse(readFileSync(metadata, 'utf8'))
const cfg = await resolveConfig([example.entry], 'build', undefined, process.cwd(), () => {})
const state = pluginState(cfg)
const server = await compileServer(cfg)
try {
  const errors = new Map()
  await compileSlots(viteLoader(server), cfg, state.slots, errors)
  const [slot] = state.slots
  const board = slot.compiled?.[0]?.board
  if (!board) throw errors.get(slot) ?? new Error('Tutorial compiled to no board')
  const drawing = board.schematic.drawing
  const files = Object.entries(example.files)
    .sort(([a], [b]) => (a === example.activeFile ? -1 : b === example.activeFile ? 1 : a.localeCompare(b)))
    .map(([name, code]) => {
      const ranges = sourceMap(board, join(cfg.root, name), cfg.root).ranges
      for (const item of [...board.schematic.parts, ...(drawing?.symbols ?? [])]) {
        const src = item.src
        if (!src || relative(cfg.root, resolve(cfg.root, src.file)) !== name) continue
        ranges.push({
          start: [src.line, src.col],
          end: [src.endLine ?? src.line, src.endCol ?? code.split('\n')[src.line - 1]?.length ?? src.col],
          ids: [],
          uids: [],
          refs: [item.ref],
          chip: item.ref,
        })
      }
      for (const wire of drawing?.wires ?? []) {
        const src = wire.src
        if (!src || relative(cfg.root, resolve(cfg.root, src.file)) !== name) continue
        ranges.push({
          start: [src.line, src.col],
          end: [src.endLine ?? src.line, src.endCol ?? code.split('\n')[src.line - 1]?.length ?? src.col],
          ids: [],
          uids: [],
          refs: [],
          nets: [wire.net],
          chip: wire.net,
        })
      }
      const wanted = example.focus[name] ?? []
      const focus = code.split('\n').flatMap((line, i) => (wanted.some(x => (typeof x === 'number' ? x === i + 1 : line.includes(x))) ? [i + 1] : []))
      return { name, code, focus, ranges }
    })
  const count = (list, severity) => (list ?? []).filter(x => x.severity === severity).length
  writeFileSync(
    output,
    JSON.stringify({
      id: example.id,
      title: example.title,
      activeFile: example.activeFile,
      views: example.views.filter(v => v !== 'sch' || drawing),
      initialView: example.initialView,
      files,
      svg: { '2d': pcbSvg(board), ...(drawing ? { sch: schSvg(board) } : {}) },
      declared: board.schematic.parts.map(p => p.ref),
      placed: board.footprints.map(p => p.ref),
      items: board.items.map(x => ({ id: x.id, uid: x.uid, kind: x.kind, ...(x.net ? { net: x.net } : {}) })),
      counts: {
        drcErrors: count(board.drc, 'error'),
        drcWarnings: count(board.drc, 'warning'),
        ercErrors: count(board.erc, 'error'),
        ercWarnings: count(board.erc, 'warning'),
        tracks: board.items.filter(x => x.kind === 'track').length,
      },
    }),
  )
} finally {
  await server.close()
}
