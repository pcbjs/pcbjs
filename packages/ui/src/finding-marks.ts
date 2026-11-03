// Findings as the 2D and 3D views annotate them, free of Vue, three.js and the DOM: each finding's mark, computed by the compiler,
// says whether it is drawn as a line, a ratsnest line or a failed leg, as a marker at its spot on its layer, or not at all.
// Board mm, y down; screen layout in CSS pixels.
import type { SiteData, SiteFinding } from '@pcbjs/core/site-data'
import { refNet } from '@pcbjs/core/ref'

type Pt = [number, number]
export type Severity = SiteFinding['severity']
type Site = Pick<SiteData, 'drc' | 'erc' | 'ratsnest'>

/** A line the findings it carries are drawn as, instead of markers at its ends. */
export interface FindingLine {
  net: string
  from: Pt
  to: Pt
  /** its index in the board's ratsnest, null for a failed leg no ratsnest line coincides with */
  rats: number | null
  /** the worst first */
  findings: SiteFinding[]
  severity: Severity
}

/** One annotation: a marker at `at`, or a label at the middle of line `line`. */
export interface FindingNote {
  key: string
  id: string
  check: 'drc' | 'erc'
  rule: string
  severity: Severity
  at: Pt
  /** the layer whose explode offset it follows */
  layer: string
  side: 'F' | 'B'
  /** the index in findingLines(), set for a label on a line */
  line: number | null
  /** the label: the net after a broken-connection icon for `unconnected`, else the rule */
  text: string
  broken: boolean
}

const EPS = 1e-6
const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS
const sameSeg = (a: [Pt, Pt], b: [Pt, Pt]) => (same(a[0], b[0]) && same(a[1], b[1])) || (same(a[0], b[1]) && same(a[1], b[0]))
const netOf = (d: { refs?: readonly string[] }) => (d.refs ?? []).map(refNet).find(n => n !== null) ?? undefined

/** A finding's label: an `unconnected` one names its net behind a broken-connection icon, any other its rule. */
export function labelOf(d: Pick<SiteFinding, 'rule'> & { refs?: readonly string[] }): { text: string; broken: boolean } {
  const net = d.rule === 'unconnected' ? netOf(d) : undefined
  return net ? { text: net, broken: true } : { text: d.rule, broken: false }
}
/** The broken-connection icon in a 12 by 12 box: two stubs of a line with a gap between their slanted ends. */
export const BROKEN_ICON = 'M1 7.5h3.5l1-3M11 4.5H7.5l-1 3'

/** The worst severity of a list. */
export const worst = (list: readonly { severity: Severity }[]): Severity => list.reduce<Severity>((w, d) => (RANK[d.severity] < RANK[w] ? d.severity : w), 'info')

/** Where a finding is drawn, board mm: its dot, the middle of its line, else its own point; null for none. */
export function markAt(d: Pick<SiteFinding, 'mark' | 'at'>): Pt | null {
  const m = d.mark
  if (m && 'line' in m) return [(m.line[0][0] + m.line[1][0]) / 2, (m.line[0][1] + m.line[1][1]) / 2]
  return m ? [m.at[0], m.at[1]] : d.at
}

/** The DRC findings drawn as lines, by their marks: those on one ratsnest line together, a failed leg's own line apart, the same leg once. */
export function findingLines(site: Pick<SiteData, 'drc' | 'ratsnest'>): FindingLine[] {
  const lines: FindingLine[] = []
  for (const d of site.drc) {
    const m = d.mark
    if (!m || !('line' in m)) continue
    let l = m.rats !== null ? lines.find(x => x.rats === m.rats) : lines.find(x => x.rats === null && sameSeg([x.from, x.to], m.line))
    if (!l)
      lines.push((l = { net: m.rats !== null ? site.ratsnest[m.rats].net : (netOf(d) ?? ''), from: m.line[0], to: m.line[1], rats: m.rats, findings: [], severity: d.severity }))
    l.findings.push(d)
  }
  for (const l of lines) {
    l.findings.sort((a, b) => RANK[a.severity] - RANK[b.severity])
    l.severity = l.findings[0].severity
  }
  return lines
}

/** Every annotation of a board: a marker per finding whose mark is a point, a label per finding on a line. */
export function findingNotes(site: Site, lines: readonly FindingLine[] = findingLines(site)): FindingNote[] {
  const note = (d: SiteFinding, check: 'drc' | 'erc', k: number, at: Pt, layer: string, side: 'F' | 'B', line: number | null): FindingNote => ({
    key: `${check}:${k}`,
    id: d.id,
    check,
    rule: d.rule,
    severity: d.severity,
    at,
    layer,
    side,
    line,
    ...labelOf(d),
  })
  const out: FindingNote[] = []
  const dots = (check: 'drc' | 'erc') => (d: SiteFinding, k: number) => {
    const m = d.mark
    if (m && 'at' in m) out.push(note(d, check, k, [m.at[0], m.at[1]], m.layer, m.side, null))
  }
  site.drc.forEach(dots('drc'))
  lines.forEach((l, i) => {
    const mid: Pt = [(l.from[0] + l.to[0]) / 2, (l.from[1] + l.to[1]) / 2]
    for (const d of l.findings) out.push(note(d, 'drc', site.drc.indexOf(d), mid, 'F.Cu', 'F', i))
  })
  site.erc.forEach(dots('erc'))
  return out
}

/** A label to place on screen: its anchor, its size, and whether it centres on the anchor, as a line's does, or sits up and right of it. */
export interface LabelBox {
  at: Pt
  w: number
  h: number
  centre: boolean
}

/** Top-left corners of the labels: each `lift` px up and right of its anchor, or centred on it, moved up past the ones placed before it until none overlaps another by `gap` px. */
export function spread(boxes: readonly LabelBox[], lift: Pt, gap: number): Pt[] {
  const placed: { x: number; y: number; w: number; h: number }[] = []
  return boxes.map(b => {
    const x = b.centre ? b.at[0] - b.w / 2 : b.at[0] + lift[0]
    let y = b.centre ? b.at[1] - b.h / 2 : b.at[1] - lift[1] - b.h
    for (let moved = true, n = 0; moved && n <= placed.length; n++) {
      moved = false
      for (const p of placed)
        if (x < p.x + p.w + gap && p.x < x + b.w + gap && y < p.y + p.h + gap && p.y < y + b.h + gap) {
          y = p.y - b.h - gap
          moved = true
        }
    }
    placed.push({ x, y, w: b.w, h: b.h })
    return [x, y]
  })
}

/** What focuses a ratsnest label: the DRC tab open, the line under the pointer, the findings in focus or selected. */
export interface LabelFocus {
  review: boolean
  hover: number | null
  ids: ReadonlySet<string>
}

/** The lines whose labels show: all of them in the DRC tab, else only the hovered one, else those holding a focused or selected finding. */
export function shownLines(lines: readonly FindingLine[], f: LabelFocus): Set<number> {
  if (f.review) return new Set(lines.map((_, i) => i))
  if (f.hover !== null) return new Set([f.hover])
  return new Set(lines.flatMap((l, i) => (l.findings.some(d => !!d.id && f.ids.has(d.id)) ? [i] : [])))
}

/** Whether a note's label shows: a marker's always, a line's when its line does. */
export const noteShown = (n: Pick<FindingNote, 'line'>, shown: ReadonlySet<number>) => n.line === null || shown.has(n.line)

/** The ratsnest stroke: dashes with round caps, `dash` and `gap` line widths long; the plain width at the default fit, kept between a floor and a ceiling in CSS px; a finding line and the focused one wider by these ratios, each at its opacity. */
export const RATS = {
  fit: 1.2,
  floor: 0.8,
  ceiling: 2.5,
  /** how fast the width follows the zoom: 1 would be linear */
  grow: 0.4,
  dash: 3,
  gap: 2,
  /** the pointer target: the solid line under the dashes at the drawn width, never narrower than this */
  hit: 6,
  ratio: { plain: 1, finding: 1.5, focus: 2 },
  opacity: { plain: 0.75, finding: 0.9, focus: 1 },
} as const
export type RatsKind = keyof typeof RATS.ratio

/** The zoom the width follows: the board's larger side in screen px over the pane's smaller side, about 1 at the default fit. */
export const ratsZoom = (pxPerMm: number, boardMm: number, panePx: number) => (pxPerMm * boardMm) / Math.max(1, panePx)

/** A ratsnest line's width in CSS px at a zoom: the plain width grows with the zoom between the floor and the ceiling, then takes its kind's ratio. */
export function ratsWidth(kind: RatsKind, zoom: number): number {
  const plain = Math.min(RATS.ceiling, Math.max(RATS.floor, RATS.fit * Math.pow(Math.max(zoom, 1e-6), RATS.grow)))
  return plain * RATS.ratio[kind]
}

/** A finding drawn as a dot at its spot: every note not carried by a line, the worst drawn last so it lies on top. */
export function findingDots(notes: readonly FindingNote[]): FindingNote[] {
  return notes.filter(n => n.line === null).sort((a, b) => RANK[b.severity] - RANK[a.severity])
}

/** A dot's shape: a disc, a hollow ring for info, a diamond for an ERC finding on its pad or part. */
export type DotShape = 'disc' | 'ring' | 'diamond'
export const dotShape = (n: Pick<FindingNote, 'severity' | 'check'>): DotShape => (n.check === 'erc' ? 'diamond' : n.severity === 'info' ? 'ring' : 'disc')

/** A dot's diameter in CSS px at rest, under the pointer and in focus, and the opacity of a stale one. */
export const DOT = { size: 9, hover: 12, focus: 15, stale: 0.35, hit: 8 } as const

/** How a dot draws: its diameter in CSS px, its opacity, hidden outside an isolation. */
export function dotLook(s: { stale: boolean; focus: boolean; hover: boolean; out: boolean }): { size: number; alpha: number } {
  if (s.out) return { size: 0, alpha: 0 }
  return { size: s.focus ? DOT.focus : s.hover ? DOT.hover : DOT.size, alpha: s.stale ? DOT.stale : 1 }
}

/** The dot under a screen point: the nearest one whose centre lies within `r` px, the later on a tie, as it is drawn on top; `xy` packs each dot's screen x and y, NaN for one not drawn. */
export function dotUnder(xy: ArrayLike<number>, p: Pt, r: number): number | null {
  let best: number | null = null,
    dist = r * r
  for (let i = 0; i < xy.length / 2; i++) {
    const dx = xy[2 * i] - p[0],
      dy = xy[2 * i + 1] - p[1]
    const d = dx * dx + dy * dy
    if (d <= dist) {
      dist = d
      best = i
    }
  }
  return best
}

/** A finding hover names its rule; detailed messages belong in the details preview. */
export const dotTitle = (n: Pick<FindingNote, 'rule'>) => n.rule
