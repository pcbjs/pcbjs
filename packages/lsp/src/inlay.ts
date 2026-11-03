// Inlay hints in three passes: the unit or grid of each bare number, the net after each pad reference, the width after each route call that names none.

import type { InlayHint } from 'vscode-languageserver/node.js'
import type { Range } from '@pcbjs/core/protocol'
import { toRange } from '@pcbjs/core/internal/textdoc'
import { formatNum } from '@pcbjs/core/internal/units'
import type { DocModel } from './doc.js'
import { itemsOf, type FileFacts } from './facts.js'
import { netLabel } from './format.js'
import { toUri } from './host.js'
import { gridLabel, gridTooltip, type UnitHint } from './units.js'

const HINT_TYPE = 1

/** The hints of the document within `range`. */
export function inlayHints(doc: DocModel, f: FileFacts, range: Range): InlayHint[] {
  const from = doc.offset(range.start)
  const to = doc.offset(range.end)
  return [...unitHints(doc, f, from, to), ...netHints(doc, f, from, to), ...widthHints(doc, f, from, to)]
}

function unitHints(doc: DocModel, f: FileFacts, from: number, to: number): InlayHint[] {
  return doc
    .units((l, c) => f.gridAt(l, c)?.grid ?? null)
    .hints.filter(h => h.offset >= from && h.offset <= to)
    .map(h => unitHint(doc, h))
}

function unitHint(doc: DocModel, h: UnitHint): InlayHint {
  const position = doc.pos(h.offset)
  if (!h.grid) return { position, label: h.unit }
  const [dot, glyph, pitch] = gridLabel(h.grid)
  const at = h.grid.at
  return {
    position,
    label: [
      { value: dot },
      {
        value: glyph,
        tooltip: gridTooltip(h.grid),
        ...(at ? { location: { uri: toUri(at.file), range: toRange({ line: at.line, col: at.col }) } } : {}),
      },
      { value: pitch },
    ],
  }
}

function netHints(doc: DocModel, f: FileFacts, from: number, to: number): InlayHint[] {
  const out: InlayHint[] = []
  for (const hit of doc.hits(f.helpers(doc))) {
    if (hit.kind !== 'pinRef' || hit.end < from || hit.start > to) continue
    const nets = f.padNets(hit.context.ref ?? '', hit.value)
    if (nets !== undefined) out.push({ position: doc.pos(hit.end + 1), label: netLabel(nets), kind: HINT_TYPE, paddingLeft: true })
  }
  return out
}

/** The track widths the router chose for a route call that names none, after its chain. */
function widthHints(doc: DocModel, f: FileFacts, from: number, to: number): InlayHint[] {
  const out: InlayHint[] = []
  for (const c of doc.routeCalls()) {
    if (c.hasWidth || c.chainEnd < from || c.start > to) continue
    const at = doc.site(c.start)
    const widths = new Set<number>()
    for (const b of f.boards) {
      const r = b.ranges.find(x => x.start[0] === at.line && x.start[1] === at.col && !x.seg)
      if (!r) continue
      const items = itemsOf(b.ref.site)
      for (const id of r.uids) {
        const it = items.get(id)
        if (it?.kind === 'track' && it.width !== undefined) widths.add(Math.round(it.width * 1e4) / 1e4)
      }
    }
    if (!widths.size) continue
    const label = [...widths]
      .sort((a, b) => a - b)
      .map(w => formatNum(w))
      .join(', ')
    out.push({ position: doc.pos(c.chainEnd), label: `width ${label} mm`, kind: HINT_TYPE, paddingLeft: true })
  }
  return out
}
