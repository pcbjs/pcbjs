import { boardSvg } from '@pcbjs/export/internal/svg'
import { schematicMarkup, schematicStyle } from '@pcbjs/export/internal/sch-svg'

// the layers of a top view; the rest of the board SVG is for tools, not for the demo
const SHOWN = new Set(['B.Cu', 'F.Cu', 'F.SilkS', 'Edge.Cuts', 'holes'])
// 0.01 mm is below a pixel at any size the site draws a board
const coarse = svg => svg.replace(/-?\d+\.\d{3,}/g, n => String(Math.round(Number(n) * 100) / 100))

/** The board in CSS variables, its top view only, without the metadata, the pcb: namespace and the data attributes but data-id, data-ref and data-pad. */
export function pcbSvg(board) {
  const kept = /^data-(?:id|ref|pad)$/
  return coarse(boardSvg(board, { vars: true }))
    .replace(/^<\?xml[^>]*>\n/, '')
    .replace(/\s*<metadata>[\s\S]*?<\/metadata>/, '')
    .replace(/\s*<g pcb:layer="([^"]+)"[^>]*>[\s\S]*?<\/g>/g, (g, id) => (SHOWN.has(id) ? g : ''))
    .replace(/ (pcb:[a-z]+|data-[a-z]+|xmlns:pcb)="[^"]*"/g, (a, name) => (kept.test(name) ? a : ''))
    .replace(/ width="[^"]*mm" height="[^"]*mm"/, '')
    .replace(/\n\s*\n/g, '\n')
}

/** The schematic in `--sch-*` variables, which the site's themes set, each symbol keeping its data-ref. */
export function schSvg(board) {
  const d = board.schematic.drawing
  const [x0, y0, x1, y1] = d.page
  const marked = schematicMarkup(d, board).replace(/(<g class="sch-sym"[^>]*?) data-ref=/g, '$1 sym-ref=')
  const markup = marked.replace(/ data-(?!net=)[a-z]+="[^"]*"/g, '').replace(/ sym-ref=/g, ' data-ref=')
  return coarse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" class="sch-board">\n<style>${schematicStyle()}</style>\n${markup}\n</svg>\n`)
}
