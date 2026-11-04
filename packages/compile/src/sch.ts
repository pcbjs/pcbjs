// The schematic picture of a board: symbols placed by part elements and <Place> or packed by sch-place.ts, hand wires checked against the
// netlist, every other connection wired by the square router or labelled, then the sch-* findings. See docs/schematic-graphic.md.
import { gridPitch, isGrid, SCH_GRID } from '@pcbjs/core/internal/grid'
import { marker } from './messages.js'
import { pulse } from './cancel.js'
import type { Board, BoardSchematicPart, DrcMarker, Mat, Pad, Pt } from '@pcbjs/core/model'
import type { PcbNode, Src } from '@pcbjs/core/internal/types'
import type { SchDrawing, SchLabel, SchPin, SchSheetBox, SchSymbol, SchText, SchWire, PinSide } from '@pcbjs/core/internal/sch-model'
import { autoSymbol, isSymbol, textUnits, PIN_TEXT, type SymbolDef } from '@pcbjs/core/internal/sch-symbol'
import { childList, isNode } from '@pcbjs/core/jsx-runtime'
import { instanceOf, instancePath, partOf, pinOfPad, type PartState } from '@pcbjs/core/internal/part'
import { isPinRef, netInfo } from '@pcbjs/core/internal/nets'
import { mm } from '@pcbjs/core/internal/units'
import { CompileError } from './flatten.js'
import { dirOf, simplify, squareRoute, type SquareNet } from './sch-route.js'
import {
  apply,
  boxOf,
  extentOf,
  MARGIN,
  PAPERS,
  place,
  r6,
  SIDE_V,
  sideOf,
  symMatrix,
  textMode,
  TITLE,
  type Box,
  type PlaceItem,
  type PlaceOrder,
  type Sheet,
} from './sch-place.js'

const LABEL_OVER = 6
const LABEL_FAR = 40
/** Free page margin around everything drawn, grid units. */
const PAGE_MARGIN = 3
const SYM_PROPS = new Set(['at', 'rot', 'flip', 'symbol', '__src', 'key'])
const GROUND = /^(A|D|P|S|C)?GND\w*$|^GND[A-Z]?$|^VSS\w*$|^0V$|^V-$/i
const SUPPLY = /^(VCC|VDD|VEE|VBUS|VBAT|VIN|VSYS|VREG|VIO|VCORE|AVDD|DVDD|IOVDD)\w*$|^\+?\d+V\d*$|^\d+V\d+$|^V\d+V\d*$/i

interface Placed {
  part: BoardSchematicPart
  st?: PartState
  sym: SymbolDef
  at: Pt
  rot: number
  flip: boolean
  auto: boolean
  src?: Src
  items: Map<string, string[]>
}
interface HandWire {
  pts: Pt[]
  src?: Src
  net?: string
}
interface HandLabel {
  net: string
  at: Pt
  kind: SchLabel['kind']
  side?: PinSide
  src?: Src
}

const srcOf = (n: PcbNode): Src | undefined => {
  const s = n.props?.__src
  return s && typeof s === 'object' && typeof s.file === 'string' && typeof s.line === 'number'
    ? { file: s.file, line: s.line, col: s.col, ...(s.endLine ? { endLine: s.endLine, endCol: s.endCol } : {}) }
    : n.src
}
const key = (p: Pt) => `${p[0]},${p[1]}`

/** The symbol of a part: the placement's, its factory's, else the default by prefix and pin names. */
function symbolOf(part: BoardSchematicPart, st: PartState | undefined, own: unknown): SymbolDef {
  if (isSymbol(own)) return own
  const fp = st?.footprint as { symbol?: unknown; displayName?: string; name?: string } | undefined
  let s = fp?.symbol
  if (typeof s === 'function') s = s(st!.props)
  if (isSymbol(s)) return s
  return autoSymbol({ prefix: part.prefix, pins: part.pins.map(p => p.name), id: part.footprint, value: part.value, name: fp?.displayName || fp?.name })
}

/** A position in grid units, `"4 7"`. */
function gridAt(v: unknown, where: string): Pt {
  const t = typeof v === 'string' ? v.trim().split(/\s+/) : []
  if (t.length === 2 && t.every(x => /^[+-]?(\d+\.?\d*|\.\d+)$/.test(x))) return [parseFloat(t[0]), parseFloat(t[1])]
  throw new CompileError(`${where}: a position is "x y" in grid units, such as "4 7", got ${JSON.stringify(v)}`)
}
const snap = (p: Pt): Pt => [Math.round(p[0]), Math.round(p[1])]

/** The schematic pitch in mm: a number, or a grid's pitch; a schematic grid is a lattice, so it takes no origin, angle or frame. */
function schPitch(v: unknown, what: string, src?: Src): number {
  if (v === undefined) return gridPitch(SCH_GRID)
  if (typeof v === 'number' && v > 0) return v
  if (!isGrid(v)) throw new CompileError(`${what} is a pitch in mm such as 2.54, or a defineGrid grid, got ${JSON.stringify(v)}`, src)
  const extra = (['origin', 'angle', 'frame'] as const).filter(k => v.spec[k] !== undefined)
  if (extra.length) throw new CompileError(`${what}: the grid ${v.name} has ${extra.join(', ')}, which a schematic grid does not take`, src)
  return gridPitch(v)
}

/** A `<Sheet grid>`: how many schematic pitches one unit of it is, a whole number. */
function sheetScale(v: unknown, pitch: number, src?: Src): number {
  const own = schPitch(v, '<Sheet> grid', src)
  const k = own / pitch
  if (Math.abs(k - Math.round(k)) > 1e-9 || Math.round(k) < 1) throw new CompileError(`<Sheet> grid: its pitch ${own} mm is no whole multiple of the schematic's ${pitch} mm`, src)
  return Math.round(k)
}

/** The schematic of a compiled board, and its sch-* findings; `root` is the <Schematic> given to <PCB>, or none for an automatic one. */
export function compileSchematic(board: Board, partRefs: Map<PartState, string>, root?: unknown): { drawing: SchDrawing; findings: DrcMarker[] } {
  const findings: DrcMarker[] = []
  const node = root === undefined || root === null ? null : resolveRoot(root)
  const p = node?.props ?? {}
  const grid = schPitch(p.grid, '<Schematic> grid', node ? srcOf(node) : undefined)
  const labelOver = p.labelOver ?? LABEL_OVER
  if (!Number.isInteger(labelOver) || labelOver < 1) throw new CompileError(`<Schematic> labelOver must be a whole number of pins, got ${JSON.stringify(p.labelOver)}`)
  const sheet = sheetOf(p.sheet, node ? srcOf(node) : undefined)
  const autoRoute = p.route !== false
  const labelFar = p.labelFar ?? LABEL_FAR
  if (!(typeof labelFar === 'number' && labelFar > 0)) throw new CompileError(`<Schematic> labelFar must be a positive number of grid units, got ${JSON.stringify(p.labelFar)}`)

  const stOf = new Map<string, PartState>()
  for (const [st, ref] of partRefs) stOf.set(ref, st)
  // a logo or a bare hole has no pins, so nothing to draw
  const parts = board.schematic.parts.filter(x => (x.placed || x.displayRef) && x.pins.length)
  const byRef = new Map(parts.map(x => [x.ref, x]))
  const displayRefs = new Map(parts.flatMap(p => (p.displayRef ? [[p.ref, p.displayRef] as const] : [])))
  const displayNets = new Map(board.schematic.nets.flatMap(n => (n.displayName ? [[n.name, n.displayName] as const] : [])))
  const padsOf = new Map<string, Pad[]>()
  for (const it of board.items) if (it.kind === 'pad' && it.ref !== undefined) padsOf.set(it.ref, [...(padsOf.get(it.ref) ?? []), it])
  const idOf = new Map(board.items.flatMap(it => (it.uid ? [[it.uid, it.id] as const] : [])))
  const ids = (uids: string[]) => uids.flatMap(u => idOf.get(u) ?? [])
  const pinItems = (part: BoardSchematicPart, st?: PartState): Map<string, string[]> => {
    const out = new Map<string, string[]>()
    for (const pad of padsOf.get(part.ref) ?? []) {
      const pin = st ? pinOfPad(st.pins, pad) : pad.num
      if (pin !== null) out.set(pin, [...(out.get(pin) ?? []), ...(pad.uid ? [pad.uid] : [])])
    }
    return out
  }

  // the hand-written part of the picture
  const syms = new Map<string, { at: Pt; rot: number; flip: boolean; symbol?: unknown; src?: Src }>()
  const labels: HandLabel[] = []
  const texts: SchText[] = []
  const sheets: { name?: string; path: string[]; src?: Src }[] = []
  const wireNodes: { n: PcbNode; off: Pt; k: number }[] = []
  const placeSym = (st: PartState, q: Record<string, any>, tag: string, at: (where: string) => Pt, src?: Src) => {
    const ref = partRefs.get(st) ?? null
    const pos = snap(at(`<${tag}> at`))
    const rot = q.rot ?? 0
    if (![0, 90, 180, 270].includes(rot)) throw new CompileError(`<${tag}> rot must be 0, 90, 180 or 270, got ${JSON.stringify(q.rot)}`, src)
    if (ref === null || !byRef.has(ref)) {
      findings.push(
        marker({
          severity: 'warning',
          rule: 'sch-missing-symbol',
          args: { what: 'place', tag, part: ref ?? st.label },
          ...(ref !== null ? { refs: [ref] } : {}),
          at: [pos[0] * grid, pos[1] * grid],
          layer: 'sch',
          ...(src ? { src } : {}),
        }),
      )
      return
    }
    if (syms.has(ref)) throw new CompileError(`<${tag}> places ${ref} twice`, src)
    syms.set(ref, { at: pos, rot, flip: !!q.flip, symbol: q.symbol, ...(src ? { src } : {}) })
  }
  /** `k` schematic pitches per unit of the sheet's own grid */
  const walk = (c: unknown, off: Pt, depth: number, k = 1): void => {
    if (depth > 64 || c === null || c === undefined || typeof c === 'boolean') return
    const list = childList(c)
    if (list) {
      for (const x of list) walk(x, off, depth + 1, k)
      return
    }
    if (!isNode(c))
      throw new CompileError(`<Schematic> takes parts, <Place>, <Label>, <Power>, <Text>, <Sheet> and wire(), got ${typeof c === 'string' ? JSON.stringify(c) : typeof c}`)
    const q = c.props,
      src = srcOf(c)
    const at = (where: string) => {
      const g = gridAt(q.at, where)
      return [g[0] * k + off[0], g[1] * k + off[1]] as Pt
    }
    const st = partOf(c.type)
    if (st) {
      const tag = partRefs.get(st) ?? st.label,
        board = Object.keys(q).filter(k => !SYM_PROPS.has(k))
      if (board.length)
        throw new CompileError(
          `<${tag}> inside <Schematic> places its symbol and takes at, rot, flip and symbol; ${board.join(', ')} belong${board.length === 1 ? 's' : ''} to its placement on the board`,
          src,
        )
      placeSym(st, q, tag, at, src)
      return
    }
    if (typeof c.type === 'function') {
      const props = { ...c.props, ...(c.children.length ? { children: c.children.length === 1 ? c.children[0] : c.children } : {}) }
      walk((c.type as (p: unknown) => unknown)(props), off, depth + 1, k)
      return
    }
    switch (c.type) {
      case 'sch-label':
      case 'sch-power': {
        const name = netInfo(q.net)?.name
        if (!name) throw new CompileError(`<${c.type === 'sch-label' ? 'Label' : 'Power'}> needs a net`, src)
        const kind = c.type === 'sch-label' ? 'label' : (q.kind ?? (GROUND.test(name.split('/').pop()!) ? 'gnd' : 'vcc'))
        if (!['label', 'gnd', 'vcc'].includes(kind)) throw new CompileError(`<Power> kind must be 'gnd' or 'vcc', got ${JSON.stringify(q.kind)}`, src)
        const dir = q.dir === undefined ? undefined : ({ left: 'left', right: 'right', up: 'top', down: 'bottom' } as const)[q.dir as 'left']
        labels.push({ net: name, at: snap(at('<Label> at')), kind, ...(dir ? { side: dir } : {}), ...(src ? { src } : {}) })
        return
      }
      case 'sch-text': {
        const kids = c.children.length ? c.children : q.children !== undefined ? [q.children] : []
        texts.push({ text: kids.map(String).join(''), at: at('<Text> at').map(v => v * grid) as Pt, size: q.size ?? PIN_TEXT * 1.5, ...(src ? { src } : {}) })
        return
      }
      case 'sch-sheet': {
        const inst = instanceOf(q.group)
        const path = inst ? instancePath(inst) : Array.isArray(q.group?.path) ? q.group.path : null
        if (!path) throw new CompileError('<Sheet> group must be a circuit instance', src)
        sheets.push({ name: q.name, path: [...path], ...(src ? { src } : {}) })
        const o = q.at === undefined ? off : at('<Sheet> at')
        walk(c.children, o, depth + 1, q.grid === undefined ? k : sheetScale(q.grid, grid, src))
        return
      }
      case 'sch-wire':
        wireNodes.push({ n: c, off, k })
        return
      case 'sch':
        walk(c.children, off, depth + 1, k)
        return
      default:
        throw new CompileError(`<Schematic> cannot hold <${String(c.type)}>`, src)
    }
  }
  if (node) walk(node.children, [0, 0], 0)

  // symbols: hand placed, then the rest on a grid in declaration order
  const placed: Placed[] = []
  for (const [ref, s] of syms) {
    const part = byRef.get(ref)!,
      st = stOf.get(ref)
    placed.push({ part, st, sym: symbolOf(part, st, s.symbol), at: s.at, rot: s.rot, flip: s.flip, auto: false, ...(s.src ? { src: s.src } : {}), items: pinItems(part, st) })
  }
  const handBox = placed.length
    ? boxOf([
        ...placed.flatMap(x => {
          const e = extentOf(x.sym, symMatrix(x.at, x.rot, x.flip))
          return [
            [e[0], e[1]],
            [e[2], e[3]],
          ] as Pt[]
        }),
        ...labels.map(l => l.at),
        ...texts.map(t => [t.at[0] / grid, t.at[1] / grid] as Pt),
      ])
    : null
  const order = (part: BoardSchematicPart): number[] => {
    const st = stOf.get(part.ref)
    if (!st) return [Infinity]
    let top = st.seq
    for (let o = st.owner; o; o = o.parent ?? undefined) top = o.seq
    return [top, st.seq]
  }
  const cmp = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
    return a.length - b.length
  }
  const rest = parts.filter(x => !syms.has(x.ref)).sort((a, b) => cmp(order(a), order(b)) || (a.ref < b.ref ? -1 : 1))
  const classOf = new Map(board.schematic.nets.map(n => [n.name, n.class]))
  const ground = (net: string) => GROUND.test(net.split('/').pop()!)
  const power = (net: string) => classOf.get(net) === 'power' || ground(net) || SUPPLY.test(net.split('/').pop()!)
  const pinCount = new Map(board.schematic.nets.map(n => [n.name, n.pins.length]))
  const wired = (net: string) => !power(net) && (pinCount.get(net) ?? 0) >= 2 && (pinCount.get(net) ?? 0) <= labelOver
  const items: (PlaceItem & { part: BoardSchematicPart; st?: PartState })[] = rest.map((part, order) => {
    const st = stOf.get(part.ref)
    return {
      ref: part.ref,
      ...(part.displayRef ? { displayRef: part.displayRef } : {}),
      value: part.value,
      prefix: part.prefix,
      sym: symbolOf(part, st, undefined),
      pins: part.pins.map(q => ({ name: q.name, net: q.net })),
      path: part.path,
      order,
      part,
      st,
    }
  })
  const layout = (how: PlaceOrder): Placed[] => {
    const r = place({ items, power, ground, wired, fixed: handBox ? [handBox] : [], sheet, grid, order: how })
    return [
      ...placed,
      ...items.map(it => {
        const q = r.at.get(it.ref)!
        return { part: it.part, st: it.st, sym: it.sym, at: q.at, rot: q.rot, flip: q.flip, auto: true, items: pinItems(it.part, it.st) }
      }),
    ]
  }
  const runs = items.length ? (['pins', 'link', 'source'] as PlaceOrder[]).map(how => draw(layout(how))) : [draw(placed)]
  const rank = (d: SchDrawing) => [d.paper ? PAPERS.findIndex(x => x[0] === d.paper!.name) >>> 0 : 0, score(d)]
  const best = runs.reduce((a, b) => {
    const x = rank(a.drawing),
      y = rank(b.drawing)
    return y[0] < x[0] || (y[0] === x[0] && y[1] < x[1]) ? b : a
  })
  return { drawing: best.drawing, findings: [...findings, ...best.findings] }

  function draw(placed: Placed[]): { drawing: SchDrawing; findings: DrcMarker[] } {
    const findings: DrcMarker[] = []
    const wires: HandWire[] = []
    // pins on the sheet, in grid units
    interface Pin {
      ref: string
      name: string
      net: string | null
      nc: boolean
      end: Pt
      root: Pt
      side: PinSide
      items: string[]
    }
    const pinAt = new Map<string, Pin>()
    const pinOf = new Map<string, Pin>()
    const blocked: Pt[] = []
    const symbols: { p: Placed; m: Mat; pins: Pin[]; box: Box }[] = []
    for (const x of placed) {
      pulse()
      const m = symMatrix(x.at, x.rot, x.flip)
      const names = new Set(x.part.pins.map(q => q.name))
      for (const sp of x.sym.pins)
        if (!names.has(sp.name))
          findings.push(
            marker({
              severity: 'warning',
              rule: 'sch-missing-symbol',
              args: { what: 'extra', part: x.part.ref, pin: sp.name, pins: [...names] },
              refs: [x.part.ref],
              at: apply(symMatrix(x.at, x.rot, x.flip, grid), sp.end),
              layer: 'sch',
              ...(x.src ? { src: x.src } : {}),
            }),
          )
      const symNames = new Set(x.sym.pins.map(q => q.name))
      for (const q of x.part.pins)
        if (q.net !== null && !symNames.has(q.name))
          findings.push(
            marker({
              severity: 'warning',
              rule: 'sch-missing-symbol',
              args: { what: 'missing', part: x.part.ref, pin: q.name, net: q.net },
              refs: [x.part.ref, `net:${q.net}`],
              at: apply(symMatrix(x.at, x.rot, x.flip, grid), [0, 0]),
              layer: 'sch',
              items: ids(x.items.get(q.name) ?? []),
              ...(x.src ? { src: x.src } : {}),
            }),
          )
      const pins: Pin[] = []
      for (const sp of x.sym.pins) {
        const q = x.part.pins.find(z => z.name === sp.name)
        const v = SIDE_V[sp.side]
        const pin: Pin = {
          ref: x.part.ref,
          name: sp.name,
          net: q?.net ?? null,
          nc: !!q?.nc,
          end: apply(m, sp.end),
          root: apply(m, [sp.end[0] - v[0] * sp.length, sp.end[1] - v[1] * sp.length]),
          side: sideOf(m, sp.side),
          items: x.items.get(sp.name) ?? [],
        }
        pins.push(pin)
        pinOf.set(`${x.part.ref}.${sp.name}`, pin)
        if (Number.isInteger(pin.end[0]) && Number.isInteger(pin.end[1])) pinAt.set(key(pin.end), pin)
      }
      const b = x.sym.box,
        corners = [apply(m, [b[0], b[1]]), apply(m, [b[2], b[3]])]
      const box = boxOf(corners)
      for (let gx = Math.ceil(box[0] - 1e-9); gx <= Math.floor(box[2] + 1e-9); gx++)
        for (let gy = Math.ceil(box[1] - 1e-9); gy <= Math.floor(box[3] + 1e-9); gy++) blocked.push([gx, gy])
      for (const t of textPlace(x.sym, box, pins, x.part).cells) blocked.push(t)
      symbols.push({ p: x, m, pins, box })
    }
    for (let i = 0; i < symbols.length; i++)
      for (let j = i + 1; j < symbols.length; j++) {
        const a = symbols[i].box,
          b = symbols[j].box
        const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]),
          h = Math.min(a[3], b[3]) - Math.max(a[1], b[1])
        if (w > 1e-6 && h > 1e-6)
          findings.push(
            marker({
              severity: 'warning',
              rule: 'sch-overlap',
              args: { a: symbols[i].p.part.ref, b: symbols[j].p.part.ref },
              refs: [symbols[i].p.part.ref, symbols[j].p.part.ref],
              at: [(Math.max(a[0], b[0]) + w / 2) * grid, (Math.max(a[1], b[1]) + h / 2) * grid],
              layer: 'sch',
              ...((symbols[j].p.src ?? symbols[i].p.src) ? { src: symbols[j].p.src ?? symbols[i].p.src } : {}),
            }),
          )
      }

    // hand wires, resolved to points; a pin handle starts or ends at its pin end
    const pinEnd = (v: unknown, src?: Src): Pt => {
      if (isPinRef(v)) {
        const st = partOf(v.part),
          ref = st && partRefs.get(st)
        if (!st || !ref) throw new CompileError(`wire(): ${st?.label ?? 'a part'} is not on this board`, src)
        let name = v.pin
        if (v.pad !== undefined) {
          const pad = (padsOf.get(ref) ?? []).find(q => q.num === v.pad) ?? (padsOf.get(ref) ?? []).find(q => q.name === v.pad)
          name = (pad && pinOfPad(st.pins, pad)) ?? v.pad
        }
        const pin = pinOf.get(`${ref}.${name}`)
        if (!pin) throw new CompileError(`wire(): the symbol of ${ref} has no pin ${name}`, src)
        return pin.end
      }
      return snap(gridAt(v, 'wire()'))
    }
    for (const { n, off, k } of wireNodes) {
      const src = srcOf(n)
      const start = isPinRef(n.props.from) ? pinEnd(n.props.from, src) : snap([gridAt(n.props.from, 'wire()')[0] * k + off[0], gridAt(n.props.from, 'wire()')[1] * k + off[1]])
      const pts: Pt[] = [start]
      let cur = start
      for (const s of n.props.steps as { op: string; n?: number; x?: number; y?: number; to?: unknown }[]) {
        const next = (p: Pt) => {
          pts.push(snap(p))
          cur = pts.at(-1)!
        }
        switch (s.op) {
          case 'h':
            next([cur[0] + s.n! * k, cur[1]])
            break
          case 'v':
            next([cur[0], cur[1] + s.n! * k])
            break
          case 'H':
            next([s.n! * k + off[0], cur[1]])
            break
          case 'V':
            next([cur[0], s.n! * k + off[1]])
            break
          case 'l':
          case 'L': {
            const t: Pt = s.op === 'l' ? [cur[0] + s.x! * k, cur[1] + s.y! * k] : [s.x! * k + off[0], s.y! * k + off[1]]
            if (t[0] !== cur[0] && t[1] !== cur[1])
              throw new CompileError(`wire(): .${s.op}(${s.x}, ${s.y}) is not horizontal or vertical; a wire is square, use .h() and .v()`, src)
            next(t)
            break
          }
          case 'Z': {
            const t = isPinRef(s.to)
              ? pinEnd(s.to, src)
              : (() => {
                  const g = gridAt(s.to, 'wire().Z')
                  return snap([g[0] * k + off[0], g[1] * k + off[1]])
                })()
            if (t[0] !== cur[0] && t[1] !== cur[1]) next([t[0], cur[1]])
            next(t)
            break
          }
        }
      }
      const line = simplify(pts)
      if (line.length >= 2) wires.push({ pts: line, ...(src ? { src } : {}) })
    }

    // which net each hand wire carries: from the pins and labels on it, then from the wires it meets
    const onSeg = (p: Pt, a: Pt, b: Pt) =>
      a[0] === b[0] ? p[0] === a[0] && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]) : p[1] === a[1] && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0])
    const onWire = (p: Pt, w: { pts: Pt[] }) => w.pts.some((a, i) => i > 0 && onSeg(p, w.pts[i - 1], a))
    const labelAt = new Map<string, HandLabel[]>()
    for (const l of labels) labelAt.set(key(l.at), [...(labelAt.get(key(l.at)) ?? []), l])
    const parent = wires.map((_, i) => i)
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
    for (let i = 0; i < wires.length; i++)
      for (let j = 0; j < wires.length; j++) if (i !== j && (onWire(wires[i].pts[0], wires[j]) || onWire(wires[i].pts.at(-1)!, wires[j]))) parent[find(i)] = find(j)
    const groupNets = new Map<number, Map<string, string>>()
    wires.forEach((w, i) => {
      const g = find(i)
      const m = groupNets.get(g) ?? new Map<string, string>()
      groupNets.set(g, m)
      for (const pin of pinAt.values()) if (pin.net && onWire(pin.end, w)) m.set(pin.net, `${pin.ref}/${pin.name}`)
      for (const [k, ls] of labelAt) {
        const [x, y] = k.split(',').map(Number)
        if (onWire([x, y], w)) for (const l of ls) m.set(l.net, `label ${l.net}`)
      }
    })
    wires.forEach((w, i) => {
      const m = groupNets.get(find(i))!
      const nets = [...m.keys()]
      if (nets.length) w.net = nets[0]
      if ((nets.length > 1 && find(i) === i) || (nets.length > 1 && !wires.some((_, j) => j < i && find(j) === find(i)))) {
        const mid = w.pts[Math.floor(w.pts.length / 2)]
        findings.push(
          marker({
            severity: 'error',
            rule: 'sch-short',
            args: { joins: [...m.entries()].map(([n, by]) => `${n} at ${by}`) },
            refs: [...m.keys()].map(n => `net:${n}`),
            at: [mid[0] * grid, mid[1] * grid],
            layer: 'sch',
            items: ids([...pinAt.values()].filter(q => q.net && m.has(q.net) && wires.some((x, j) => find(j) === find(i) && onWire(q.end, x))).flatMap(q => q.items)),
            ...(w.src ? { src: w.src } : {}),
          }),
        )
      }
    })

    // nets: wired or labelled; a pin with a hand label or a hand wire is covered
    const netPins = new Map<string, Pin[]>()
    for (const s of symbols) for (const pin of s.pins) if (pin.net && !pin.nc) netPins.set(pin.net, [...(netPins.get(pin.net) ?? []), pin])
    const handLabelled = new Set(labels.map(l => l.net))
    const autoLabels: HandLabel[] = []
    const labelMode = new Set<string>()
    const routeNets: SquareNet[] = []
    const fixedOf = (net: string) => wires.filter(w => w.net === net).map(w => w.pts)
    if (autoRoute)
      for (const [net, pins] of netPins) {
        pulse()
        const xs = pins.map(q => q.end[0]),
          ys = pins.map(q => q.end[1])
        const far = Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys) > labelFar && !fixedOf(net).length
        if (power(net) || pins.length > labelOver || handLabelled.has(net) || pins.length < 2 || far) {
          labelMode.add(net)
          continue
        }
        routeNets.push({ net, pins: pins.map(q => ({ at: q.end, out: dirOf(q.side) })), fixed: fixedOf(net) })
      }
    const labelCells = (l: HandLabel): Pt[] => {
      const v = SIDE_V[l.side ?? 'right'],
        n = l.kind === 'label' ? Math.ceil(textUnits(displayNets.get(l.net) ?? l.net) + 1.2) : 2
      return Array.from({ length: n }, (_, i) => [l.at[0] + v[0] * (i + 1), l.at[1] + v[1] * (i + 1)] as Pt)
    }
    // the labels a net in label mode gets: one per pin, or per hand-wired group, that has none
    // adjacent pins of one side on one supply share a bar and one power symbol
    const bars = new Map<string, Pt[][]>()
    const labelNet = (net: string) => {
      const pins = netPins.get(net) ?? []
      const nodeWires = wires.filter(w => w.net === net)
      const done = new Set<string>()
      if (power(net))
        for (const run of runsOf(pins)) {
          bars.set(net, [...(bars.get(net) ?? []), [run[0].end, run.at(-1)!.end]])
          for (const q of run.slice(1)) done.add(key(q.end))
        }
      for (const pin of pins) {
        if (done.has(key(pin.end))) continue
        const group = new Set<string>([key(pin.end)])
        const ws = nodeWires.filter(w => onWire(pin.end, w))
        for (const w of ws) for (const q of pins) if (onWire(q.end, w)) group.add(key(q.end))
        for (const g of group) done.add(g)
        const has = [...group].some(g => labelAt.has(g)) || labels.some(l => l.net === net && ws.some(w => onWire(l.at, w)))
        if (has) continue
        const l: HandLabel = { net, at: pin.end, side: pin.side, kind: power(net) ? (GROUND.test(net.split('/').pop()!) ? 'gnd' : 'vcc') : 'label' }
        autoLabels.push(l)
      }
    }
    if (autoRoute) for (const net of labelMode) labelNet(net)

    const all = [...symbols.flatMap(s => [[s.box[0], s.box[1]], [s.box[2], s.box[3]], ...s.pins.map(q => q.end)] as Pt[]), ...wires.flatMap(w => w.pts), ...labels.map(l => l.at)]
    const content = all.length ? boxOf(all) : ([0, 0, 0, 0] as Box)
    // inside the paper's border, else around the content, past it by a margin
    const routeArea: Box =
      sheet === null
        ? [Math.floor(content[0]) - MARGIN, Math.floor(content[1]) - MARGIN, Math.ceil(content[2]) + MARGIN, Math.ceil(content[3]) + MARGIN]
        : [Math.min(2, Math.floor(content[0]) - 1), Math.min(2, Math.floor(content[1]) - 1), Math.ceil(content[2]) + MARGIN, Math.ceil(content[3]) + MARGIN]
    let rounds = 0,
      crossings = 0
    const autoWires = new Map<string, Pt[][]>()
    if (routeNets.length) {
      const fixedBlocks = () => [...blocked, ...[...labels, ...autoLabels].flatMap(labelCells).filter(c => !pinAt.has(key(c)))]
      let r = squareRoute({ area: routeArea, blocked: fixedBlocks(), nets: routeNets })
      if (r.failed.length) {
        // the nets that found no room take labels, whose cells the others route around in a second pass
        const failed = new Set(r.failed)
        for (const net of failed) {
          labelMode.add(net)
          labelNet(net)
        }
        r = squareRoute({ area: routeArea, blocked: fixedBlocks(), nets: routeNets.filter(n => !failed.has(n.net)) })
        for (const net of r.failed) {
          labelMode.add(net)
          labelNet(net)
        }
      }
      rounds = r.rounds
      crossings = r.crossings
      for (const [net, lines] of r.wires) autoWires.set(net, lines)
    }
    for (const [net, lines] of bars) autoWires.set(net, [...(autoWires.get(net) ?? []), ...lines])

    // the drawing, in mm
    const S = (p: Pt): Pt => [r6(p[0] * grid), r6(p[1] * grid)]
    let wn = 0,
      ln = 0
    const outWires: SchWire[] = [
      ...wires.map(w => ({ id: `wire:${++wn}`, net: w.net ?? '', pts: w.pts.map(S), auto: false, ...(w.src ? { src: w.src } : {}) })),
      ...[...autoWires].flatMap(([net, lines]) => lines.map(pts => ({ id: `wire:${++wn}`, net, pts: pts.map(S), auto: true }))),
    ]
    const outLabels: SchLabel[] = [...labels, ...autoLabels].map((l, i) => ({
      id: `label:${++ln}`,
      net: l.net,
      ...(displayNets.has(l.net) ? { displayName: displayNets.get(l.net)! } : {}),
      at: S(l.at),
      side: l.side ?? pinAt.get(key(l.at))?.side ?? 'right',
      kind: l.kind,
      auto: i >= labels.length,
      ...(l.src ? { src: l.src } : {}),
    }))

    // junctions: three or more wire ends, pins and labels at one point of a net
    const deg = new Map<string, { net: string; n: number; at: Pt }>()
    const bump = (net: string, p: Pt, by = 1) => {
      const k = `${net}|${key(p)}`
      const d = deg.get(k) ?? { net, n: 0, at: p }
      d.n += by
      deg.set(k, d)
    }
    const gridWires = [...wires.map(w => ({ net: w.net ?? '', pts: w.pts })), ...[...autoWires].flatMap(([net, lines]) => lines.map(pts => ({ net, pts })))]
    for (const w of gridWires) {
      bump(w.net, w.pts[0])
      bump(w.net, w.pts.at(-1)!)
      for (let i = 1; i < w.pts.length - 1; i++) bump(w.net, w.pts[i], 2)
    }
    // a wire end on the middle of another wire of its net is a tee
    for (const w of gridWires)
      for (const e of [w.pts[0], w.pts.at(-1)!])
        for (const o of gridWires) if (o !== w && o.net === w.net && onWire(e, o) && !o.pts.some(q => q[0] === e[0] && q[1] === e[1])) bump(w.net, e, 2)
    for (const pin of pinAt.values())
      if (pin.net) {
        const k = `${pin.net}|${key(pin.end)}`
        if (deg.has(k)) bump(pin.net, pin.end)
      }
    const junctions = [...deg.values()].filter(d => d.n >= 3).map(d => ({ net: d.net, at: S(d.at) }))

    // the checks: a wire end on nothing, a connected pin with neither a wire nor a label
    const ends = new Set<string>()
    for (const w of gridWires) for (const q of w.pts) ends.add(key(q))
    const anyLabelAt = new Set([...labels, ...autoLabels].map(l => key(l.at)))
    for (const w of wires)
      for (const e of [w.pts[0], w.pts.at(-1)!]) {
        const onPin = pinAt.has(key(e)),
          onLabel = anyLabelAt.has(key(e))
        const onOther = gridWires.some(o => o.pts !== w.pts && onWire(e, o)) || onWire(e, { pts: w.pts.slice(e === w.pts[0] ? 1 : 0, e === w.pts[0] ? undefined : -1) })
        if (!onPin && !onLabel && !onOther)
          findings.push(
            marker({
              severity: 'warning',
              rule: 'sch-dangling',
              args: { ...(w.net ? { net: w.net } : {}), at: [e[0], e[1]] },
              ...(w.net ? { refs: [`net:${w.net}`] } : {}),
              at: S(e),
              layer: 'sch',
              ...(w.net ? { net: w.net } : {}),
              ...(w.src ? { src: w.src } : {}),
            }),
          )
      }
    for (const l of labels)
      if (!pinAt.has(key(l.at)) && !gridWires.some(w => onWire(l.at, w)))
        findings.push(
          marker({
            severity: 'warning',
            rule: 'sch-dangling',
            args: { label: l.kind === 'label' ? 'label' : 'power symbol', net: l.net, at: [l.at[0], l.at[1]] },
            refs: [`net:${l.net}`],
            at: S(l.at),
            layer: 'sch',
            ...(l.src ? { src: l.src } : {}),
          }),
        )
    for (const [net, pins] of netPins)
      for (const pin of pins) {
        const covered = anyLabelAt.has(key(pin.end)) || gridWires.some(w => w.net === net && onWire(pin.end, w)) || wires.some(w => onWire(pin.end, w))
        if (!covered)
          findings.push(
            marker({
              severity: 'warning',
              rule: 'sch-unwired',
              args: { pin: `${pin.ref}/${pin.name}`, net },
              refs: [`net:${net}`],
              at: S(pin.end),
              layer: 'sch',
              items: ids(pin.items),
            }),
          )
      }

    // sheets: the hand ones, and in an automatic layout one per top-level instance of two or more symbols
    const outSheets: SchSheetBox[] = []
    const sheetBox = (path: string[], named = false): Box | null => {
      const mine = symbols.filter(s => path.every((x, i) => s.p.part.path[i] === x))
      if (!mine.length) return null
      const ends = new Set(mine.flatMap(s => s.pins.map(q => key(q.end))))
      const b = boxOf([
        ...mine.flatMap(s => [[s.box[0], s.box[1]], [s.box[2], s.box[3]], ...s.pins.map(q => q.end)] as Pt[]),
        ...[...labels, ...autoLabels].filter(l => ends.has(key(l.at))).flatMap(labelCells),
      ])
      return [b[0] - 1.5, b[1] - (named ? 2.5 : 1.5), b[2] + 1.5, b[3] + 2]
    }
    for (const s of sheets) {
      const b = sheetBox(s.path, true)
      if (b) outSheets.push({ name: s.name ?? s.path.join('/'), path: s.path, box: b.map(v => r6(v * grid)) as Box, auto: false, ...(s.src ? { src: s.src } : {}) })
    }
    const tops = new Set(placed.filter(x => x.auto && x.part.path.length).map(x => x.part.path[0]))
    for (const t of tops) {
      if (sheets.some(s => s.path[0] === t) || placed.filter(x => x.part.path[0] === t).length < 2 || placed.some(x => !x.auto && x.part.path[0] === t)) continue
      const b = sheetBox([t])
      if (b) outSheets.push({ name: t, path: [t], box: b.map(v => r6(v * grid)) as Box, auto: true })
    }

    const outSymbols: SchSymbol[] = symbols.map(({ p: x, m, pins, box }) => {
      const t = textPlace(x.sym, box, pins, x.part)
      return {
        ref: x.part.ref,
        ...(displayRefs.has(x.part.ref) ? { displayRef: displayRefs.get(x.part.ref)! } : {}),
        value: x.part.value,
        kind: x.sym.kind,
        at: S(x.at),
        rot: x.rot,
        flip: x.flip,
        m: symMatrix(x.at, x.rot, x.flip, grid),
        body: x.sym.body.map(b => ({ ...b })),
        box: box.map(v => r6(v * grid)) as Box,
        names: x.sym.names,
        refAt: S(t.ref),
        valueAt: S(t.value),
        auto: x.auto,
        path: [...x.part.path],
        items: [...x.items.values()].flat(),
        ...(x.src ? { src: x.src } : {}),
        pins: pins.map((q): SchPin => ({ name: q.name, net: q.net, nc: q.nc, end: S(q.end), root: S(q.root), side: q.side, items: q.items })),
      }
    })
    const noConnects = symbols.flatMap(s => s.pins.filter(q => q.nc).map(q => S(q.end)))

    const words = symbols.flatMap(({ p: x, pins, box }) => {
      const t = textPlace(x.sym, box, pins, x.part),
        h = PIN_TEXT / 2.54
      return [
        [t.ref[0], t.ref[1] - h],
        [t.ref[0] + textUnits(x.part.displayRef ?? x.part.ref), t.ref[1]],
        [t.value[0], t.value[1] - h],
        [t.value[0] + textUnits(x.part.value), t.value[1]],
      ] as Pt[]
    })
    const notes = texts.flatMap(
      t =>
        [
          [t.at[0] / grid, t.at[1] / grid - t.size / grid],
          [t.at[0] / grid + textUnits(t.text, t.size), t.at[1] / grid],
        ] as Pt[],
    )
    const extent = boxOf([
      ...all,
      ...words,
      ...notes,
      ...gridWires.flatMap(w => w.pts),
      ...[...labels, ...autoLabels].flatMap(labelCells),
      ...outSheets.flatMap(
        s =>
          [
            [s.box[0] / grid, s.box[1] / grid],
            [s.box[2] / grid, s.box[3] / grid],
          ] as Pt[],
      ),
    ])
    let paper: SchDrawing['paper']
    if (Array.isArray(sheet)) paper = { name: 'custom', w: sheet[0], h: sheet[1] }
    else if (sheet !== null) {
      const needW = (extent[2] + MARGIN) * grid,
        needH = (extent[3] + MARGIN) * grid
      const fit = PAPERS.slice(sheet).find(x => x[1] >= needW && x[2] >= needH + TITLE)
      paper = fit ? { name: fit[0], w: fit[1], h: fit[2] } : { name: 'custom', w: Math.ceil(needW / 10) * 10, h: Math.ceil((needH + TITLE) / 10) * 10 }
    }
    const page: Box = paper
      ? [0, 0, paper.w, paper.h]
      : ([Math.floor(extent[0]) - PAGE_MARGIN, Math.floor(extent[1]) - PAGE_MARGIN, Math.ceil(extent[2]) + PAGE_MARGIN, Math.ceil(extent[3]) + PAGE_MARGIN].map(v =>
          r6(v * grid),
        ) as Box)

    const segs = outWires.reduce((s, w) => s + w.pts.length - 1, 0)
    const drawing: SchDrawing = {
      grid,
      page,
      ...(paper ? { paper } : {}),
      title: String(p.title ?? board.title),
      symbols: outSymbols,
      wires: outWires,
      labels: outLabels,
      junctions,
      noConnects,
      sheets: outSheets,
      texts,
      stats: {
        symbols: outSymbols.length,
        wires: outWires.length,
        segments: segs,
        bends: segs - outWires.length,
        crossings,
        labels: outLabels.filter(l => l.kind === 'label').length,
        power: outLabels.filter(l => l.kind !== 'label').length,
        junctions: junctions.length,
        length: r6(outWires.reduce((s, w) => s + w.pts.reduce((t, q, i) => (i ? t + Math.abs(q[0] - w.pts[i - 1][0]) + Math.abs(q[1] - w.pts[i - 1][1]) : 0), 0), 0)),
        wired: new Set(outWires.map(w => w.net)).size,
        labelled: labelMode.size,
        rounds,
      },
    }
    return { drawing, findings }
  }
}

/** The `sheet` prop: null for the free page, a paper index to start from, or a fixed size in mm. */
function sheetOf(v: unknown, src?: Src): Sheet {
  if (v === undefined) return null
  if (typeof v === 'string') {
    const i = PAPERS.findIndex(x => x[0] === v)
    if (i >= 0) return i
  } else if (v && typeof v === 'object' && 'w' in v && 'h' in v) {
    let w = NaN,
      h = NaN
    try {
      w = mm((v as { w: number | string }).w)
      h = mm((v as { h: number | string }).h)
    } catch {
      /* reported below */
    }
    if (w > 0 && h > 0) return [w, h]
  }
  throw new CompileError(`<Schematic> sheet must be one of ${PAPERS.map(x => x[0]).join(', ')} or { w, h } in mm, got ${JSON.stringify(v)}`, src)
}

/** Lower is better: wire length in grid units, bends, crossings and labels, each weighted by how much it hurts reading. */
export const score = (d: SchDrawing) => d.stats.length / d.grid + 2 * d.stats.bends + 8 * d.stats.crossings + 4 * d.stats.labels

/** Runs of two or more pins of one symbol and side whose ends are one grid unit apart. */
function runsOf<T extends { ref: string; side: PinSide; end: Pt }>(pins: T[]): T[][] {
  const across = (p: T) => (p.side === 'top' || p.side === 'bottom' ? 0 : 1)
  const bySide = new Map<string, T[]>()
  for (const p of pins) {
    const k = `${p.ref}|${p.side}|${p.end[1 - across(p)]}`
    bySide.set(k, [...(bySide.get(k) ?? []), p])
  }
  const out: T[][] = []
  for (const list of bySide.values()) {
    const a = across(list[0])
    list.sort((u, v) => u.end[a] - v.end[a])
    let run: T[] = [list[0]]
    for (const p of [...list.slice(1), null]) {
      if (p && p.end[a] - run.at(-1)!.end[a] === 1) {
        run.push(p)
        continue
      }
      if (run.length > 1) out.push(run)
      if (p) run = [p]
    }
  }
  return out
}

/** The schematic element itself from what <PCB schematic> was given: the <Schematic> node or a component around it. */
function resolveRoot(v: unknown): PcbNode {
  let n = v
  for (let i = 0; i < 16 && isNode(n) && typeof n.type === 'function'; i++) {
    const c = n.children
    n = (n.type as (p: unknown) => unknown)({ ...n.props, ...(c.length ? { children: c.length === 1 ? c[0] : c } : {}) })
  }
  if (!isNode(n) || n.type !== 'sch') throw new CompileError('the drawing export of a schematic module is a <Schematic> element', isNode(v) ? srcOf(v) : undefined)
  return n
}

/** Where the ref and value of a symbol go, grid units, the start of the baseline, and the grid points they keep free of wires. */
function textPlace(
  sym: SymbolDef,
  box: Box,
  pins: { side: PinSide; end: Pt }[],
  part: Pick<BoardSchematicPart, 'ref' | 'displayRef' | 'value'>,
): { ref: Pt; value: Pt; cells: Pt[] } {
  const mode = textMode(sym, pins)
  const h = PIN_TEXT / 2.54
  const lr = textUnits(part.displayRef ?? part.ref),
    lv = textUnits(part.value)
  const ends = new Set(pins.map(q => key(q.end)))
  const cells: Pt[] = []
  const row = (y: number, xa: number, xb: number) => {
    for (let x = Math.floor(xa); x <= Math.ceil(xb); x++) if (!ends.has(key([x, y]))) cells.push([x, y])
  }
  if (mode === 'beside') {
    const y = Math.round((box[1] + box[3]) / 2)
    row(y, box[2] + 1, box[2] + 0.3 + Math.max(lr, lv))
    return { ref: [box[2] + 0.3, y - 0.12], value: [box[2] + 0.3, y + 0.12 + h], cells }
  }
  const up = Math.floor(box[1] - 1e-9),
    down = Math.ceil(box[3] + 1e-9)
  if (mode === 'over') {
    row(up, box[0], box[0] + Math.max(lr, lv))
    row(down, box[0], box[0] + Math.max(lr, lv))
    return { ref: [box[0], up - 0.2], value: [box[0], down + 0.2 + h], cells }
  }
  // a box: each word at a corner clear of the pins on that side, the ref above, the value below when they can be
  const xsOf = (side: PinSide) => pins.filter(q => q.side === side).map(q => q.end[0])
  const spots = [
    { side: 'top' as PinSide, x: (l: number) => box[0], y: box[1] - 0.25 },
    { side: 'top' as PinSide, x: (l: number) => box[2] - l, y: box[1] - 0.25 },
    { side: 'bottom' as PinSide, x: (l: number) => box[0], y: box[3] + 0.25 + h },
    { side: 'bottom' as PinSide, x: (l: number) => box[2] - l, y: box[3] + 0.25 + h },
  ]
  const free = (spot: (typeof spots)[number], l: number) => {
    const x = spot.x(l)
    return !xsOf(spot.side).some(px => px >= x - 0.3 && px <= x + l + 0.3)
  }
  const pick = (l: number, prefer: number[], taken?: (typeof spots)[number]) => prefer.map(i => spots[i]).find(sp => sp !== taken && free(sp, l)) ?? spots[prefer[0]]
  const rs = pick(lr, [0, 1, 2, 3])
  const vs = pick(lv, [2, 3, 0, 1], rs)
  const block = (sp: (typeof spots)[number], l: number) => {
    const x = sp.x(l),
      y = sp.side === 'top' ? Math.round(box[1]) : Math.round(box[3])
    if (x < box[0]) row(y, x, box[0] - 1)
    if (x + l > box[2]) row(y, box[2] + 1, x + l)
  }
  block(rs, lr)
  block(vs, lv)
  // two words on one corner: the value goes one line further out
  const vy = vs === rs ? (rs.side === 'top' ? rs.y - h - 0.3 : rs.y + h + 0.3) : vs.y
  return { ref: [rs.x(lr), rs.y], value: [vs.x(lv), vy], cells }
}
