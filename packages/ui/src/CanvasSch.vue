<script setup lang="ts">
import { schematicFinding } from './schematic-findings'
import Bubble from './Bubble.vue'
import { dotTitle } from './finding-marks'
// every length here is in sheet mm, the unit of the view box
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { SiteData } from '@pcbjs/core/site-data'
import type { SchDrawing } from '@pcbjs/core/internal/sch-model'
import { injectPane, modsOf, useCommands } from './context'
import type { Focus } from './pane'
import { useViewBox, type Box } from './viewbox'
import { focusTransaction, type FocusKind } from './focus-transaction'
import { drawnBox, schHit, schMarks, schVars, symbolFrame, type SchHit } from './schview'
import { displayRef, uidsOf } from './refs'
import type { HoverTarget } from './sync'
import { EASE_OUT_CSS } from './scene/motion'
import { setReady } from './ready'
import { keyOfSite } from './live'
import { netRoles } from './routes'
import { gridPaths, schStep } from './grid'
import { drawnOf, type Drawn, type Hit, type Mods, type Selection } from './selection'
import { useHover } from './paint'

const props = defineProps<{
  board: SiteData
  drawing: SchDrawing
  hidden: Set<string>
  theme: 'light' | 'dark'
  sel: Selection
  drawn: Drawn | null
  /** a net and parts hovered in a side panel */
  hoverNet?: string | null
  hoverRefs?: readonly string[]
  /** what is under the pointer on the board */
  probe?: HoverTarget | null
  focus: Focus | null
  frameRef?: string | null
  split: boolean
}>()
const emit = defineEmits<{
  hover: [HoverTarget | null]
  pick: [Hit | null, Mods]
  enter: [Hit | null]
  'update:split': [boolean]
}>()

const ctx = injectPane()!
const { pane, prefs } = ctx
const toggleGrid = () => ctx.toggle('grid')
const host = ref<HTMLDivElement | null>(null)
const svg = ref<SVGSVGElement | null>(null)
const content = ref<SVGGElement | null>(null)
const hl = ref<SVGGElement | null>(null)
const key = `sch:${props.board.name}`
type FocusView = { box: Box; size?: [number, number]; frameKey: string; focusN?: number }
let viewScope = keyOfSite(props.board)
const legacy = pane.focusViews.size === 0 ? pane.viewport['sch'] : undefined
const transaction = () => focusTransaction<FocusView>(pane.focusViews, viewScope, 'sch')
const remembered = transaction().current()
const restored = remembered?.box ?? legacy ?? null
let frameKey = remembered?.frameKey ?? ''
let focusN = remembered?.focusN
const snapshot = (): FocusView => ({ box: [...vb.value] as Box, size: [size.value.w, size.value.h], frameKey, focusN })
const { size, vb, px, animateTo, stopAnimation, show, zoomBy, toView, onWheel, resize, press, pan, release, panning, fitBox } = useViewBox(
  svg,
  restored ?? drawnBox(props.drawing),
  () => (props.drawing.page[2] - props.drawing.page[0]) * 4,
)
watch(vb, v => {
  pane.viewport.sch = v
})
const vbStr = computed(() => vb.value.map(v => +v.toFixed(4)).join(' '))
const vars = computed(() => schVars(props.board.schematic.svg?.themes?.[props.theme]))
const markup = computed(() => `<style>${props.board.schematic.svg?.style ?? ''}</style>${props.board.schematic.svg?.markup ?? ''}`)
const hide = computed(() => [...props.hidden].map(h => `hide-${h}`))
const findings = computed(() => props.board.erc.filter(schematicFinding))

function fit(animate = true) {
  show(drawnBox(props.drawing), animate)
}
const grid = computed(() => (prefs.grid && size.value.w ? gridPaths(vb.value, px.value, schStep(props.drawing.grid)) : null))
const page = computed(() => {
  const [x0, y0, x1, y1] = props.drawing.page
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
})
const libraryRef = computed(() => ctx.board.sel.isolate?.mode === 'library' ? ctx.board.sel.isolate.ref : null)
const frameBox = () => libraryRef.value ? drawnBox(props.drawing) : (props.frameRef ? symbolFrame(props.drawing, props.frameRef) : null)

let readyRaf = 0
function signalReady() {
  cancelAnimationFrame(readyRaf)
  readyRaf = requestAnimationFrame(() => {
    readyRaf = requestAnimationFrame(() => {
      readyRaf = 0
      if (host.value?.offsetParent && content.value?.querySelector('.sch-paper')) setReady('sch', host.value)
    })
  })
}
let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(([entry]) => {
    const { width: w, height: h } = entry.contentRect
    if (!w || !h) return
    signalReady()
    if (size.value.w) {
      resize(w, h)
      return
    }
    size.value = { w, h }
    stopAnimation()
    vb.value = remembered ? savedBox(remembered) : fitBox(restored ?? drawnBox(props.drawing))
    syncFocus()
  })
  ro.observe(host.value!)
  nextTick(() => {
    measureLabels()
    rebuild()
  })
})
onBeforeUnmount(() => {
  ro?.disconnect()
  cancelAnimationFrame(readyRaf)
})
watch(
  () => props.board,
  () => {
    signalReady()
    nextTick(measureLabels)
  },
  { flush: 'post' },
)
function focusBox(f: Focus): Box {
  const s = Math.max(f.r * 4, 40 * props.drawing.grid)
  return [f.at[0] - s / 2, f.at[1] - s / 2, s, s]
}
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
    vb.value = saved ? savedBox(saved) : fitBox(drawnBox(props.drawing))
    frameKey = saved?.frameKey ?? ''
    focusN = saved?.focusN
  }
  const tx = transaction()
  const box = frameBox()
  const f = props.focus
  const finding = !!ctx.board.sel.finding && !!f
  const active: FocusKind[] = [...(box || (f && !finding) ? ['frame' as const] : []), ...(finding ? ['finding' as const] : [])]
  tx.cancel(active)
  const rollback = tx.takeRestore()
  if (rollback) restoreFocus(rollback)
  const nextFrame = JSON.stringify([props.frameRef, libraryRef.value])
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
    animateTo(fitBox(focusBox(f)))
    if (f.pulse) pulse.value = { at: f.at, n: f.n }
  }
  focusN = f?.n
}
watch(() => [keyOfSite(props.board), props.drawing, props.frameRef, libraryRef.value, props.focus?.n, ctx.board.sel.finding], syncFocus)
onBeforeUnmount(() => {
  if (libraryRef.value) transaction().begin('frame', snapshot())
  transaction().save(snapshot())
  stopAnimation()
})

// the key map's fit and zoom while this view shows
const viewCommand = (fn: () => void) => () => {
  if (!host.value?.offsetParent) return false
  fn()
  return true
}
useCommands(ctx.commands, { fit: viewCommand(() => fit()), zoomIn: viewCommand(() => zoomBy(1 / 1.25)), zoomOut: viewCommand(() => zoomBy(1.25)) })

// the labels' drawn bounds, for hit testing their flags and words
let labelBoxes = new Map<string, Box>()
function measureLabels() {
  const m = new Map<string, Box>()
  for (const el of content.value?.querySelectorAll<SVGGraphicsElement>('[data-kind="label"]') ?? []) {
    const b = el.getBBox()
    m.set(el.dataset.id!, [b.x, b.y, b.x + b.width, b.y + b.height])
  }
  labelBoxes = m
}

const cursor = ref<[number, number] | null>(null)
const pointer = ref<[number, number]>([0, 0])
const hover = shallowRef<SchHit | null>(null)
const hitAt = (e: PointerEvent) => schHit(props.drawing, toView(e), Math.max(px.value * 4, 0.2), labelBoxes)
/** A schematic hit as the selection reads it: a symbol its part, a pin its pad, a wire or label its net, a sheet its group. */
const hitOf = (h: SchHit | null): Hit | null =>
  h ? { kind: h.kind === 'symbol' ? 'body' : h.kind, ref: h.kind === 'sheet' ? h.key.slice('sheet:'.length) : (h.ref ?? null), net: h.net ?? null, pad: h.pin ?? null } : null
const hoverRef = useHover({ hit: () => hitOf(hover.value), site: () => props.board, sel: () => props.sel, deep: () => prefs.deep, hover: ctx.board.hover }, h => emit('hover', h))

function onMove(e: PointerEvent) {
  const r = host.value?.getBoundingClientRect()
  if (r) pointer.value = [e.clientX - r.left, e.clientY - r.top]
  if (pan(e)) {
    hover.value = null
    return
  }
  const p = toView(e)
  cursor.value = p
  const h = hitAt(e)
  if (h?.key !== hover.value?.key) hover.value = h
}
function onUp(e: PointerEvent) {
  if (!release()) return
  emit('pick', hitOf(hitAt(e)), modsOf(e))
}
function onDouble(e: MouseEvent) {
  emit('enter', hitOf(hitAt(e as PointerEvent)))
}
function onLeave() {
  if (!panning()) {
    hover.value = null
    cursor.value = null
  }
}

// the overlay: a halo copy of each marked element under a copy in its own colours, one class per highlight state
const esc = (s: string) => CSS.escape(s)
function q(sel: string): SVGElement[] {
  return [...(content.value?.querySelectorAll<SVGElement>(sel) ?? [])]
}
const symbolEls = (ref: string) => q(`[data-kind="symbol"][data-ref="${esc(ref)}"]`)
const netEls = (net: string) => q(`[data-net="${esc(net)}"]`)
const pinEls = (pin: string) => {
  const i = pin.lastIndexOf('.')
  return q(`[data-kind="pin"][data-ref="${esc(pin.slice(0, i))}"][data-pin="${esc(pin.slice(i + 1))}"]`)
}
/** The pins drawn for pad items of this view, by the uids of the pads each pin stands for. */
const padPins = (ids: Set<number>) => {
  const uids = new Set(uidsOf(props.board, [...ids]))
  return props.drawing.symbols.flatMap(s => s.pins.filter(p => p.items.some(u => uids.has(u))).map(p => `${s.ref}.${p.name}`))
}
function halo(els: Iterable<SVGElement>, cls: string) {
  const g = hl.value!
  const under: Element[] = [],
    over: Element[] = []
  for (const el of els) {
    const c = el.cloneNode(true) as SVGElement
    c.removeAttribute('id')
    c.setAttribute('class', `${c.getAttribute('class') ?? ''} ${cls}`)
    under.push(c)
    const top = el.cloneNode(true) as SVGElement
    top.removeAttribute('id')
    over.push(top)
  }
  g.append(...under, ...over)
}
/** A selected symbol's body tinted 10 percent in the accent. */
function tint(ref: string) {
  const s = props.drawing.symbols.find(x => x.ref === ref)
  if (!s) return
  const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  const [x0, y0, x1, y1] = s.box
  r.setAttribute('x', String(x0))
  r.setAttribute('y', String(y0))
  r.setAttribute('width', String(x1 - x0))
  r.setAttribute('height', String(y1 - y0))
  r.setAttribute('class', 'h-tint')
  hl.value!.prepend(r)
}
/** What a drawn set marks on the sheet: its symbols, its pads' pins and its nets. */
const marked = (parts: Iterable<string>, ids: Set<number>, nets: Iterable<string>) => [
  ...[...parts].flatMap(symbolEls),
  ...padPins(ids).flatMap(pinEls),
  ...[...nets].flatMap(netEls),
]
function rebuild() {
  const g = hl.value
  if (!g || !content.value) return
  g.replaceChildren()
  const d = props.drawn
  if (d?.context) halo([...netRoles(props.board, d.context).keys()].flatMap(netEls), 'h-ctx')
  const t = hoverRef.value
  if (t && !props.sel.refs.includes(t)) {
    const h = drawnOf(props.board, { ...props.sel, refs: [t], anchor: t, marks: undefined })
    halo(marked(h.parts, h.ids, h.nets), 'h-hover')
  }
  const m = schMarks(props.drawing, props.probe ? { ...props.probe, uids: uidsOf(props.board, props.probe.ids) } : null)
  halo([...m.refs.flatMap(symbolEls), ...m.nets.flatMap(netEls), ...m.pins.flatMap(pinEls)], 'h-hover')
  halo([...(props.hoverRefs ?? []).flatMap(symbolEls), ...(props.hoverNet ? netEls(props.hoverNet) : [])], 'h-hover')
  if (!d) return
  for (const r of d.parts) tint(r)
  const rest = <T,>(s: Set<T>, a: Set<T>) => [...s].filter(x => !a.has(x))
  halo(marked(rest(d.parts, d.anchor.parts), new Set(rest(d.ids, d.anchor.ids)), rest(d.nets, d.anchor.nets)), 'h-sel')
  halo(marked(d.anchor.parts, d.anchor.ids, d.anchor.nets), 'h-anchor')
  halo(
    d.sch.flatMap(k => q(`[data-id="${esc(k)}"]`)),
    'h-anchor',
  )
}
watch(() => [props.board, props.drawn, (props.hoverRefs ?? []).join(), props.hoverNet, props.probe, hoverRef.value], rebuild, {
  flush: 'post',
})

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
const EASE_OUT_SPLINE = EASE_OUT_CSS.replace(/^cubic-bezier\((.*)\)$/, '$1').replace(/,/g, '')

const units = (v: number) => +(v / props.drawing.grid).toFixed(2)
const hoverLabel = computed(() => hoverRef.value ? displayRef(props.board, hoverRef.value) : null)
const hoverText = computed(() => {
  const h = hover.value
  if (!h) return null
  const ref = h.ref ? displayRef(props.board, h.ref) : null
  const name = h.kind === 'pin' ? `${ref}.${h.pin}` : ref
  const net = props.board.schematic.nets.find(n => n.name === h.net)?.displayName ?? h.net ?? null
  return { name, net, kind: h.kind === 'symbol' ? 'symbol' : h.kind === 'sheet' ? `sheet ${displayRef(props.board, h.key.slice(6))}` : h.kind }
})
</script>

<template>
  <div ref="host" class="sch-view" :style="{ '--ppm': String(1 / px), ...vars }">
    <svg
      ref="svg"
      class="sch-svg"
      :class="[hide, { picking: !!hoverRef }]"
      :viewBox="vbStr"
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      @wheel.prevent="onWheel"
      @pointerdown="press"
      @pointermove="onMove"
      @pointerup="onUp"
      @dblclick="onDouble"
      @pointerleave="onLeave"
      @pointercancel="onLeave"
    >
      <rect class="sch-page" v-bind="page" />
      <g v-if="grid" class="grid">
        <path class="minor" :d="grid.minor" />
        <path class="major" :d="grid.major" />
        <path class="axes" :d="grid.axes" />
      </g>
      <g ref="content" class="sch-markup" v-html="markup"></g>
      <g ref="hl" class="sch-hl"></g>
      <g v-if="!hidden.has('findings')" class="drc">
        <g v-for="(d, i) in findings" :key="i" :class="d.severity">
          <circle :cx="d.at[0]" :cy="d.at[1]" :r="px * 7" />
          <circle class="dot" :cx="d.at[0]" :cy="d.at[1]" :r="px * 1.5" />
          <title>{{ dotTitle(d) }}</title>
        </g>
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
    </svg>

    <div class="bv-tools" role="toolbar" aria-label="Schematic view">
      <button class="icon" title="Fit to drawing (F)" aria-label="Fit to drawing" @click="fit()">
        <svg viewBox="0 0 16 16"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg>
      </button>
      <button class="icon" title="Zoom out (−)" aria-label="Zoom out" @click="zoomBy(1.25)">
        <svg viewBox="0 0 16 16"><path d="M3 8h10" /></svg>
      </button>
      <button class="icon" title="Zoom in (+)" aria-label="Zoom in" @click="zoomBy(1 / 1.25)">
        <svg viewBox="0 0 16 16"><path d="M3 8h10M8 3v10" /></svg>
      </button>
      <button class="icon" :class="{ on: prefs.grid }" :aria-pressed="prefs.grid" title="Schematic grid" aria-label="Grid" @click="toggleGrid">
        <svg viewBox="0 0 16 16"><path d="M2 5.5h12M2 10.5h12M5.5 2v12M10.5 2v12" /></svg>
      </button>
      <button class="text" :class="{ on: split }" :aria-pressed="split" title="Show the 2D board beside the schematic" @click="emit('update:split', !split)">Board</button>
    </div>
    <Bubble v-if="hoverText" :x="pointer[0]" :y="pointer[1]"><b>{{ hoverLabel ?? hoverText.name ?? hoverText.kind }}</b><span v-if="hoverText.net"> · {{ hoverText.net }}</span><span> · {{ hoverText.kind }}</span></Bubble>
    <div class="bv-readout">
      <template v-if="hoverText">
        <span v-if="hoverLabel" class="v">{{ hoverLabel }}</span>
        <span v-else-if="hoverText.name" class="v">{{ hoverText.name }}</span>
        <span v-if="hoverText.net" class="v">{{ hoverText.net }}</span>
        <span class="k">{{ hoverText.kind }}</span>
      </template>
      <span v-if="cursor"><span class="k">x</span> {{ units(cursor[0]) }} <span class="k">y</span> {{ units(cursor[1]) }} grid</span>
      <span v-else class="k">{{ drawing.paper ? `${drawing.paper.name} · ` : '' }}grid {{ drawing.grid }} mm</span>
    </div>
  </div>
</template>
