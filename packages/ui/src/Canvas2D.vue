<script setup lang="ts">
import { displayRef } from './refs'
import Bubble from './Bubble.vue'
// every length here is in mm, the unit of the view box
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import type { SiteData } from '@pcbjs/core/site-data'
import { injectPane, modsOf, useCommands } from './context'
import type { Focus } from './pane'
import { commandOf } from './source'
import { EASE_OUT_CSS } from './scene/motion'
import { useViewBox, type Box } from './viewbox'
import { focusTransaction, type FocusKind } from './focus-transaction'
import { routeHover } from './routes'
import { setReady } from './ready'
import { gridPaths, gridStep } from './grid'
import { drawOrder, type Side } from './sides'
import { keyOfSite, sketchIds, type Stale } from './live'
import { applyMat, boxThrough, invertMat, type Drawn, type Hit, type IsolationView, type Mods, type Selection } from './selection'
import { hoverLit, paintOf, useHover } from './paint'
import { Paint2d } from './paint2d'
import { boardIndex } from './scene/index'
import { overlay, type Layer2d } from './hl2d'
import { useGesture, type Pose, type ToolHit } from './gesture'
import EditBar from './EditBar.vue'
import { STEPS, useAssist2d } from './assist2d'
import { dotPaths } from './dots'
import { polyPath } from './ring'
import { endLines } from './ends'
import { connections, line2 } from './indicators'
import {
  BROKEN_ICON,
  DOT,
  dotShape,
  dotTitle,
  dotUnder,
  findingDots,
  findingLines,
  findingNotes,
  labelOf,
  RATS,
  ratsWidth,
  ratsZoom,
  shownLines,
  type FindingNote,
} from './finding-marks'

const props = defineProps<{
  board: SiteData
  hidden: Set<string>
  focus: Focus | null
  /** the side drawn on top */
  side: Side
  /** mirrored horizontally, to read the back as seen from behind */
  mirror: boolean
  sel: Selection
  /** what the selection draws on this board */
  drawn: Drawn | null
  /** the focus fade: what is neither selected nor context fades */
  fade?: boolean
  /** what an isolation shows; the rest hidden, or faded for a single instance */
  iso?: IsolationView | null
  /** a net and parts hovered in a side panel, lit as a hover */
  hoverNet?: string | null
  hoverRefs?: readonly string[]
  /** the finding in focus, ringed */
  finding?: string | null
  /** the DRC tab is open: every ratsnest line shows its label */
  review?: boolean
  /** a part to frame at once, as ?select= asks */
  frameRef?: string | null
  /** an area to frame in board mm, x, y, width and height, when no part is framed */
  frameArea?: [number, number, number, number] | null
  /** shown beside the schematic, which owns the ready mark */
  beside?: boolean
  /** what the last edit made stale: drawn half-opaque, never hovered or selected, until its stage ends */
  stale?: Stale
}>()
const emit = defineEmits<{
  pick: [Hit | null, Mods]
  /** a finding's marker or line clicked, by exact id */
  finding: [string, Mods]
  enter: [Hit | null]
  'update:side': [Side]
  'update:mirror': [boolean]
}>()

const ctx = injectPane()!
const { board: store, pane, prefs } = ctx
const toggleGrid = () => ctx.toggle('grid')
const toggleRatsnest = () => ctx.toggle('ratsnest')
// the site item of an element, for the route and the width of a track
const itemOfEl = (el: SVGElement | null) => (el?.dataset.id ? (boardIndex(props.board).item(+el.dataset.id) ?? null) : null)
const host = ref<HTMLDivElement | null>(null)
const svg = ref<SVGSVGElement | null>(null)
const content = ref<SVGGElement | null>(null)
const hl = ref<SVGGElement | null>(null)
const hv = ref<SVGGElement | null>(null)

// the last frame of each board is kept outside the component, so switching boards or a hot reload of this file keeps the zoom
type FocusView = { box: Box; size?: [number, number]; frameKey: string; focusN?: number }
let viewScope = keyOfSite(props.board)
const legacy = pane.focusViews.size === 0 ? pane.viewport['2d'] : undefined
const transaction = () => focusTransaction<FocusView>(pane.focusViews, viewScope, '2d')
const remembered = transaction().current()
const restored = remembered?.box ?? legacy ?? null
let frameKey = remembered?.frameKey ?? ''
let focusN = remembered?.focusN
const snapshot = (): FocusView => ({ box: [...vb.value] as Box, size: [size.value.w, size.value.h], frameKey, focusN })
const { size, vb, px, fitBox, animateTo, stopAnimation, show, zoomBy, toView, onWheel, resize, press, pan, release, panning } = useViewBox(
  svg,
  (restored ?? props.board.viewBox) as Box,
  () => props.board.viewBox[2] * 20,
)
watch(vb, v => {
  pane.viewport['2d'] = v
})
const vbStr = computed(() => vb.value.map(v => +v.toFixed(5)).join(' '))

// the mirror flips x about the centre of the board's view box, so fit gives the same frame in both orientations
const cx = computed(() => props.board.viewBox[0] + props.board.viewBox[2] / 2)
const mirrorX = (x: number) => (props.mirror ? 2 * cx.value - x : x)
// an isolation draws the board in its definition's frame: shown = frame⁻¹ · board
const unframe = computed(() => (props.iso?.frame ? invertMat(props.iso.frame) : null))
const transform = computed(
  () => [props.mirror ? `translate(${2 * cx.value} 0) scale(-1 1)` : '', unframe.value ? `matrix(${unframe.value.join(' ')})` : ''].filter(Boolean).join(' ') || undefined,
)
/** A board point where the view shows it. */
const shownAt = (p: [number, number]): [number, number] => {
  const q = unframe.value ? applyMat(unframe.value, p) : p
  return [mirrorX(q[0]), q[1]]
}

const ordered = computed(() => drawOrder(props.board.layers, props.side))
const layerColor = computed(() => new Map(props.board.layers.map(l => [l.id, l.color])))

// hard keepouts in the layer's colour muted halfway to grey
const uid = useId()
const muted = (c: string) => `color-mix(in srgb, ${c} 50%, #8a8f98)`
const keepoutLayers = computed(() => [...new Set((props.board.keepouts ?? []).flatMap(k => k.layers))])
const hatchId = (layer: string) => `ko-${uid}-${keepoutLayers.value.indexOf(layer)}`
const keepouts = computed(() =>
  (props.board.keepouts ?? []).flatMap((k, i) => {
    const d = k.outline.map(r => 'M' + r.map(p => p.join(' ')).join('L') + 'Z').join('')
    const forbids = [k.tracks && 'tracks', k.vias && 'vias', k.pours && 'pours'].filter(Boolean).join(', ')
    return k.layers.map(layer => ({
      key: `${i}:${layer}`,
      layer,
      d,
      color: muted(layerColor.value.get(layer) ?? '#8a8f98'),
      title: `keepout on ${layer}${k.ref ? ` of ${k.ref}` : ''}: no ${forbids || 'copper'}`,
    }))
  }),
)
// a finding whose evidence is a ratsnest line or a failed leg is drawn as that line, labelled at its middle; the rest are dots
const findLines = computed(() => findingLines(props.board))
const ratsFound = computed(() => new Set(findLines.value.flatMap(l => (l.rats === null ? [] : [l.rats]))))
const notes = computed(() => findingNotes(props.board, findLines.value))
const isStale = (id: string) => !!id && !!props.stale?.findings.has(id)
const isOut = (id: string) => !!props.iso && !(id && props.iso.findings.has(id))
// the dots as one layer: a path per look, each dot a zero-length stroke with a round cap, a short diagonal with a square one for a diamond,
// so a zoom never redraws them; the dot in focus and the one under the pointer drawn again on top
const dots = computed(() => findingDots(notes.value).filter(n => !isOut(n.id)))
const dotXY = computed(() => dots.value.flatMap(n => [mirrorX(n.at[0]), n.at[1]]))
const dotHover = ref<number | null>(null)
const dotTipAt = ref<[number, number] | null>(null)
const dotD = (n: FindingNote) => (dotShape(n) === 'diamond' ? `M${n.at[0]} ${n.at[1]}l0.0001 0.0001` : `M${n.at[0]} ${n.at[1]}h0`)
const findingPaths = computed(() => {
  const by = new Map<string, { cls: string[]; d: string }>()
  for (const n of dots.value) {
    const shape = dotShape(n)
    const k = `${n.severity} ${shape}${isStale(n.id) ? ' stale' : ''}`
    let g = by.get(k)
    if (!g) by.set(k, (g = { cls: k.split(' '), d: '' }))
    g.d += dotD(n)
  }
  return [...by.entries()].map(([key, g]) => ({ key, ...g }))
})
/** The dots drawn larger on top: the one in focus and the one under the pointer. */
const dotsOn = computed(() => {
  const out: { key: string; cls: string[]; d: string }[] = []
  dots.value.forEach((n, i) => {
    const focus = !!n.id && n.id === props.finding
    if (focus || i === dotHover.value) out.push({ key: n.key, cls: [n.severity, dotShape(n), focus ? 'focus' : 'on'], d: dotD(n) })
  })
  return out
})
const dotTip = computed(() => {
  const n = dotHover.value === null ? null : dots.value[dotHover.value]
  return n ? { text: dotTitle(n), severity: n.severity } : null
})
/** The dot under the pointer, one test on the set in board mm. */
function dotAt(e: { clientX: number; clientY: number }): number | null {
  const [x, y] = toView(e)
  return dotUnder(dotXY.value, [x, y], DOT.hit * px.value)
}
// a line's label shows in the DRC tab, else only on the line hovered, or the one holding the focused or selected finding
const hoverLine = ref<number | null>(null)
// the ratsnest widths for this zoom: plain, carrying a finding, focused
const ratsVars = computed(() => {
  const z = ratsZoom(1 / px.value, Math.max(props.board.viewBox[2], props.board.viewBox[3]), Math.min(size.value.w || 800, size.value.h || 600))
  return { '--rw': ratsWidth('plain', z) + 'px', '--rf': ratsWidth('finding', z) + 'px', '--rx': ratsWidth('focus', z) + 'px', '--rh': RATS.hit + 'px' }
})
const shown = computed(() => shownLines(findLines.value, { review: !!props.review, hover: hoverLine.value, ids: new Set([props.finding ?? '', ...props.sel.refs]) }))
/** A label in screen px from its left end: the icon, then the text in 11 px mono, about 6.6 px a character. */
const labelRow = (d: { rule: string; net?: string; refs?: string[] }) => {
  const l = labelOf(d)
  const icon = l.broken ? 15 : 0
  return { ...l, start: -(icon + l.text.length * 6.6) / 2, icon }
}
const labelAt = (l: { from: [number, number]; to: [number, number] }, k: number, n: number) => {
  const x = (l.from[0] + l.to[0]) / 2,
    y = (l.from[1] + l.to[1]) / 2 - px.value * (5 + 13 * (n - 1 - k))
  return `translate(${x} ${y})${props.mirror ? ' scale(-1 1)' : ''}`
}
const lineClass = (l: { findings: { id?: string }[]; severity: string }) => {
  const ids = l.findings.map(d => d.id ?? '')
  return [l.severity, { stale: ids.every(isStale), focus: !!props.finding && ids.includes(props.finding), 'iso-out': ids.every(isOut) }]
}

function fit(animate = true) {
  show(props.board.viewBox as Box, animate)
}

// the editing tools for the selection's anchor, with the grid it is placed on
const tl = useGesture({
  board: () => props.board,
  sel: () => props.sel,
  drawn: () => props.drawn,
  boardAt: e => boardAt(e),
  px: () => px.value,
  vb: () => vb.value,
  store,
})
// the assist mode while the editor cursor waits for an argument: the dot field, the preview and the pick
const as = useAssist2d({ board: () => props.board, px: () => px.value, mirror: () => props.mirror, store, grid: () => tl.grid.value, visualGrid: () => tl.paintGrid.value })
// a route end slot shows the ratsnest whatever the toggle, the first end's net lit and the other lines dimmed
const endLit = computed(() => (as.ends.value ? endLines(props.board, as.ends.value) : null))
const chipAt = ref<[number, number] | null>(null)
const layerOf = (id: string) => layerColor.value.get(id) ?? 'var(--accent)'
// the chip beside the pointer, on its left in the right half so it stays in view; at the top left while only typing feeds it
const chipStyle = computed(() => {
  const c = chipAt.value
  return c ? { x: c[0], y: c[1] } : { x: 8, y: 78 }
})
const stepOpacity = (i: number) => (i + 1) / STEPS
// the ring's ticks and heading as paths
const ringTicks = computed(() => {
  const r = tl.ring.value
  if (!r) return { minor: '', major: '', tri: '' }
  const of = (major: boolean) => polyPath(r.ticks.filter(t => t.major === major).map(t => t.quad))
  return { minor: of(false), major: of(true), tri: polyPath([r.tri]) }
})
// the anchor's grid as dots through its origin, in the assist's dot style
const gridDotPaths = computed(() => dotPaths(tl.gridDots.value, px.value * 2.2, STEPS))
const polyPts = (pts: [number, number][]) => pts.map(p => p.join(' ')).join(' ')
const crossAt = (c: [number, number], s: number) => `M${c[0] - s * 14} ${c[1]}h${s * 10}m${s * 8} 0h${s * 10}M${c[0]} ${c[1] - s * 14}v${s * 10}m0 ${s * 8}v${s * 10}`
// the selection's unrouted connections, active side on top: a line from the start layer's colour to the end's, a mark at each end
const links = computed(() =>
  prefs.ratsnest
    ? connections(props.board, props.drawn, props.side === 'B' ? 'B' : 'F')
        .map(c => line2(c, props.side === 'B' ? 'B' : 'F'))
        .filter(l => inDefinition(l.from) && inDefinition(l.to))
    : [],
)
/** Whether a board point is inside what an isolation without the board shows, so a connection to the board is left out. */
function inDefinition(p: readonly [number, number]): boolean {
  const iso = props.iso
  const b = iso?.frame && !iso.fade ? iso.boardBox : null
  return !b || (p[0] >= b[0] - 0.5 && p[0] <= b[0] + b[2] + 0.5 && p[1] >= b[1] - 0.5 && p[1] <= b[1] + b[3] + 0.5)
}
const gradId = (i: number) => `link-${uid}-${i}`
// the grid sits in the view's own frame; mirrored, the board's x = 0 lands at twice the centre; an entity grid takes its place
const grid = computed(() =>
  prefs.grid && size.value.w && !tl.gridLines.value ? gridPaths(vb.value, px.value, gridStep(1 / px.value), [props.mirror ? 2 * cx.value : 0, 0]) : null,
)
const substrate = computed(() => props.board.outline.map(r => 'M' + r.map(p => p.join(' ')).join('L') + 'Z').join(''))

let ro: ResizeObserver | null = null
// the ready signal: two frames after the view is shown at a size, the layer SVG and the overlay are in the DOM and painted
let readyRaf = 0
function signalReady() {
  cancelAnimationFrame(readyRaf)
  readyRaf = requestAnimationFrame(() => {
    readyRaf = requestAnimationFrame(() => {
      readyRaf = 0
      if (!props.beside && host.value?.offsetParent && content.value?.querySelector('g.layer')) setReady('2d', host.value)
    })
  })
}
onBeforeUnmount(() => cancelAnimationFrame(readyRaf))
onMounted(() => {
  ro = new ResizeObserver(([entry]) => {
    const { width: w, height: h } = entry.contentRect
    if (!w || !h) return // not laid out yet
    const prev = size.value
    signalReady()
    if (!prev.w) {
      size.value = { w, h }
      stopAnimation()
      vb.value = remembered ? savedBox(remembered) : fitBox(restored ?? props.board.viewBox as Box)
      syncFocus()
      return
    }
    resize(w, h)
  })
  ro.observe(host.value!)
  window.addEventListener('keydown', as.mods)
  window.addEventListener('keyup', as.mods)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('keydown', as.mods)
  window.removeEventListener('keyup', as.mods)
})

/** The view box of frameRef: the part's courtyard, else its extent, grown by a third of its size and at least 1.5 mm a side; else frameArea as given. */
function frameBox(): Box | null {
  const fp = props.frameRef ? props.board.footprints.find(f => f.ref === props.frameRef) : undefined
  const a = props.frameArea
  if (!fp && a) return [props.mirror ? 2 * cx.value - (a[0] + a[2]) : a[0], a[1], a[2], a[3]]
  if (!fp) return null
  const raw = fp.bbox ?? { x: fp.at[0], y: fp.at[1], w: 0, h: 0 }
  const [bx, by, bw, bh] = unframe.value ? boxThrough(unframe.value, [raw.x, raw.y, raw.w, raw.h]) : [raw.x, raw.y, raw.w, raw.h]
  const m = Math.max(1.5, Math.max(bw, bh) / 3)
  const x = props.mirror ? 2 * cx.value - (bx + bw) : bx
  return [x - m, by - m, bw + 2 * m, bh + 2 * m]
}
// another target or an update of the board: drawn again once the new SVG is in
watch(
  () => props.board,
  () => signalReady(),
  { flush: 'post' },
)
function savedBox(saved: FocusView): Box {
  const { w, h } = size.value
  if (!saved.size?.[0] || !w || !h) return fitBox(saved.box)
  if (saved.size[0] === w && saved.size[1] === h) return [...saved.box] as Box
  const [x, y, width, height] = saved.box
  const scale = width / saved.size[0]
  return [x + width / 2 - w * scale / 2, y + height / 2 - h * scale / 2, w * scale, h * scale]
}
function restoreFocus(saved: FocusView) {
  stopAnimation()
  vb.value = savedBox(saved)
  frameKey = saved.frameKey
  focusN = saved.focusN
  pulse.value = null
  signalReady()
}
function syncFocus() {
  if (!size.value.w) return
  const scope = keyOfSite(props.board)
  if (scope !== viewScope) {
    transaction().save(snapshot())
    stopAnimation()
    viewScope = scope
    const saved = transaction().current()
    vb.value = saved ? savedBox(saved) : fitBox(props.board.viewBox as Box)
    frameKey = saved?.frameKey ?? ''
    focusN = saved?.focusN
  }
  const tx = transaction()
  const box = frameBox()
  const f = props.focus
  const finding = !!store.sel.finding && !!f
  const active: FocusKind[] = [...(box || props.iso || (f && !finding) ? ['frame' as const] : []), ...(finding ? ['finding' as const] : [])]
  tx.cancel(active)
  const rollback = tx.takeRestore()
  if (rollback) restoreFocus(rollback)
  const nextFrame = JSON.stringify([props.frameRef, props.frameArea, props.iso?.box, props.iso?.frame])
  const changedFrame = !!box && nextFrame !== frameKey
  if (box && changedFrame) {
    tx.cancel(['frame'])
    const before = tx.takeRestore()
    if (before) restoreFocus(before)
    tx.begin('frame', snapshot())
    stopAnimation()
    vb.value = fitBox(box)
    signalReady()
  }
  frameKey = nextFrame
  if (f && (f.n !== focusN || (finding && changedFrame))) {
    tx.begin(finding ? 'finding' : 'frame', snapshot())
    const side = Math.max(f.r * 4, 6)
    const at = shownAt(f.at)
    animateTo(fitBox([at[0] - side / 2, at[1] - side / 2, side, side]))
    if (f.pulse) pulse.value = { at: f.at, n: f.n }
  }
  focusN = f?.n
}
watch(() => [keyOfSite(props.board), props.frameRef, props.frameArea, props.iso?.box, props.iso?.frame, props.focus?.n, store.sel.finding], syncFocus)
onBeforeUnmount(() => {
  transaction().save(snapshot())
  stopAnimation()
})

// the key map's commands while this view shows: fit and zoom, then the tools and the assist mode
const shownNow = () => !!host.value?.offsetParent
const viewCommand = (fn: () => void) => () => {
  if (!shownNow()) return false
  fn()
  return true
}
const toolCommand = (id: string) => () => shownNow() && tl.command(id)
useCommands(ctx.commands, {
  fit: viewCommand(() => fit()),
  zoomIn: viewCommand(() => zoomBy(1 / 1.25)),
  zoomOut: viewCommand(() => zoomBy(1.25)),
  up: () => shownNow() && (tl.command('up') || as.leaveMode()),
  ...Object.fromEntries(['move', 'rotate', 'side', 'points', 'delete'].map(id => [id, toolCommand(id)])),
})

// pointer: a press that moves more than a few pixels pans, otherwise it is a click
type Kind = 'pad' | 'via' | 'track' | 'zone' | 'text' | 'line' | 'shape' | 'rats'
const cursor = ref<[number, number] | null>(null)
const pointer = ref<[number, number]>([0, 0])
const hoverEl = shallowRef<SVGElement | null>(null)
const hitOf = (el: SVGElement | null, at: [number, number] | null): Hit | null =>
  el ? { kind: kindOf(el), id: el.dataset.id ? +el.dataset.id : null, ref: el.dataset.ref ?? null, net: el.dataset.net ?? null, pad: el.dataset.pad ?? null, at } : null
// the schematic marks this view's hover as its probe
const hoverRef = useHover(
  { hit: () => hitOf(hoverEl.value, cursor.value), site: () => props.board, sel: () => props.sel, deep: () => prefs.deep, hover: store.hover },
  h => (store.probe = h),
)
const hoverInfo = computed(() => {
  const el = hoverEl.value
  if (!el) return null
  const d = el.dataset
  // a track drawn by one command of a path string names that command, such as "H 9"
  const cmd = d.id ? commandOf(props.board, +d.id)?.text : undefined
  const route = routeHover(props.board, itemOfEl(el))
  return { kind: kindOf(el), net: route ? undefined : d.net, cmd, route, layer: (el.closest('g.layer') as SVGGElement | null)?.dataset.layer }
})

function kindOf(el: Element): Kind {
  if ((el as SVGElement).dataset.rats !== undefined) return 'rats'
  const k = (el as SVGElement).dataset.kind
  if (k === 'graphic') return el.getAttribute('fill') === 'none' ? 'line' : 'shape'
  return k === 'pad' || k === 'via' || k === 'track' || k === 'zone' || k === 'text' ? k : 'shape'
}
// everything under the pointer, best first: a pad wins over the track ending on it, and a zone only counts when nothing else is there
const rank: Record<Kind, number> = { pad: 0, via: 1, track: 2, shape: 3, text: 4, line: 5, rats: 6, zone: 7 }
function hit(e: { clientX: number; clientY: number }, under = document.elementsFromPoint(e.clientX, e.clientY)): SVGElement | null {
  let best: SVGElement | null = null
  for (const t of under) {
    // a ratsnest line names its net
    if (t instanceof SVGElement && t.dataset.rats !== undefined && svg.value?.contains(t)) {
      if (!best || rank.rats < rank[kindOf(best)]) best = t
      continue
    }
    const el = t.closest('[data-id]') as SVGElement | null
    if (!el || !el.closest('g.layer') || !svg.value?.contains(el) || el.classList.contains('iso-out')) continue
    if (!best || rank[kindOf(el)] < rank[kindOf(best)]) best = el
  }
  return best
}
const boardAt = (e: { clientX: number; clientY: number }): [number, number] => {
  const [x, y] = toView(e)
  const p: [number, number] = [mirrorX(x), y]
  return props.iso?.frame ? applyMat(props.iso.frame, p) : p
}
/** What a press lands on for the tools: a handle under the pointer, else the item a click would pick, so a pad wins over the track ending on it. */
function toolHit(e: PointerEvent): ToolHit {
  const handle = (e.target as Element).closest('[data-tool]')
  if (handle) return { tool: handle.getAttribute('data-tool'), k: Number(handle.getAttribute('data-k')) }
  const el = hit(e)
  return { id: el?.dataset.id ? +el.dataset.id : null, ref: el?.dataset.ref ?? null }
}
function onDown(e: PointerEvent) {
  if (/\/pt:\d+$/.test(store.sel.anchor ?? '') && tl.down(e, toolHit(e))) return
  if (!as.down(e) && !tl.down(e, toolHit(e))) press(e)
}
function onMove(e: PointerEvent) {
  const r = host.value?.getBoundingClientRect()
  if (r) pointer.value = [e.clientX - r.left, e.clientY - r.top]
  as.move(e, boardAt(e))
  if (as.on.value) chipAt.value = [e.offsetX, e.offsetY]
  if (tl.move(e)) {
    if (store.edit.dragging && !svg.value?.hasPointerCapture(e.pointerId)) svg.value?.setPointerCapture(e.pointerId)
    return
  }
  if (pan(e)) {
    hoverEl.value = null
    dotHover.value = null
    return
  }
  // one hit test a frame, however many moves came: the last one wins
  if (!pending) requestAnimationFrame(hoverNow)
  pending = e
}
let pending: PointerEvent | null = null
/** What lies under the last pointer: a finding's dot first, else the item a click would pick and the finding line, from one hit test. */
function hoverNow() {
  const e = pending
  pending = null
  if (!e || tl.drag.value || panning()) return
  cursor.value = boardAt(e)
  const dot = dotAt(e)
  dotHover.value = dot
  const r = host.value?.getBoundingClientRect()
  dotTipAt.value = dot !== null && r ? [e.clientX - r.left, e.clientY - r.top] : null
  if (dot !== null) {
    hoverLine.value = null
    hoverEl.value = null
    return
  }
  const under = document.elementsFromPoint(e.clientX, e.clientY)
  hoverLine.value = lineAt(e, under)
  const el = hit(e, under)
  if (el !== hoverEl.value) hoverEl.value = el
}
function onUp(e: PointerEvent) {
  const t = tl.up()
  if (t === 'drag') return
  if (t !== 'click' && !release()) return
  const f = findingAt(e)
  if (f) emit('finding', f, modsOf(e))
  else emit('pick', hitOf(hit(e), boardAt(e)), modsOf(e))
}
/** The finding line under the pointer, by its index. */
function lineAt(e: { clientX: number; clientY: number }, under = document.elementsFromPoint(e.clientX, e.clientY)): number | null {
  for (const t of under) {
    const el = t.closest('[data-line]') as SVGElement | null
    if (el && svg.value?.contains(el)) return Number(el.dataset.line)
  }
  return null
}
/** The finding whose dot, line or label is under the pointer. */
function findingAt(e: { clientX: number; clientY: number }): string | null {
  const dot = dotAt(e)
  if (dot !== null) return dots.value[dot].id || null
  for (const t of document.elementsFromPoint(e.clientX, e.clientY)) {
    const el = t.closest('[data-finding]') as SVGElement | null
    if (el && svg.value?.contains(el) && el.dataset.finding) return el.dataset.finding
  }
  return null
}
function onDouble(e: MouseEvent) {
  emit('enter', hitOf(hit(e), boardAt(e)))
}
function onLeave() {
  as.leave()
  pending = null
  dotHover.value = null
  hoverLine.value = null
  if (!panning()) {
    hoverEl.value = null
    cursor.value = null
  }
}

const visibleLayers = () => new Set(props.board.layers.filter(l => !props.hidden.has(l.id)).map(l => l.id))
// what this view draws for the selection, the hover, the isolation and the edit
const hoverL = computed(() =>
  hoverLit(props.board, props.sel, hoverRef.value, { remote: store.remote?.board === props.board.name ? store.remote.hover : null, net: props.hoverNet, refs: props.hoverRefs }),
)
const paint = computed(() => paintOf(props.board, props.drawn, hoverL.value, props.iso ?? null, props.stale, props.hidden, !!props.fade))
const painter = new Paint2d(() => content.value)
/** The anchor's net and its pair mates drawn as context, the members, the anchor on top, and the control points. */
function rebuild() {
  const g = hl.value
  const d = props.drawn
  if (!g || !content.value) return
  const p = paint.value,
    stale = p.stale.ids
  const states: Layer2d[] = [
    { state: 'ctx', nets: p.ctx.nets },
    { state: 'sel', ...p.sel, stale },
    { state: 'anchor', ...p.anchor, stale },
  ]
  g.innerHTML = d ? overlay(props.board, visibleLayers(), states) + pointMarks(d) : ''
}
// a control point: a 6 px accent dot with a white ring
const pointMarks = (d: Drawn) =>
  d.points.map(([x, y]) => `<circle class="hl-pt-ring" cx="${x}" cy="${y}" r="0.0001"/><circle class="hl-pt" cx="${x}" cy="${y}" r="0.0001"/>`).join('')
// what a click would select now, another viewer's hover and a panel's, in the hover style
function rebuildHover() {
  const g = hv.value
  if (!g || !content.value) return
  g.innerHTML = overlay(props.board, visibleLayers(), [{ state: 'hover', ...paint.value.hover }])
}
watch(() => [paint.value.sel, paint.value.anchor, paint.value.ctx, paint.value.stale, props.board, [...props.hidden].join(), props.drawn, props.mirror], rebuild, { flush: 'post' })
watch(() => [paint.value.hover, props.board, [...props.hidden].join(), props.mirror], rebuildHover, { flush: 'post' })
watch(paint, p => painter.apply(p, props.board.layers), { flush: 'post' })
// the elements a pose moved, found again only for another pose's items, a redraw or new lit copies
let posed: { parts: ReadonlySet<string>; ids: ReadonlySet<number>; layers: unknown; gen: number; els: SVGElement[] } | null = null
const moved = new Set<SVGElement>()
/** The gesture's pose on this view's own elements and the selection drawn over them, one transform each; half-opaque once committed. */
function posePreview(p: Pose | null) {
  if (!p?.held.layers) {
    if (!moved.size) return
    unpose()
    // the lit copies drawn again where their items stand
    painter.refresh()
    return
  }
  const layers = props.board.layers
  if (!posed || posed.parts !== p.parts || posed.ids !== p.ids || posed.layers !== layers || posed.gen !== painter.gen) {
    unpose()
    const skip = sketchIds(store.held.get(keyOfSite(props.board)))
    const els = painter.posed(p.parts, p.ids, skip, layers)
    if (hl.value) els.push(hl.value)
    for (const el of els) {
      el.style.transformBox = 'view-box'
      el.style.transformOrigin = `${p.origin[0]}px ${p.origin[1]}px`
      moved.add(el)
    }
    posed = { parts: p.parts, ids: p.ids, layers, gen: painter.gen, els }
  }
  const t = `translate(${p.delta[0]}px, ${p.delta[1]}px) rotate(${-p.angle}deg)`
  for (const el of posed.els) {
    el.classList.toggle('held', p.done)
    el.style.transform = t
  }
}
function unpose() {
  for (const el of moved) {
    el.style.transform = ''
    el.classList.remove('held')
  }
  moved.clear()
  posed = null
}
// a pose drawn again over each redraw until the facets that draw it there arrive, so the old pose never shows
watch([() => tl.pose.value, () => props.board], () => posePreview(tl.pose.value), { flush: 'post' })
watch(
  () => props.board,
  () => {
    hoverEl.value = null
  },
)
onMounted(() =>
  nextTick(() => {
    rebuild()
    painter.apply(paint.value, props.board.layers)
  }),
)

// the DRC pulse: one ring that grows and fades, drawn with SMIL so it restarts for every click
const pulse = ref<{ at: [number, number]; n: number } | null>(null)
let pulseTimer = 0
watch(pulse, p => {
  if (!p) return
  nextTick(() => {
    for (const a of svg.value?.querySelectorAll<SVGAnimationElement>('.pulse animate') ?? []) a.beginElement()
  })
  clearTimeout(pulseTimer)
  pulseTimer = window.setTimeout(() => {
    if (pulse.value?.n === p.n) pulse.value = null
  }, 700)
})
onBeforeUnmount(() => clearTimeout(pulseTimer))

// scale bar: the largest 1, 2 or 5 times a power of ten that fits in about 110 pixels
const scale = computed(() => {
  const raw = 110 * px.value
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const mm = [5, 2, 1].map(m => m * p).find(v => v <= raw) ?? p
  return { mm: +mm.toPrecision(3), width: mm / px.value }
})
const fmt = (v: number) => v.toFixed(px.value < 0.01 ? 3 : 2)
// SMIL keySplines for the ease-out curve of the 3D view, cubic-bezier(0.25, 0.1, 0.25, 1)
const EASE_OUT_SPLINE = EASE_OUT_CSS.replace(/^cubic-bezier\((.*)\)$/, '$1').replace(/,/g, '')
</script>

<template>
  <div ref="host" class="board-view" data-ui="Canvas2D" data-ui-source="packages/ui/src/Canvas2D.vue">
    <svg
      ref="svg"
      class="board-svg"
      :viewBox="vbStr"
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      :class="{ picking: !!hoverRef }"
      @wheel.prevent="onWheel"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @dblclick="onDouble"
      @pointerleave="onLeave"
      @pointercancel="onLeave"
    >
      <g v-if="grid" class="grid">
        <path class="minor" :d="grid.minor" />
        <path class="major" :d="grid.major" />
        <path class="axes" :d="grid.axes" />
      </g>
      <g ref="content" :transform="transform">
        <path class="substrate" :class="{ 'iso-out': !!iso?.frame && !iso.fade, 'iso-fade': !!iso?.frame && iso.fade }" fill-rule="evenodd" :d="substrate" />
        <template v-for="l in ordered" :key="l.id">
          <g
            v-show="!hidden.has(l.id)"
            class="layer"
            :class="{ faded: paint.fade && l.kind !== 'edge' }"
            :data-kind="l.kind"
            :data-layer="l.id"
            :style="{ color: l.color }"
            v-html="l.svg"
          ></g>
        </template>
        <g v-if="prefs.grid && tl.gridLines.value" class="grid entity" :transform="tl.gridLines.value.transform">
          <path class="minor" :d="tl.gridLines.value.minor" />
          <path class="major" :d="tl.gridLines.value.major" />
        </g>
        <g v-if="prefs.grid && tl.gridDots.value.length" class="assist grid-dots">
          <path v-for="(dd, i) in gridDotPaths" :key="'gd' + i" class="dot" :d="dd" :style="{ opacity: stepOpacity(i) }" />
        </g>
        <g v-for="l in ordered" :key="'lit-' + l.id" v-show="!hidden.has(l.id)" class="layer lit" :data-kind="l.kind" :data-layer="l.id" :style="{ color: l.color }"></g>
        <g class="holes" v-html="board.holes"></g>
        <g v-if="keepouts.length" class="keepouts">
          <defs>
            <pattern v-for="l in keepoutLayers" :id="hatchId(l)" :key="l" patternUnits="userSpaceOnUse" width="0.6" height="0.6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="0.6" :style="{ stroke: muted(layerColor.get(l) ?? '#8a8f98') }" stroke-width="0.12" />
            </pattern>
          </defs>
          <path
            v-for="k in keepouts"
            :key="k.key"
            v-show="!hidden.has(k.layer)"
            data-kind="keepout"
            :data-layer="k.layer"
            :d="k.d"
            fill-rule="evenodd"
            :fill="`url(#${hatchId(k.layer)})`"
            :style="{ stroke: k.color }"
          >
            <title>{{ k.title }}</title>
          </path>
        </g>
        <g ref="hl" class="hl" :style="{ '--px': px + 'px' }"></g>
        <g ref="hv" class="hl hv" :style="{ '--px': px + 'px' }"></g>
        <g v-if="links.length" class="links">
          <defs>
            <linearGradient v-for="(l, i) in links" :id="gradId(i)" :key="i" gradientUnits="userSpaceOnUse" :x1="l.from[0]" :y1="l.from[1]" :x2="l.to[0]" :y2="l.to[1]">
              <stop offset="0" :stop-color="layerOf(l.fromLayer)" />
              <stop offset="1" :stop-color="layerOf(l.toLayer)" />
            </linearGradient>
          </defs>
          <g v-for="(l, i) in links" :key="i">
            <line class="link" :x1="l.from[0]" :y1="l.from[1]" :x2="l.to[0]" :y2="l.to[1]" :stroke="`url(#${gradId(i)})`" />
            <template v-for="(m, j) in l.marks" :key="j">
              <circle :class="m.kind === 'dot' ? 'end dot' : 'end ring'" :cx="m.at[0]" :cy="m.at[1]" :r="px * 4" :style="{ color: layerOf(m.layer) }" />
              <text v-if="m.kind === 'inner'" class="end-index" :x="m.at[0] + px * 6" :y="m.at[1] - px * 6" :font-size="px * 10">{{ m.index }}</text>
            </template>
          </g>
        </g>
        <g class="ratsnest" :style="ratsVars" v-if="endLit ? endLit.length : prefs.ratsnest && board.ratsnest.length">
          <template v-for="(r, i) in endLit ?? board.ratsnest" :key="i">
            <line v-if="!endLit && !ratsFound.has(i)" class="hit" data-rats :data-net="r.net" :x1="r.from[0]" :y1="r.from[1]" :x2="r.to[0]" :y2="r.to[1]" />
            <line
              v-if="endLit || !ratsFound.has(i)"
              :class="endLit ? { 'end-lit': endLit[i].lit, 'end-dim': !endLit[i].lit } : { stale: stale?.nets.has(r.net), 'iso-out': !!iso && !iso.nets.has(r.net) }"
              :x1="r.from[0]"
              :y1="r.from[1]"
              :x2="r.to[0]"
              :y2="r.to[1]"
            />
          </template>
        </g>
        <g v-if="findLines.length" class="drc-lines" :style="ratsVars">
          <g v-for="(l, i) in findLines" :key="i" :class="lineClass(l)" :data-finding="l.findings[0].id" :data-line="i">
            <line class="hit" :x1="l.from[0]" :y1="l.from[1]" :x2="l.to[0]" :y2="l.to[1]" />
            <line :x1="l.from[0]" :y1="l.from[1]" :x2="l.to[0]" :y2="l.to[1]" />
            <template v-if="shown.has(i)">
              <g v-for="(d, k) in l.findings" :key="k" class="label" :data-finding="d.id" :class="d.severity" :transform="labelAt(l, k, l.findings.length)">
                <path v-if="labelRow(d).broken" class="broken" :d="BROKEN_ICON" :transform="`translate(${labelRow(d).start * px} ${-10 * px}) scale(${px})`" />
                <text :x="(labelRow(d).start + labelRow(d).icon) * px" :font-size="px * 11">{{ labelRow(d).text }}</text>
                <title>{{ dotTitle(d) }}</title>
              </g>
            </template>
            <title>{{ [...new Set(l.findings.map(dotTitle))].join('\n') }}</title>
          </g>
        </g>
        <g v-if="dots.length" class="drc dots">
          <path v-for="g in findingPaths" :key="'rim ' + g.key" class="rim" :class="g.cls" :d="g.d" />
          <path v-for="g in findingPaths" :key="g.key" :class="g.cls" :d="g.d" />
          <path v-for="g in findingPaths.filter(g => g.cls.includes('ring'))" :key="'hole ' + g.key" class="hole" :d="g.d" />
          <template v-for="g in dotsOn" :key="'on ' + g.key">
            <path class="rim" :class="g.cls" :d="g.d" />
            <path :class="g.cls" :d="g.d" />
          </template>
        </g>

        <g v-if="tl.ring.value" class="tool-ring">
          <circle class="band" :cx="tl.ring.value.c[0]" :cy="tl.ring.value.c[1]" :r="tl.ring.value.r" :stroke-width="tl.ring.value.band" />
          <path class="tick minor" :d="ringTicks.minor" />
          <path class="tick major" :d="ringTicks.major" />
          <path class="pivot" :d="crossAt(tl.ring.value.c, px * 0.5)" />
          <circle data-tool="ring" class="ring" :cx="tl.ring.value.c[0]" :cy="tl.ring.value.c[1]" :r="tl.ring.value.r" :stroke-width="Math.max(tl.ring.value.band, px * 12)" />
          <path data-tool="ring" class="knob" :d="ringTicks.tri" />
        </g>
        <g v-if="tl.points.value.pts.length || tl.points.value.legs.length" class="tool-points">
          <circle v-for="l in tl.points.value.legs" :key="'leg' + l.k" data-tool="leg" :data-k="l.k" class="leg" :cx="l.at[0]" :cy="l.at[1]" :r="px * 4" />
          <circle
            v-for="q in tl.points.value.pts"
            :key="'pt' + q.k"
            data-tool="pt"
            :data-k="q.k"
            class="pt"
            :class="{ on: tl.focus.value === q.k }"
            :cx="q.at[0]"
            :cy="q.at[1]"
            :r="px * (tl.focus.value === q.k ? 6 : 4)"
          />
        </g>
        <g v-if="as.on.value" class="assist">
          <path v-for="(dd, i) in as.litPaths.value" :key="'lit' + i" class="lit" :d="dd" :style="{ opacity: stepOpacity(i) * 0.5 }" />
          <path v-for="(dd, i) in as.field.value.off" :key="'off' + i" class="dot off" :d="dd" :style="{ opacity: stepOpacity(i) * 0.4 }" />
          <path v-for="(dd, i) in as.field.value.ok" :key="'ok' + i" class="dot" :d="dd" :style="{ opacity: stepOpacity(i) }" />
          <g v-if="as.preview.value" class="preview">
            <polyline
              v-for="(t, i) in as.preview.value.tracks"
              :key="'cu' + i"
              class="copper"
              :points="polyPts(t.pts)"
              :stroke-width="as.ctx.value?.width ?? 0.2"
              :style="{ stroke: layerOf(t.layer) }"
            />
            <polyline v-for="(t, i) in as.preview.value.tracks" :key="'m' + i" class="march" :points="polyPts(t.pts)" />
            <circle v-for="(v, i) in as.preview.value.vias" :key="'v' + i" class="via" :cx="v[0]" :cy="v[1]" :r="px * 4" />
          </g>
          <g v-if="as.ctx.value?.start" class="start">
            <circle :cx="as.ctx.value.start[0]" :cy="as.ctx.value.start[1]" :r="px * 9" />
            <path :d="crossAt(as.ctx.value.start, px)" />
          </g>
          <g v-if="as.marks.value.length" class="ends">
            <g v-for="m in as.marks.value" :key="m.handle" :class="['end', { on: as.endHover.value?.handle === m.handle }]" :data-handle="m.handle">
              <circle :cx="m.at[0]" :cy="m.at[1]" :r="m.r" :stroke-width="px * 1.5" />
              <text :x="m.text[0]" :y="m.text[1]" :font-size="m.size" :text-anchor="m.anchor" :transform="m.transform">{{ m.label }}</text>
            </g>
          </g>
          <circle v-if="as.hover.value" class="dot-hover" :class="{ off: !as.hover.value.ok }" :cx="as.hover.value.at[0]" :cy="as.hover.value.at[1]" :r="px * 4.5" />
        </g>
        <circle v-if="pulse" :key="pulse.n" class="pulse" :cx="pulse.at[0]" :cy="pulse.at[1]" :r="px * 6">
          <animate attributeName="r" :values="`${px * 6};${px * 40}`" dur="0.6s" begin="indefinite" fill="freeze" calcMode="spline" keyTimes="0;1" :keySplines="EASE_OUT_SPLINE" />
          <animate
            attributeName="stroke-opacity"
            values="1;1;0"
            keyTimes="0;0.74;1"
            dur="0.6s"
            begin="indefinite"
            fill="freeze"
            calcMode="spline"
            :keySplines="`0 0 1 1;${EASE_OUT_SPLINE}`"
          />
        </circle>
      </g>
    </svg>

    <div class="bv-tools" data-ui="Canvas2D.ViewControls" role="toolbar" aria-label="Board view">
      <button class="icon" title="Fit to board (F)" aria-label="Fit to board" @click="fit()">
        <svg viewBox="0 0 16 16"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg>
      </button>
      <button class="icon" title="Zoom out (−)" aria-label="Zoom out" @click="zoomBy(1.25)">
        <svg viewBox="0 0 16 16"><path d="M3 8h10" /></svg>
      </button>
      <button class="icon" title="Zoom in (+)" aria-label="Zoom in" @click="zoomBy(1 / 1.25)">
        <svg viewBox="0 0 16 16"><path d="M3 8h10M8 3v10" /></svg>
      </button>
      <button class="icon" :class="{ on: prefs.grid }" :aria-pressed="prefs.grid" title="Millimetre grid (G)" aria-label="Grid" @click="toggleGrid">
        <svg viewBox="0 0 16 16"><path d="M2 5.5h12M2 10.5h12M5.5 2v12M10.5 2v12" /></svg>
      </button>
      <button class="icon" :class="{ on: prefs.ratsnest }" :aria-pressed="prefs.ratsnest" title="Ratsnest and connections (N)" aria-label="Ratsnest" @click="toggleRatsnest">
        <svg viewBox="0 0 16 16">
          <path d="M3 12C5 4 11 4 13 12" stroke-dasharray="2 1.5" />
          <circle cx="3" cy="12" r="1.5" />
          <circle cx="13" cy="12" r="1.5" />
        </svg>
      </button>
      <button class="icon" :class="{ on: side === 'F' }" :aria-pressed="side === 'F'" title="Front side on top" aria-label="Front on top" @click="emit('update:side', 'F')">
        <svg viewBox="0 0 16 16">
          <rect x="3" y="7" width="10" height="6" rx="1" />
          <path d="M8 1.5v4M6 3.8L8 5.8l2-2" />
        </svg>
      </button>
      <button
        class="icon"
        :class="{ on: side === 'B' }"
        :aria-pressed="side === 'B'"
        title="Back side on top, not mirrored"
        aria-label="Back on top"
        @click="emit('update:side', 'B')"
      >
        <svg viewBox="0 0 16 16">
          <rect x="3" y="3" width="10" height="6" rx="1" />
          <path d="M8 14.5v-4M6 12.2L8 10.2l2 2" />
        </svg>
      </button>
      <button
        class="icon"
        :class="{ on: mirror }"
        :aria-pressed="mirror"
        title="Mirror the view, to read the back as seen from behind"
        aria-label="Mirror"
        @click="emit('update:mirror', !mirror)"
      >
        <svg viewBox="0 0 16 16"><path d="M8 1.5v13M6 4 2 12h4zM10 4l4 8h-4z" /></svg>
      </button>
    </div>

    <Bubble v-if="dotTip && dotTipAt" :x="dotTipAt[0]" :y="dotTipAt[1]" :severity="dotTip.severity">
      {{ dotTip.text }}
    </Bubble>
    <Bubble v-if="hoverInfo && !dotTip && !tl.drag.value && !as.on.value" :x="pointer[0]" :y="pointer[1]"><b>{{ hoverRef ? displayRef(board, hoverRef) : hoverInfo.kind }}</b><span v-if="hoverInfo.net"> · {{ hoverInfo.net }}</span><span> · {{ hoverInfo.layer }}</span></Bubble>
    <EditBar :tl="tl" :as="as" :chip="chipStyle" />
    <div class="bv-scale" aria-hidden="true"><span class="bar" :style="{ width: scale.width + 'px' }"></span>{{ scale.mm }} mm</div>
    <div class="bv-readout">
      <template v-if="hoverInfo">
        <span v-if="hoverRef" class="v">{{ displayRef(board, hoverRef) }}</span>
        <span v-if="hoverInfo.net" class="v">{{ hoverInfo.net }}</span>
        <span v-if="hoverInfo.route" class="v">{{ hoverInfo.route }}</span>
        <code v-if="hoverInfo.cmd" class="v cmd">{{ hoverInfo.cmd }}</code>
        <span class="k">{{ hoverInfo.kind }} on {{ hoverInfo.layer }}</span>
      </template>
      <span v-if="cursor"><span class="k">x</span> {{ fmt(cursor[0]) }} <span class="k">y</span> {{ fmt(cursor[1]) }} mm</span>
      <span v-else class="k">{{ side === 'B' ? 'back' : 'front' }} on top{{ mirror ? ', mirrored' : '' }}</span>
    </div>
  </div>
</template>
