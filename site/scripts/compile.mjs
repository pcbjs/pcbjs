// Compiles one entry of the project in the working directory as pcbjs check does and writes, for the home page demo, its board and
// schematic as SVG with their item ids and part refs kept, and map.json: its source ranges with a chip label each and its fab file list.
// Usage: node compile.mjs <out> <entry>; boards.mjs runs it in a process of its own, since a project's defaults live on globalThis.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { resolveConfig } from '@pcbjs/cli/internal/config'
import { pluginState } from '@pcbjs/cli/internal/site'
import { compileServer, compileSlots } from '@pcbjs/cli/internal/compile'
import { viteLoader } from '@pcbjs/cli/internal/loader'
import { pcbSvg, schSvg } from './preview-svg.mjs'
import { sourceMap } from './source-map.mjs'
import { buildFab } from '@pcbjs/export/internal/fab'

const [dir, entry] = process.argv.slice(2)
const out = resolve(dir)
/** The fab set's file names and the STATUS line of its README. */
function fabList(board) {
  const fab = buildFab(board, '2026-01-01')
  return { files: Object.keys(fab.files).sort(), zip: fab.zipName, status: /STATUS: .*/.exec(fab.readme)?.[0] ?? '' }
}

const cfg = await resolveConfig([entry], 'build', undefined, process.cwd(), () => {})
const state = pluginState(cfg)
const server = await compileServer(cfg)
try {
  const errors = new Map()
  await compileSlots(viteLoader(server), cfg, state.slots, errors)
  const [s] = state.slots
  const board = s.compiled?.[0]?.board
  if (!board) throw errors.get(s) ?? new Error(`${entry} compiled to no board`)
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, '2d.svg'), pcbSvg(board))
  if (board.schematic.drawing) writeFileSync(join(out, 'sch.svg'), schSvg(board))
  writeFileSync(join(out, 'map.json'), JSON.stringify({ name: board.name, ...sourceMap(board, s.entry.file, cfg.root), fab: fabList(board) }))
} finally {
  await server.close()
}
