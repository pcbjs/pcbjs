// The gesture model of the board views, free of the DOM and three.js: the toolbar's tools for the anchor, a part drag, the rotation ring,
// control points and leg handles, the grid in effect and one transaction per drag; a move or a turn is a `Pose` each view draws, the 2D
// view through its elements and the 3D view through BoardScene.pose; the 3D view feeds it through tools3d.ts, see docs/editing.md.
import { computed, shallowRef, watch } from 'vue'
import { reachOf } from '@pcbjs/core/internal/instances'
import type { SiteData, SiteEditNode } from '@pcbjs/core/site-data'
import type { Selection } from '@pcbjs/core/internal/selection'
import { dragTxn, toolsOf, toolsWhy, type DragTxn } from './edit-client'
import type { EditUpdate, Tool, ToolId } from '@pcbjs/core/protocol'
import { cornersOf, siteTarget } from './refs'
import { alignedLevel, angleAt, dragMods, KEY_TURN, levelOf, MAGNET_PX, MM_GRID, onAxis, snapAngle, snapControl, snapFrom, snapPoint, stepOf, type SnapGrid } from './snap'
import { originDots } from './dots'
import { localPoint, worldPoint } from './edit-toolbar'
import { arcHit } from '@pcbjs/core/internal/trace-arc'
import { ringRadius, ringShape, type RingShape } from './ring'
import { deepKey } from './context'
import type { BoardStore } from './board-store'
import { drawnOf, editNodeOf, type Drawn } from './selection'
import { drawnPose, holdOf, holding, keyOfSite, type Hold } from './live'

type Pt = [number, number]
type Box = [number, number, number, number]
/** a press that moves this many pixels is a drag, else a click */
const DRAG_PX = 3
const GEOMETRIC = /^[LlHhVvAa]$/

export interface GestureInput {
  board: () => SiteData
  sel: () => Selection
  drawn: () => Drawn | null
  boardAt: (e: { clientX: number; clientY: number }) => Pt
  px: () => number
  vb: () => Box
  store: BoardStore
}

export interface Drag {
  kind: 'move' | 'ring' | 'pt' | 'leg' | 'track'
  start: Pt
  origin: Pt
  rot: number
  turn?: number
  heading?: number
  /** the parts and the items of no part the preview moves */
  parts: Set<string>
  ids: Set<number>
  anchor: string
  refs: string[]
  tool: ToolId
  txn: DragTxn | null
  x: number
  y: number
}

/** A move or a turn as drawn: `parts` and the items of no part `ids` moved by `delta` and turned by `angle` degrees about `origin`, counter-clockwise on screen. */
export interface Pose {
  parts: ReadonlySet<string>
  ids: ReadonlySet<number>
  origin: Pt
  delta: Pt
  angle: number
  /** per facet, whether the view draws the pose over what it draws: both during the drag, after the commit each until its facet draws the result */
  held: { meta: boolean; layers: boolean }
  /** committed, waiting for the compile that draws it, so drawn half-opaque */
  done: boolean
}

/** The distance from p to the segment ab. */
function toSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l2 = dx * dx + dy * dy
  const s = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
  return Math.hypot(a[0] + s * dx - p[0], a[1] + s * dy - p[1])
}

/** What a press landed on: a tool handle with its index, an item id, a part ref. */
export interface ToolHit {
  tool?: string | null
  k?: number
  id?: number | null
  ref?: string | null
}

export function useGesture(d: GestureInput) {
  const t = d.store.edit
  const on = computed(() => !!t.client && !!t.mode && !!d.board().dev)
  const current = computed(() => !Object.keys(d.store.invalid).length)
  const writable = computed(() => on.value && t.mode?.mode === 'rw' && !(d.board().variant && d.board().variant!.index !== 0))
  const rw = computed(() => current.value && writable.value)
  const node = computed<SiteEditNode | null>(() => editNodeOf(d.board(), d.sel().anchor))
  /** an isolation writes the definition, which a part with an own placement in the instance does not follow */
  const isolated = computed(() => (d.sel().isolate?.mode === 'instance' ? null : (d.sel().isolate?.ref ?? null)))
  const instanceWhy = (n: SiteEditNode | null) =>
    d.sel().isolate?.mode === 'instance' && n?.def && !n.layout && !n.owned && reachOf(d.board().schematic.circuits, n.def).length > 1
      ? 'this shared element has no instance override; choose Edit library layout'
      : null
  const tools = computed<Tool[]>(() => (writable.value && node.value ? toolsOf(node.value.caps).filter(tool => targets(tool.id).refs.length) : []))
  /** why the anchor takes no tools, said under the chip */
  const why = computed(() => {
    const a = d.sel().anchor
    if (!on.value) return null
    if (d.board().variant && d.board().variant!.index !== 0) return 'This target is read-only. Switch to the first target to edit.'
    if (!a) return null
    if (node.value?.locked) return 'Locked placement. Change locked in the source to edit it.'
    if (d.sel().refs.some(ref => editNodeOf(d.board(), ref)?.locked)) return 'Selection includes a locked placement.'
    if (tools.value.length) return null
    if (instanceWhy(node.value)) return instanceWhy(node.value)
    if (node.value?.auto?.length) return 'its at is automatic; write a placement in the source before editing'
    let kind: string | null = null
    try {
      kind = siteTarget(d.board(), a).kind
    } catch {}
    return toolsWhy(kind, node.value, t.mode, !!isolated.value)
  })
  const tool = computed<ToolId | null>(() => {
    const ids = tools.value.map(x => x.id)
    return t.tool && ids.includes(t.tool) ? t.tool : (ids[0] ?? null)
  })
  const gridPitch = shallowRef<number | null>(null)
  const snapOverride = shallowRef<boolean | null>(null)
  watch(
    () => node.value?.ref,
    () => {
      gridPitch.value = null
      snapOverride.value = null
    },
  )
  const originalGrid = computed(() => {
    const name = node.value?.grid ?? (t.assist?.board === d.board().name ? t.assist.grid : null)
    return name ? (d.board().grids?.find(g => g.name === name) ?? MM_GRID) : MM_GRID
  })
  const sourceGrid = computed<SnapGrid>(() => {
    const original = originalGrid.value,
      snap = node.value?.snap
    return snap ? { ...original, pitch: snap.pitch, ...(snap.maxLevel !== undefined ? { maxLevel: snap.maxLevel } : {}) } : original
  })
  const chosenGrid = computed<SnapGrid>(() => (gridPitch.value ? { ...sourceGrid.value, pitch: gridPitch.value } : sourceGrid.value))
  const alignment = computed(() => (node.value?.at ? alignedLevel(chosenGrid.value, [node.value.at[0], node.value.at[1]]) : 0))
  const snapEnabled = computed(() => snapOverride.value ?? alignment.value !== null)
  const paintGrid = computed<SnapGrid>(() => ({ ...chosenGrid.value, ...(alignment.value !== null ? { level: Math.max(levelOf(chosenGrid.value, false), alignment.value) } : {}) }))
  watch([() => node.value?.ref, () => sourceGrid.value.pitch, () => sourceGrid.value.maxLevel, () => sourceGrid.value.minor.join(',')], () => {
    snapOverride.value = null
  })
  const grid = computed<SnapGrid | null>(() => (snapEnabled.value ? paintGrid.value : null))
  /** the grid an editor hover lit, drawn as lines in its own frame */
  const shown = computed<SnapGrid | null>(() => (t.lit?.board === d.board().name ? (d.board().grids?.find(g => g.name === t.lit!.grid) ?? null) : null))
  const route = computed(() => (node.value?.caps.includes('chain') ? (d.board().routes?.find(r => r.id === node.value!.ref) ?? null) : null))

  /** The exact members sent to the session and drawn for a tool, excluding known non-writable placements. */
  const targets = (mode: ToolId) => {
    const needs = mode === 'point' ? 'chain' : mode === 'layer' ? 'layered' : 'placed'
    const refs = mode === 'point' ? [node.value?.ref].filter((r): r is string => !!r) : d.sel().refs
    if (refs.some(ref => editNodeOf(d.board(), ref)?.locked)) return { refs: [], anchor: null, parts: new Set<string>(), ids: new Set<number>(), pivot: [0, 0] as Pt, node: null }
    const nodes = [
      ...new Map(
        refs.flatMap(ref => {
          const n = editNodeOf(d.board(), ref)
          return n && !instanceWhy(n) && n.caps.includes(needs) && (mode === 'point' || (n.at && !n.auto?.length && !(isolated.value && n.owned))) ? [[n.ref, n] as const] : []
        }),
      ).values(),
    ]
    const members = nodes.map(n => n.ref)
    const drawn = drawnOf(d.board(), { ...d.sel(), refs: members, anchor: members.includes(node.value?.ref ?? '') ? node.value!.ref : (members[0] ?? null) })
    const poses = nodes.filter(n => n.at)
    const xs = poses.map(n => n.at![0]),
      ys = poses.map(n => n.at![1])
    const pivot: Pt =
      poses.length === 1 && poses[0].pivot ? poses[0].pivot : poses.length ? [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2] : [0, 0]
    const ids = new Set((d.board().items ?? []).filter(it => drawn.ids.has(it.id) && !it.ref).map(it => it.id))
    const anchor = members.includes(node.value?.ref ?? '') ? node.value!.ref : (members[0] ?? null)
    return { refs: members, anchor, node: nodes.find(n => n.ref === anchor) ?? null, parts: drawn.parts, ids, pivot }
  }
  const box = computed<Box | null>(() => {
    const { parts, ids } = targets('rotate')
    const boxes = d.board().footprints.flatMap(f => (parts?.has(f.ref) ? [[f.bbox.x, f.bbox.y, f.bbox.x + f.bbox.w, f.bbox.y + f.bbox.h]] : []))
    if (!boxes.length)
      for (const it of d.board().items ?? []) {
        if (!ids?.has(it.id) || it.ref) continue
        const ps = cornersOf(it).flat()
        if (ps.length) boxes.push([Math.min(...ps.map(p => p[0])), Math.min(...ps.map(p => p[1])), Math.max(...ps.map(p => p[0])), Math.max(...ps.map(p => p[1]))])
      }
    if (!boxes.length) return null
    const x0 = Math.min(...boxes.map(b => b[0])),
      y0 = Math.min(...boxes.map(b => b[1]))
    return [x0, y0, Math.max(...boxes.map(b => b[2])) - x0, Math.max(...boxes.map(b => b[3])) - y0]
  })
  // the ring uses the session's placement-origin midpoint for several members, otherwise the anchor origin
  const ring = computed<RingShape | null>(() => {
    const n = targets('rotate').node,
      b = box.value
    if (!rw.value || !n?.at || !n.caps.includes('placed') || !b || tool.value === 'point') return null
    const c = targets('rotate').pivot
    const p = poseAt([c[0], c[1], n.at[2]])
    return ringShape([p[0], p[1]], ringRadius(c, b, d.px()), p[2], grid.value?.angle ?? 0, d.px())
  })

  /** Each control point the tool can move, `pt:k`, and a handle at the middle of each automatic leg, `leg:k`. */
  const points = computed(() => {
    const n = node.value,
      r = route.value
    if (!rw.value || tool.value !== 'point' || !n?.steps || !r?.pts) return { pts: [], legs: [] }
    const pts: { k: number; at: Pt }[] = []
    const legs: { k: number; at: Pt }[] = []
    n.steps.forEach((s, j) => {
      const at = r.pts![j + 1]
      if (!at) return
      if (GEOMETRIC.test(s.op) || (s.op === 'X' && s.src && j < n.steps!.length - 1)) pts.push({ k: j + 1, at })
      if (s.op === 'X') {
        const a = r.pts![j]
        legs.push({ k: legs.length + 1, at: [(a[0] + at[0]) / 2, (a[1] + at[1]) / 2] })
      }
    })
    const moving = live.value?.at && drag.value ? drag.value.anchor : null
    const at = (ref: string, p: Pt) => (moving === ref ? live.value!.at! : p)
    return { pts: pts.map(p => ({ ...p, at: at(`${n.ref}/pt:${p.k}`, p.at) })), legs: legs.map(l => ({ ...l, at: at(`${n.ref}/leg:${l.k}`, l.at) })) }
  })

  /** The anchor's grid as dots through its own origin, where a move snaps to, over a box x0 y0 x1 y1; none while a grid is lit or with no grid. */
  const dotsOver = (box: Box) => {
    const n = node.value,
      g = paintGrid.value
    if (!rw.value || !g || shown.value || !n?.at || !n.caps.includes('placed') || tool.value === 'point') return []
    const p = poseAt(n.at),
      q = pose.value
    return originDots(g, g === MM_GRID ? [0, 0] : q && !q.done ? q.origin : [p[0], p[1]], box, d.px(), [p[0], p[1]])
  }
  const gridDots = computed(() => {
    const [x, y, w, h] = d.vb()
    return dotsOver([x, y, x + w, y + h])
  })

  // the grid an editor hover lit, its lines in its own frame around the view
  const gridLines = computed(() => {
    const g = shown.value
    if (!g) return null
    const s = stepOf(g, levelOf(g, false))
    const [x, y, w, h] = d.vb()
    const reach = Math.hypot(w, h)
    const c = [x + w / 2 - g.origin[0], y + h / 2 - g.origin[1]]
    const a = (g.angle * Math.PI) / 180
    const u0 = c[0] * Math.cos(a) - c[1] * Math.sin(a),
      v0 = c[0] * Math.sin(a) + c[1] * Math.cos(a)
    const lines = (step: number) => {
      if (step / d.px() < 4) return ''
      const n = Math.min(400, Math.ceil(reach / step))
      const cu = Math.round((g.mirror ? -u0 : u0) / step) * step,
        cv = Math.round(v0 / step) * step
      let p = ''
      for (let i = -n; i <= n; i++) p += `M${cu + i * step} ${cv - reach}V${cv + reach}M${cu - reach} ${cv + i * step}H${cu + reach}`
      return p
    }
    return { transform: `translate(${g.origin[0]} ${g.origin[1]}) rotate(${-g.angle}) scale(${g.mirror ? -1 : 1} 1)`, minor: lines(s), major: lines(g.pitch) }
  })

  const drag = shallowRef<Drag | null>(null)
  watch(
    () => drag.value?.refs.some(ref => editNodeOf(d.board(), ref)?.locked),
    locked => {
      if (locked) cancel()
    },
    { flush: 'sync' },
  )
  const live = shallowRef<(EditUpdate & { at?: Pt }) | null>(null)
  /** a committed move or turn, drawn where it went until the facets that draw the parts there arrive */
  const hold = shallowRef<{ g: Drag; u: EditUpdate; since: Hold } | null>(null)
  const liveBoard = () => d.store.held.get(keyOfSite(d.board()))
  /** per facet, whether it still draws the held parts where they were */
  const held = computed(() => {
    void d.store.rev
    const h = hold.value
    if (!h) return null
    const b = liveBoard()
    void d.board()
    return { meta: holding(b, h.since, 'meta'), layers: holding(b, h.since, 'layers') }
  })
  type Keys = { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }
  // the ring keeps its stops: shift 5 degrees, cmd or ctrl free
  const ringMods = (e: Keys) => ({ fine: e.shiftKey, free: deepKey(e) })

  const clearPreview = () => {
    hold.value = null
    live.value = null
  }
  // a committed pose ends once neither facet holds it
  watch(held, on => {
    if (hold.value && !on?.layers && !on?.meta) clearPreview()
  })
  const poseOf = (g: Drag, u: EditUpdate, held: Pose['held'], done: boolean): Pose => ({
    parts: g.parts,
    ids: g.ids,
    origin: g.origin,
    delta: u.delta ?? [0, 0],
    angle: u.angle ?? 0,
    held,
    done,
  })
  const LIVE = { meta: true, layers: true }
  /** what a move or a turn draws now: the drag's, else a committed one while a facet holds it */
  const pose = computed<Pose | null>(() => {
    const g = drag.value,
      u = live.value
    if (g) return u && (g.kind === 'move' || g.kind === 'ring') ? poseOf(g, u, LIVE, false) : null
    const h = hold.value,
      on = held.value
    return h && on && (on.meta || on.layers) ? poseOf(h.g, h.u, on, true) : null
  })
  /** Where the anchor is drawn from the edit node's own pose `at`, the one source of truth after a commit. */
  const poseAt = (at: [number, number, number]) => {
    const p = pose.value
    return drawnPose(at, p, !!p?.held.meta)
  }

  const begin = (tool: ToolId, refs: string[], anchor: string): DragTxn =>
    dragTxn(t.client!, { board: d.board().name, run: d.store.run, tool, refs, anchor, ...(isolated.value ? { isolate: isolated.value } : {}) }, p => {
      t.note = p.notes.join('; ') || null
    })
  const failed = (e: unknown) => d.store.note(String((e as Error)?.message ?? e), true)
  const finish = async (txn: DragTxn) => {
    try {
      const r = await txn.commit()
      if (r.error) {
        failed(r.error)
        clearPreview()
      } else if (r.written[0]) t.last = r.written[0].file
      else clearPreview()
      return r
    } catch (e) {
      failed(e)
      clearPreview()
    }
  }
  /** the control point a click picked, `pt:k`, which Delete removes */
  const focus = shallowRef<number | null>(null)
  watch(node, () => (focus.value = null))
  const waitForSteps = (ref: string, count: number): Promise<boolean> => {
    const ready = () => current.value && node.value?.ref === ref && node.value.steps?.length === count
    if (ready()) return Promise.resolve(true)
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        stop()
        resolve(false)
      }, 10000)
      const stop = watch([() => node.value, current], () => {
        if (ready()) {
          clearTimeout(timer)
          stop()
          resolve(true)
        }
      })
    })
  }
  /** One step at once: `R`, the side, a deleted or inserted point: a begin, an update and a commit. */
  const oneShot = (tool: ToolId, u: EditUpdate, anchor?: string) => {
    const n = node.value
    if (!rw.value || !n) return
    const affected = targets(tool)
    if (!affected.anchor) return
    const txn = begin(tool, affected.refs, tool === 'point' ? (anchor ?? n.ref) : affected.anchor)
    txn.started.catch(failed)
    txn.update(u)
    return finish(txn)
  }

  function down(e: PointerEvent, hit: ToolHit): boolean {
    const n = node.value
    if (!rw.value || !n || e.button !== 0) return false
    if (n.locked || d.sel().refs.some(ref => editNodeOf(d.board(), ref)?.locked)) return false
    const kind = hit.tool
    const start = d.boardAt(e)
    const affected = targets(kind === 'ring' ? 'rotate' : 'move')
    const origin: Pt = kind === 'ring' ? affected.pivot : affected.node?.at ? [affected.node.at[0], affected.node.at[1]] : start
    const base = { start, origin, rot: affected.node?.at?.[2] ?? n.at?.[2] ?? 0, x: e.clientX, y: e.clientY, txn: null, ids: new Set<number>() }
    if (kind === 'ring') {
      if (!affected.refs.length) return false
      drag.value = { ...base, kind: 'ring', parts: affected.parts, ids: affected.ids, anchor: affected.anchor!, refs: affected.refs, tool: 'rotate' }
    } else if (kind === 'pt' || kind === 'leg') {
      // a control point locks to an axis through where it is, a leg handle through the press
      const own = kind === 'pt' ? route.value?.pts?.[hit.k ?? -1] : undefined
      drag.value = { ...base, kind, origin: own ? [own[0], own[1]] : start, parts: new Set(), anchor: `${n.ref}/${kind}:${hit.k}`, refs: [n.ref], tool: 'point' }
    } else if (tool.value === 'point') {
      if (hit.id == null || d.board().items?.find(it => it.id === hit.id)?.route !== n.ref) return false
      const focused = /\/pt:(\d+)$/.exec(d.sel().anchor ?? '')
      if (!focused) return false
      const j = +focused[1] - 1,
        pts = route.value?.pts
      if (!pts?.[j + 1] || !/^[LlHhVvAaZ]$/.test(n.steps?.[j]?.op ?? '')) return false
      const a = pts[j],
        b = pts[j + 1],
        length = Math.hypot(b[0] - a[0], b[1] - a[1])
      const curved = /^[Aa]$/.test(n.steps![j].op)
      const arc = curved ? arcHit(localPoint(n.m, a), localPoint(n.m, b), n.steps![j].angle ?? 0, localPoint(n.m, start)) : null
      const distance = arc ? arc.distance * Math.hypot(n.m[0], n.m[1]) : toSegment(start, a, b)
      if (
        (curved && !arc) ||
        distance > MAGNET_PX * d.px() ||
        Math.min(Math.hypot(start[0] - a[0], start[1] - a[1]), Math.hypot(start[0] - b[0], start[1] - b[1])) < Math.min(length / 4, MAGNET_PX * d.px())
      )
        return false
      drag.value = { ...base, kind: 'track', origin: start, parts: new Set(), anchor: n.ref, refs: [n.ref], tool: 'point' }
    } else if (tool.value === 'move' && n.caps.includes('placed')) {
      const own = affected.ids
      if (!affected.refs.length || (!(hit.ref && affected.parts.has(hit.ref)) && !(hit.id != null && own.has(hit.id)))) return false
      drag.value = { ...base, kind: 'move', parts: affected.parts, ids: own, anchor: affected.anchor!, refs: affected.refs, tool: 'move' }
    } else return false
    if (hold.value) clearPreview()
    return true
  }

  function move(e: PointerEvent): boolean {
    const g = drag.value
    if (!g) return false
    if (!g.txn) {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) <= DRAG_PX || g.kind === 'track') return true
      g.txn = begin(g.tool, g.refs, g.anchor)
      g.txn.started.catch(e => {
        failed(e)
        cancel()
      })
      t.dragging = true
    }
    const p = d.boardAt(e)
    const m = dragMods(e.shiftKey, deepKey(e))
    let u: EditUpdate & { at?: Pt }
    if (g.kind === 'move') {
      const raw: Pt = [g.origin[0] + p[0] - g.start[0], g.origin[1] + p[1] - g.start[1]]
      const to = originalGrid.value === MM_GRID ? snapPoint(grid.value, raw, m) : snapFrom(grid.value, g.origin, raw, m)
      const at = m.axis ? onAxis(g.origin, to) : to
      u = { delta: [at[0] - g.origin[0], at[1] - g.origin[1]], free: m.free || !snapEnabled.value }
    } else if (g.kind === 'ring') {
      const r = ringMods(e)
      const heading = angleAt(g.origin, p)
      const previous = g.heading ?? angleAt(g.origin, g.start)
      g.turn = (g.turn ?? 0) + (((heading - previous + 540) % 360) - 180)
      g.heading = heading
      u = { angle: snapAngle(g.turn, r, g.rot, grid.value?.angle ?? 0), free: r.free }
    } else {
      const to = snapControl(grid.value, p, m, magnets(), MAGNET_PX * d.px())
      const at = m.axis ? onAxis(g.origin, to) : to
      u = { point: { at }, at, free: m.free || !snapEnabled.value }
    }
    live.value = u
    const { at: _, ...wire } = u
    g.txn.update(wire)
    return true
  }

  /** 'drag' when a drag ended, 'click' when the press never moved, null when the tools had no press. */
  function up(): 'drag' | 'click' | null {
    const g = drag.value
    if (!g) return null
    drag.value = null
    t.dragging = false
    if (!g.txn && g.kind === 'pt') {
      focus.value = Number(g.anchor.split(':').pop())
      return 'drag'
    }
    if (!g.txn && g.kind === 'track') {
      insertAt(g.start)
      return 'drag'
    }
    if (!g.txn) return 'click'
    if ((g.kind === 'move' || g.kind === 'ring') && live.value) hold.value = { g, u: live.value, since: holdOf(liveBoard()) }
    void finish(g.txn)
    return 'drag'
  }

  /** A click on the route's own copper puts a control point there, after the nearest drawn segment's start. */
  function insertAt(p: Pt): void {
    const n = node.value,
      pts = route.value?.pts
    if (!n?.steps || !pts) return
    const selected = /\/pt:(\d+)$/.exec(d.sel().anchor ?? '')
    let best = -1,
      dist = Infinity
    n.steps.forEach((s, j) => {
      if (!/^[LlHhVvAaZ]$/.test(s.op) || !pts[j + 1] || (selected && j !== +selected[1] - 1)) return
      const arc = /^[Aa]$/.test(s.op) ? arcHit(localPoint(n.m, pts[j]), localPoint(n.m, pts[j + 1]), s.angle ?? 0, localPoint(n.m, p)) : null
      const e = arc ? arc.distance * Math.hypot(n.m[0], n.m[1]) : toSegment(p, pts[j], pts[j + 1])
      if (e < dist) {
        dist = e
        best = j
      }
    })
    if (best < 0) return
    let at = snapControl(grid.value, p, { fine: false, free: false }, magnets(), MAGNET_PX * d.px())
    if (/^[Aa]$/.test(n.steps[best].op) && !snapEnabled.value) {
      const arc = arcHit(localPoint(n.m, pts[best]), localPoint(n.m, pts[best + 1]), n.steps[best].angle ?? 0, localPoint(n.m, p))
      if (!arc) return
      at = worldPoint(n.m, arc.point)
    }
    const local = localPoint(n.m, at),
      start = localPoint(n.m, pts[best])
    if (/^[Hh]$/.test(n.steps[best].op)) local[1] = start[1]
    if (/^[Vv]$/.test(n.steps[best].op)) local[0] = start[0]
    at = worldPoint(n.m, local)
    if (Math.hypot(at[0] - pts[best][0], at[1] - pts[best][1]) < 1e-6 || Math.hypot(at[0] - pts[best + 1][0], at[1] - pts[best + 1][1]) < 1e-6) return
    const endpoint = best + 2,
      count = n.steps.length
    void oneShot('point', { point: { at }, insert: true }, `${n.ref}/pt:${best}`)?.then(async result => {
      if (!result?.written.some(w => w.applied) || !(await waitForSteps(n.ref, count + 1))) return
      const anchor = `${n.ref}/pt:${endpoint}`
      d.store.setSel({ ...d.sel(), refs: [anchor], anchor })
    })
    focus.value = best + 1
  }

  function cancel(): void {
    const g = drag.value
    drag.value = null
    t.dragging = false
    clearPreview()
    void g?.txn?.cancel()
  }

  /** Pad centres and the route's own points, where a control point lands before the grid. */
  const magnets = (): Pt[] => {
    const net = d.board().routes?.find(r => r.id === node.value?.ref)?.net
    const pads = d.board().footprints.flatMap(f => f.pads.filter(p => !net || p.net === net).map(p => p.at))
    const own = (route.value?.pts ?? []).filter((_, i) => drag.value?.anchor !== `${node.value?.ref}/pt:${i}`)
    return [...pads, ...own]
  }

  /** The tools' commands of the key map, `move`, `rotate`, `side` and `points`, `up` during a drag and `delete`; true when taken. */
  function command(id: string): boolean {
    if (id === 'up' && drag.value) {
      cancel()
      return true
    }
    const n = node.value
    if (!rw.value || !n) return false
    if (id === 'delete' && focus.value !== null && tool.value === 'point') {
      oneShot('point', { remove: true }, `${n.ref}/pt:${focus.value}`)
      focus.value = null
      return true
    }
    const has = (tid: ToolId) => tools.value.some(x => x.id === tid)
    if (id === 'move' && has('move')) t.tool = 'move'
    else if (id === 'points' && has('point')) t.tool = 'point'
    else if (id === 'rotate' && has('rotate')) oneShot('rotate', { angle: KEY_TURN })
    else if (id === 'side' && has('layer')) oneShot('layer', { side: targets('layer').node?.side === 'B' ? 'F' : 'B' })
    else return false
    return true
  }

  const banner = computed(() => (!rw.value || !node.value || t.mode?.editor ? null : 'No editor attached: tools write to disk'))
  return {
    on,
    rw,
    node,
    tools,
    targets,
    why,
    tool,
    grid,
    paintGrid,
    gridPitch,
    sourceGrid,
    snapOverride,
    snapEnabled,
    shown,
    route,
    ring,
    points,
    gridLines,
    gridDots,
    dotsOver,
    banner,
    focus,
    drag,
    live,
    pose,
    down,
    move,
    up,
    cancel,
    command,
    oneShot,
    waitForSteps,
    pick: (id: ToolId) => (t.tool = id),
  }
}
