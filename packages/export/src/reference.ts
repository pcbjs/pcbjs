// Nothing here reaches the Gerbers or the fab set.
import type { Board, Pt, Ring } from '@pcbjs/core/model'
import type { BoardReference, SiteReference } from '@pcbjs/core/reference'

const f = (v: number) => String(Math.round(v * 1000) / 1000)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const ring = (r: Ring) => (r.length ? `M${r.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z` : '')

export function anchorText(r: BoardReference): string {
  if (r.anchor.kind === 'mate') return `${r.anchor.local} mates ${r.name} ${r.anchor.remote}, ${r.stack}${r.gap !== undefined ? `, gap ${f(r.gap)} mm` : ''}${r.rotate ? `, rotate ${f(r.rotate)}` : ''}`
  return `at ${r.anchor.at.map(f).join(' ')}${r.flip ? ', flipped' : ''}${r.rotate ? `, rotate ${f(r.rotate)}` : ''}`
}

// each outline and hole dashed, and the remote connector's pads as dashed rings
export function referenceMarkup(board: Board, layer: string): string {
  const out: string[] = []
  for (const r of board.references ?? []) {
    if (r.show.outline !== layer) continue
    const w = 0.12, dash = 'stroke-dasharray="0.8 0.5"'
    const parts: string[] = [`<path fill="none" stroke="currentColor" stroke-width="${w}" ${dash} d="${r.outline.map(ring).join('')}"/>`]
    for (const h of r.holes) parts.push(`<circle fill="none" stroke="currentColor" stroke-width="${w / 2}" ${dash} cx="${f(h.at[0])}" cy="${f(h.at[1])}" r="${f(h.d / 2)}"/>`)
    for (const m of r.mates ?? (r.mate ? [r.mate] : [])) for (const p of m.remote.pads) parts.push(`<circle fill="none" stroke="currentColor" stroke-width="${w}" stroke-dasharray="0.3 0.25" cx="${f(p.at[0])}" cy="${f(p.at[1])}" r="0.6"><title>${esc(`${r.name} ${m.remote.ref}.${p.num}`)}</title></circle>`)
    out.push(`<g data-kind="reference" data-reference="${esc(r.name)}" opacity="0.8"><title>${esc(`${r.title || r.name}: ${anchorText(r)}`)}</title>${parts.join('')}</g>`)
  }
  return out.join('\n')
}

// `page` is filled by the cli when the site has the other board
export function siteReferences(board: Board, rel: (file: string) => string): { references?: SiteReference[] } {
  const refs = board.references ?? []
  if (!refs.length) return {}
  return {
    references: refs.map(r => ({
      name: r.name, title: r.title, entry: rel(r.entry), ...(r.mesh ? { mesh: r.mesh } : {}), ...(r.split !== undefined ? { split: r.split } : {}),
      transform: [...r.transform], color: r.show.color, opacity: r.show.opacity, bodies: r.show.bodies, anchor: anchorText(r),
      outline: r.outline.map(ring => ring.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] as Pt)),
    })),
  }
}

export function referenceLayer(board: Board): { id: string; name: string; kind: string; side: string; color: string; order: number; svg: string }[] {
  if (!board.references?.length) return []
  return [{ id: 'References', name: `References: ${board.references.map(r => r.name).join(', ')}`, kind: 'reference', side: 'both', color: board.references[0].show.color, order: 10000, svg: '' }]
}

export type { Pt }
