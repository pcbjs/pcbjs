import type { Board, Item, Pad, Prim, Ring } from '@pcbjs/core/model'
import { polysToRings } from '@pcbjs/compile/geom'
import { copperLayers } from '@pcbjs/compile/layers'
import { arcSweep, hasArc } from '@pcbjs/compile/path'
import { padMask, padPaste } from './pads.js'

const f = (v: number) => String(Math.round(v * 1e4) / 1e4)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;')

export function ringPath(rings: Ring[]): string {
  return rings.map(r => r.length ? 'M' + r.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z' : '').join('')
}
function polylinePath(pts: Ring): string {
  return 'M' + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')
}
// sweep flag 1 is clockwise on the y-down screen, as in Prim
function primsPath(prims: Prim[]): string {
  let s = `M${f(prims[0].from[0])} ${f(prims[0].from[1])}`
  for (const p of prims) {
    if (p.kind === 'line') { s += `L${f(p.to[0])} ${f(p.to[1])}`; continue }
    const r = Math.hypot(p.from[0] - p.center[0], p.from[1] - p.center[1])
    s += `A${f(r)} ${f(r)} 0 ${Math.abs(arcSweep(p)) > Math.PI ? 1 : 0} ${p.cw ? 1 : 0} ${f(p.to[0])} ${f(p.to[1])}`
  }
  return s
}
// the primitives when they hold an arc and run along the points, else the points
function pathOf(pts: Ring, prims: Prim[] | undefined, closed: boolean): string {
  const near = (a: Ring[number], b: Ring[number]) => Math.abs(a[0] - b[0]) <= 1e-6 && Math.abs(a[1] - b[1]) <= 1e-6
  const end = closed && pts.length ? pts[0] : pts[pts.length - 1]
  if (hasArc(prims) && pts.length && near(prims![0].from, pts[0]) && near(prims![prims!.length - 1].to, end)) return primsPath(prims!) + (closed ? 'Z' : '')
  return polylinePath(pts) + (closed ? 'Z' : '')
}
function attrs(it: Item): string {
  let s = ` data-id="${it.id}" data-kind="${it.kind}"`
  if (it.net) s += ` data-net="${esc(it.net)}"`
  if (it.ref) s += ` data-ref="${esc(it.ref)}"`
  return s
}

function padOn(p: Pad, layer: string, rules: Board['rules']): Ring[] | null {
  const side = layer.startsWith('F.') ? 'F' : layer.startsWith('B.') ? 'B' : null
  if (side && layer.endsWith('.Mask') && (p.maskRings || p.layers.includes(`${side}.Cu`))) return padMask(p, side, rules)
  if (side && layer.endsWith('.Paste') && p.layers.includes(`${side}.Cu`)) return padPaste(p, side, rules)
  return p.layers.includes(layer) ? [p.poly] : null
}

/** The markup of one layer in currentColor, without a wrapping element; `doc` adds the pcb: attributes. */
export function layerMarkup(board: Board, layer: string, doc = false): string {
  const out: string[] = []
  // zones first so everything else paints over them
  for (const it of board.items) {
    if (it.kind === 'zone' && it.layer === layer && it.fill.length)
      out.push(`<path${attrs(it)} fill-rule="evenodd" d="${ringPath(polysToRings(it.fill))}"/>`)
  }
  for (const it of board.items) {
    switch (it.kind) {
      case 'pad': { const r = padOn(it, layer, board.rules); if (r) out.push(`<path${attrs(it)} data-pad="${esc(it.num)}" d="${ringPath(r)}"/>`); break }
      case 'track': if (it.layer === layer) out.push(`<path${attrs(it)} fill="none" stroke="currentColor" stroke-width="${f(it.width)}" stroke-linecap="round" stroke-linejoin="round" d="${pathOf(it.pts, it.prims, false)}"/>`); break
      case 'via': if (spans(it.layers, layer, board)) out.push(`<circle${attrs(it)} cx="${f(it.at[0])}" cy="${f(it.at[1])}" r="${f(it.size / 2)}"/>`); break
      case 'graphic':
        if (it.layer !== layer) break
        if (it.fill) out.push(`<path${attrs(it)} fill-rule="evenodd" d="${it.prims ? it.paths.map((p, i) => p.length ? pathOf(p, it.prims![i], true) : '').join('') : ringPath(it.paths)}"/>`)
        else out.push(`<path${attrs(it)} fill="none" stroke="currentColor" stroke-width="${f(it.width)}" stroke-linecap="round" stroke-linejoin="round" d="${it.paths.map((p, i) => pathOf(p, it.prims?.[i], it.closed[i])).join('')}"/>`)
        break
      case 'text':
        if (it.layer !== layer) break
        // outline text: the filled glyphs, holes by the even-odd rule
        if (it.polys) { if (it.polys.length) out.push(`<path${attrs(it)}${doc ? ` pcb:text="${esc(it.text)}" pcb:font="${esc(it.font ?? '')}"` : ''} fill-rule="evenodd" d="${ringPath(polysToRings(it.polys))}"/>`); break }
        if (!it.strokes.length) break
        out.push(`<path${attrs(it)}${doc ? ` pcb:text="${esc(it.text)}"` : ''} fill="none" stroke="currentColor" stroke-width="${f(it.thickness)}" stroke-linecap="round" stroke-linejoin="round" d="${it.strokes.map(polylinePath).join('')}"/>`)
        break
    }
  }
  return out.join('\n')
}

function spans(ls: [string, string], layer: string, board: Board): boolean {
  const cu = copperLayers(board.copper)
  const a = cu.indexOf(ls[0]), b = cu.indexOf(ls[1]), i = cu.indexOf(layer)
  return i >= 0 && i >= Math.min(a, b) && i <= Math.max(a, b)
}

export function holesMarkup(board: Board): string {
  const out: string[] = []
  for (const it of board.items) {
    if (it.kind === 'via') out.push(`<circle data-id="${it.id}" data-kind="via" cx="${f(it.at[0])}" cy="${f(it.at[1])}" r="${f(it.drill / 2)}"/>`)
    else if (it.kind === 'pad' && it.drill) {
      const [w, h] = it.drill
      if (w === h) out.push(`<circle data-id="${it.id}" data-kind="pad" cx="${f(it.at[0])}" cy="${f(it.at[1])}" r="${f(w / 2)}"/>`)
      else out.push(`<rect data-id="${it.id}" data-kind="pad" x="${f(-w / 2)}" y="${f(-h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(Math.min(w, h) / 2)}" transform="translate(${f(it.at[0])} ${f(it.at[1])}) rotate(${f(-it.rot)})"/>`)
    }
  }
  return out.join('\n')
}

export function viewBox(board: Board, margin = 2): [number, number, number, number] {
  const b = board.bbox
  return [b.x - margin, b.y - margin, b.w + 2 * margin, b.h + 2 * margin]
}

export function boardSvg(board: Board): string {
  const vb = viewBox(board).map(f).join(' ')
  const layers = [...board.layers].sort((a, b) => a.order - b.order)
  const meta = [
    `<pcb:board name="${esc(board.name)}" title="${esc(board.title)}" revision="${esc(board.revision)}" copper="${board.copper}" thickness="${f(board.thickness)}" units="mm"/>`,
    `<pcb:rules ${Object.entries(board.rules).map(([k, v]) => `${k}="${v && typeof v === 'object' ? esc(JSON.stringify(v)) : v}"`).join(' ')}/>`,
    `<pcb:nets>${board.nets.map(n => `<pcb:net id="${n.id}" name="${esc(n.name)}"/>`).join('')}</pcb:nets>`,
    `<pcb:footprints>${board.footprints.map(fp => `<pcb:footprint ref="${esc(fp.ref)}" value="${esc(fp.value)}" id="${esc(fp.id)}" x="${f(fp.at[0])}" y="${f(fp.at[1])}" rot="${f(fp.rot)}" side="${fp.side}"${fp.bom ? '' : ' bom="false"'}/>`).join('')}</pcb:footprints>`,
    `<pcb:drc errors="${board.drc.filter(d => d.severity === 'error').length}" warnings="${board.drc.filter(d => d.severity === 'warning').length}" unconnected="${board.unconnected}"/>`,
  ].join('\n    ')
  const groups = layers.map(l => `  <g pcb:layer="${l.id}" id="layer-${l.id.replace('.', '_')}" color="${l.color}" fill="currentColor"${l.kind === 'copper' || l.kind === 'edge' ? '' : ' opacity="0.9"'}>\n${layerMarkup(board, l.id, true)}\n  </g>`)
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:pcb="https://pcb.svg/ns/1" viewBox="${vb}" width="${f(board.bbox.w + 4)}mm" height="${f(board.bbox.h + 4)}mm" style="background:#1b1f27">
  <metadata>
    ${meta}
  </metadata>
${groups.join('\n')}
  <g pcb:layer="holes" fill="#1b1f27">
${holesMarkup(board)}
  </g>
</svg>
`
}
