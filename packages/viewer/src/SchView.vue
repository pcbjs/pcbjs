<script setup lang="ts">
// every length here is in sheet mm, the unit of the view box
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { SiteData } from '@pcbjs/core/site-data'
import type { SchDrawing } from '@pcbjs/core/sch-model'
import { clickOf, linkHint, useStore, type Focus, type SourceKind } from './state'
import { useViewBox, type Box } from './viewbox'
import { drawnBox, schHit, schMarks, schVars, symbolFrame, type Probe, type SchHit } from './schview'
import { hlStrength } from './scene/intensity'
import { EASE_OUT_CSS } from './scene/motion'
import { setReady } from './ready'
import { inScope, type Scope } from './scene/focus'
import { netRoles } from './routes'
import { gridPaths, schStep } from './grid'

const props = defineProps<{
  board: SiteData
  drawing: SchDrawing
  hidden: Set<string>
  theme: 'light' | 'dark'
  activeNet: string | null
  activeRef: string | null
  selectedRefs?: readonly string[]
  hoverRefs?: readonly string[]
  /** what is under the pointer on the board */
  probe?: Probe | null
  /** the source highlight: drawn element keys and parts */
  source?: { sch?: string[]; refs: string[] } | null
  focus: Focus | null
  frameRef?: string | null
  split: boolean
  /** the focus a hover is held to: outside it a hover outlines the item alone and reaches nothing else */
  scope?: Scope | null
}>()
const emit = defineEmits<{
  hover: [SchHit | null]
  pin: [string | null]
  select: [string | null]
  circuit: [string]
  open: [SchHit, SourceKind, boolean]
  'update:split': [boolean]
}>()

const { source: src, viewports, ui, toggleGrid } = useStore()
const host = ref<HTMLDivElement | null>(null)
const svg = ref<SVGSVGElement | null>(null)
const content = ref<SVGGElement | null>(null)
const hl = ref<SVGGElement | null>(null)
const key = `sch:${props.board.name}`
const restored = viewports[key] ?? null
const { size, vb, px, animateTo, stopAnimation, show, zoomBy, toView, onWheel, resize, press, pan, release, panning, fitBox } = useViewBox(
  svg,
  restored ?? drawnBox(props.drawing),
  () => (props.drawing.page[2] - props.drawing.page[0]) * 4,
)
watch(vb, v => {
  viewports[key] = v
})
const vbStr = computed(() => vb.value.map(v => +v.toFixed(4)).join(' '))
const vars = computed(() => schVars(props.board.schematic.svg?.themes?.[props.theme]))
const markup = computed(() => `<style>${props.board.schematic.svg?.style ?? ''}</style>${props.board.schematic.svg?.markup ?? ''}`)
const hide = computed(() => [...props.hidden].map(h => `hide-${h}`))
const findings = computed(() => (props.board.erc ?? []).filter(f => f.layer === 'sch'))

function fit(animate = true) {
  show(drawnBox(props.drawing), animate)
}
const grid = computed(() => (ui.grid && size.value.w ? gridPaths(vb.value, px.value, schStep(props.drawing.grid)) : null))
const page = computed(() => {
  const [x0, y0, x1, y1] = props.drawing.page
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
})
const frameBox = () => (props.frameRef ? symbolFrame(props.drawing, props.frameRef) : null)

let readyRaf = 0
function signalReady() {
  cancelAnimationFrame(readyRaf)
  readyRaf = requestAnimationFrame(() => {
    readyRaf = requestAnimationFrame(() => {
      readyRaf = 0
      if (host.value?.offsetParent && content.value?.querySelector('.sch-paper')) setReady('sch')
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
    const f = props.focus
    vb.value = fitBox(frameBox() ?? (f ? focusBox(f) : null) ?? restored ?? drawnBox(props.drawing))
    if (f?.pulse) pulse.value = { at: f.at, n: f.n }
  })
  ro.observe(host.value!)
  window.addEventListener('keydown', onKey)
  nextTick(() => {
    measureLabels()
    rebuild()
  })
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('keydown', onKey)
  cancelAnimationFrame(readyRaf)
})
watch(
  () => props.frameRef,
  () => {
    const b = frameBox()
    if (b && size.value.w) {
      stopAnimation()
      vb.value = fitBox(b)
      signalReady()
    }
  },
)
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
// a focus set before the view mounted is taken on its first size
watch(
  () => props.focus?.n,
  () => {
    const f = props.focus
    if (!f) return
    animateTo(fitBox(focusBox(f)))
    if (f.pulse) pulse.value = { at: f.at, n: f.n }
  },
)

function onKey(e: KeyboardEvent) {
  if (!host.value?.offsetParent || e.metaKey || e.ctrlKey || e.altKey) return
  const t = e.target
  if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]')) return
  if (e.key === 'f' || e.key === 'F') fit()
  else if (e.key === '+' || e.key === '=') zoomBy(1 / 1.25)
  else if (e.key === '-' || e.key === '_') zoomBy(1.25)
  else return
  e.preventDefault()
}

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
const hover = shallowRef<SchHit | null>(null)
const hitAt = (e: PointerEvent) => schHit(props.drawing, toView(e), Math.max(px.value * 4, 0.2), labelBoxes)
const body = (h: SchHit) => h.kind === 'symbol' || h.kind === 'sheet'
const scoped = (h: SchHit) => inScope({ net: body(h) ? null : h.net, ref: h.ref, refs: h.kind === 'sheet' ? h.refs : undefined, body: body(h) }, props.scope ?? null)
watch(hover, h => emit('hover', h && scoped(h) ? h : null))
watch(hover, h => {
  ui.hoverItem = h ? { ids: [...h.items], refs: [...h.refs], net: h.net ?? null } : null
})
onBeforeUnmount(() => {
  emit('hover', null)
  ui.hoverItem = null
})
const hoverSrc = computed(() => {
  const h = hover.value
  if (!src.meta || !h) return null
  return h.src ? `${h.src.file}:${h.src.line}` : h.ref ? 'the part placement' : 'no source location'
})

function onMove(e: PointerEvent) {
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
  const h = hitAt(e)
  const act = clickOf(e)
  if (!act.select) {
    if (h && act.open) emit('open', h, act.open, false)
    return
  }
  if (h?.kind === 'sheet') emit('circuit', h.key.slice('sheet:'.length))
  if (h?.net && h.kind !== 'symbol') emit('pin', h.net)
  if (h?.ref) emit('select', h.ref)
  if (!h || (!h.ref && !h.net && h.kind !== 'sheet')) {
    emit('pin', null)
    emit('select', null)
  }
  if (act.open && h) emit('open', h, act.open, true)
}
function onLeave() {
  if (!panning()) {
    hover.value = null
    cursor.value = null
  }
}

// the overlay: a halo copy of each marked element under a copy in its own colours, nothing dimmed
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
function keyEls(k: string): SVGElement[] {
  if (k.startsWith('sym:')) return symbolEls(k.slice(4))
  if (k.startsWith('pin:')) return pinEls(k.slice(4))
  if (k.startsWith('sheet:')) return q(`[data-kind="sheet"][data-path="${esc(k.slice(6))}"]`)
  if (k.startsWith('text:')) return q('.sch-text').slice(+k.slice(5), +k.slice(5) + 1)
  return q(`[data-id="${esc(k)}"]`)
}
const mates = (net: string) => [...netRoles(props.board, net)].filter(([, r]) => r === 'secondary').map(([n]) => n)
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
/** A selected symbol's tint, weaker for a larger body by the area rule of the 3D highlight. */
function tint(ref: string, cls: string) {
  const s = props.drawing.symbols.find(x => x.ref === ref)
  if (!s) return
  const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  const [x0, y0, x1, y1] = s.box
  r.setAttribute('x', String(x0))
  r.setAttribute('y', String(y0))
  r.setAttribute('width', String(x1 - x0))
  r.setAttribute('height', String(y1 - y0))
  r.setAttribute('class', cls)
  r.style.fillOpacity = String(0.3 * hlStrength((x1 - x0) * (y1 - y0)))
  hl.value!.prepend(r)
}
function rebuild() {
  const g = hl.value
  if (!g || !content.value) return
  g.replaceChildren()
  const groupRefs = props.hoverRefs ?? []
  halo(groupRefs.flatMap(symbolEls), 'h-group')
  const h = hover.value
  if (h) halo(keyEls(h.key), 'h-hover')
  const m = schMarks(props.drawing, props.probe)
  halo([...m.refs.flatMap(symbolEls), ...m.nets.flatMap(netEls), ...m.pins.flatMap(pinEls)], 'h-hover')
  halo(
    m.nets.flatMap(n => mates(n).flatMap(netEls)),
    'h-mate',
  )
  if (props.source) halo(new Set([...(props.source.sch ?? []).flatMap(keyEls), ...props.source.refs.flatMap(symbolEls)]), 'h-src')
  if (props.activeNet) {
    halo(mates(props.activeNet).flatMap(netEls), 'h-mate')
    halo(netEls(props.activeNet), 'h-net')
  }
  const sel = new Set([...(props.activeRef ? [props.activeRef] : []), ...(props.selectedRefs ?? [])])
  for (const r of sel) tint(r, 'h-tint')
  halo([...sel].flatMap(symbolEls), 'h-sel')
}
watch(() => [props.board, props.activeNet, props.activeRef, (props.selectedRefs ?? []).join(), (props.hoverRefs ?? []).join(), props.probe, props.source, hover.value], rebuild, {
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
const hoverText = computed(() => {
  const h = hover.value
  if (!h) return null
  const name = h.kind === 'pin' ? `${h.ref}.${h.pin}` : (h.ref ?? null)
  return { name, net: h.net ?? null, kind: h.kind === 'symbol' ? 'symbol' : h.kind === 'sheet' ? `sheet ${h.key.slice(6)}` : h.kind }
})
</script>

<template>
  <div ref="host" class="sch-view" :style="{ '--ppm': String(1 / px), ...vars }">
    <svg
      ref="svg"
      class="sch-svg"
      :class="[hide, { linking: src.meta && hover }]"
      :viewBox="vbStr"
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      @wheel.prevent="onWheel"
      @pointerdown="press"
      @pointermove="onMove"
      @pointerup="onUp"
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
          <title>{{ d.rule }}: {{ d.message }}</title>
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
      <button class="icon" :class="{ on: ui.grid }" :aria-pressed="ui.grid" title="Schematic grid" aria-label="Grid" @click="toggleGrid">
        <svg viewBox="0 0 16 16"><path d="M2 5.5h12M2 10.5h12M5.5 2v12M10.5 2v12" /></svg>
      </button>
      <button class="text" :class="{ on: split }" :aria-pressed="split" title="Show the 2D board beside the schematic" @click="emit('update:split', !split)">Board</button>
    </div>
    <div class="bv-readout">
      <span v-if="src.meta" class="k">{{ linkHint }}</span>
      <span v-if="hoverSrc" class="v src-hint">{{ hoverSrc }}</span>
      <template v-if="hoverText">
        <span v-if="hoverText.name" class="v">{{ hoverText.name }}</span>
        <span v-if="hoverText.net" class="v">{{ hoverText.net }}</span>
        <span class="k">{{ hoverText.kind }}</span>
      </template>
      <span v-if="cursor"><span class="k">x</span> {{ units(cursor[0]) }} <span class="k">y</span> {{ units(cursor[1]) }} grid</span>
      <span v-else class="k">{{ drawing.paper ? `${drawing.paper.name} · ` : '' }}grid {{ drawing.grid }} mm</span>
    </div>
  </div>
</template>
