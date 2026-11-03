// The diff view of `pcbjs diff`: the board after faded, the changed copper of both sides over it tinted by change, and a
// pixel diff for the schematic and for boards whose items cannot be paired.
import type { Board } from '@pcbjs/core/model'
import { holesMarkup, layerMarkup, ringPath } from '@pcbjs/export/internal/svg'
import type { Change, ItemDiff } from './diff-match.js'
import { drawOrder, fitFrame, layers2d, mirrored, SUBSTRATE, svgOpen } from './flat.js'
import { THEME_COLORS, type RenderSpec } from './spec.js'
import type { Box } from './targets.js'
import type { Image } from './worker-client.js'

export const TINTS: Record<Change, string> = { removed: '#e5484d', added: '#30a46c', moved: '#f5a524' }
/** mm around both boards */
export const DIFF_MARGIN = 2
/** the unchanged board's opacity under the tints */
const BASE = 0.3
/** a moved item's old place, under its new one */
const WAS = 0.4

/** Both boards' boxes as one, so before, after and the diff share a frame. */
export function sharedBox(boards: (Board | null)[]): Box {
  const bs = boards.filter((b): b is Board => !!b).map(b => b.bbox)
  return [Math.min(...bs.map(b => b.x)), Math.min(...bs.map(b => b.y)), Math.max(...bs.map(b => b.x + b.w)), Math.max(...bs.map(b => b.y + b.h))]
}

const idOf = (line: string) => Number(/ data-id="(\d+)"/.exec(line)?.[1] ?? -1)

/** The changed items of one board on its shown copper, one group per change and layer. */
function tinted(board: Board, ids: Map<number, Change>, shown: string[], side: 'F' | 'B', opacity: (c: Change) => number): string[] {
  if (!ids.size) return []
  const out: string[] = []
  for (const l of drawOrder(board, shown, side).filter(l => l.kind === 'copper')) {
    const lines = layerMarkup(board, l.id).split('\n')
    for (const c of ['removed', 'moved', 'added'] as const) {
      const hit = lines.filter(line => ids.get(idOf(line)) === c)
      if (hit.length) out.push(`<g color="${TINTS[c]}" fill="currentColor" opacity="${opacity(c)}">\n${hit.join('\n')}\n</g>`)
    }
  }
  return out
}

/** The diff of two compiles of a board as SVG at the output size, framed by `box`. */
export function diffView(o: { before: Board | null; after: Board; diff: ItemDiff; spec: RenderSpec; box: Box; size: [number, number] }): string {
  const { after, spec, size } = o
  const c = THEME_COLORS[spec.theme ?? 'light']
  const side = spec.side ?? 'F'
  const fr = fitFrame(o.box, DIFF_MARGIN, size)
  const shown = layers2d(after, spec.layers)
  const base = drawOrder(after, shown, side).map(l => `<g color="${l.color}" fill="currentColor" opacity="${BASE}">\n${layerMarkup(after, l.id)}\n</g>`)
  const outline = after.outline.length ? `<path fill="${SUBSTRATE}" fill-rule="evenodd" d="${ringPath(after.outline)}"/>` : ''
  return [
    svgOpen(fr, size, c.canvas),
    `<g${mirrored(fr, !!spec.mirror)}>`,
    outline,
    ...base,
    ...(o.before ? tinted(o.before, o.diff.ids.before, shown, side, ch => (ch === 'moved' ? WAS : 1)) : []),
    ...tinted(after, o.diff.ids.after, shown, side, () => 1),
    `<g fill="${c.canvas}">\n${holesMarkup(after)}\n</g>`,
    '</g>',
    '</svg>',
  ].join('\n')
}

const hex = (s: string) => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16))

/** Two images of one size compared pixel by pixel: ink only before red, only after green, changed amber, the rest faded; `changed` counts pixels. */
export function pixelDiff(a: Image, b: Image, canvas: string): { image: Image; changed: number } {
  const bg = hex(canvas)
  const tint = { removed: hex(TINTS.removed), added: hex(TINTS.added), moved: hex(TINTS.moved) }
  const out = new Uint8Array(b.rgba.length)
  const near = (px: Uint8Array, i: number, q: number[]) => Math.abs(px[i] - q[0]) + Math.abs(px[i + 1] - q[1]) + Math.abs(px[i + 2] - q[2]) < 24
  let changed = 0
  for (let i = 0; i < out.length; i += 4) {
    const same = Math.abs(a.rgba[i] - b.rgba[i]) + Math.abs(a.rgba[i + 1] - b.rgba[i + 1]) + Math.abs(a.rgba[i + 2] - b.rgba[i + 2]) < 24
    const t = same ? null : near(a.rgba, i, bg) ? tint.added : near(b.rgba, i, bg) ? tint.removed : tint.moved
    if (t) changed++
    for (let k = 0; k < 3; k++) out[i + k] = t ? t[k] : Math.round(bg[k] + (b.rgba[i + k] - bg[k]) * BASE)
    out[i + 3] = 255
  }
  return { image: { rgba: out, width: b.width, height: b.height }, changed }
}
