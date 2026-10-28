// Compiles the project in the working directory as `pcbjs check` does and writes, for the gallery, report.json and each board's SVGs, named in its `svg`.
// Usage: node compile.mjs <out>; boards.mjs runs it once per project, since a project's defaults live on globalThis.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { resolveConfig } from '@pcbjs/cli/config'
import { pluginState } from '@pcbjs/cli/plugin'
import { compileServer, compileSlots, reportOf } from '@pcbjs/cli/check'
import { boardSvg } from '@pcbjs/export/svg'
import { schematicMarkup, schematicStyle } from '@pcbjs/export/sch-svg'

const out = resolve(process.argv[2])
// the layers of a top view; the rest of the board SVG is for tools, not for the gallery
const SHOWN = new Set(['B.Cu', 'F.Cu', 'F.SilkS', 'Edge.Cuts', 'holes'])
// 0.01 mm is below a pixel at any size the site draws a board
const coarse = svg => svg.replace(/-?\d+\.\d{3,}/g, n => String(Math.round(Number(n) * 100) / 100))

/** The board in CSS variables, its top view only, without the metadata, the pcb: namespace and the data attributes. */
function pcbSvg(board) {
  return coarse(boardSvg(board, { vars: true }))
    .replace(/^<\?xml[^>]*>\n/, '')
    .replace(/\s*<metadata>[\s\S]*?<\/metadata>/, '')
    .replace(/\s*<g pcb:layer="([^"]+)"[^>]*>[\s\S]*?<\/g>/g, (g, id) => SHOWN.has(id) ? g : '')
    .replace(/ (?:pcb:[a-z]+|data-[a-z]+|xmlns:pcb)="[^"]*"/g, '')
    .replace(/ width="[^"]*mm" height="[^"]*mm"/, '')
    .replace(/\n\s*\n/g, '\n')
}

/** The schematic in `--sch-*` variables, which the site's themes set. */
function schSvg(board) {
  const d = board.schematic.drawing
  const [x0, y0, x1, y1] = d.page
  const markup = schematicMarkup(d, board).replace(/ data-[a-z]+="[^"]*"/g, '')
  return coarse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" class="sch-board">\n<style>${schematicStyle()}</style>\n${markup}\n</svg>\n`)
}

const cfg = await resolveConfig([], 'build', undefined, process.cwd(), () => {})
const state = pluginState(cfg)
const server = await compileServer(cfg, state)
try {
  const errors = new Map()
  await compileSlots(server, cfg, state.slots, errors)
  mkdirSync(out, { recursive: true })
  const boards = []
  for (const s of state.slots) {
    const reports = reportOf(cfg, s, errors.get(s))
    reports.forEach((r, i) => {
      const board = s.compiled?.[i]?.board
      if (!board) return boards.push(r)
      const n = boards.length
      writeFileSync(join(out, `${n}.pcb.svg`), pcbSvg(board))
      if (board.schematic.drawing) writeFileSync(join(out, `${n}.sch.svg`), schSvg(board))
      boards.push({ ...r, svg: { '2d': `${n}.pcb.svg`, ...(board.schematic.drawing ? { sch: `${n}.sch.svg` } : {}) } })
    })
  }
  writeFileSync(join(out, 'report.json'), JSON.stringify({ boards }))
} finally {
  await server.close()
}
