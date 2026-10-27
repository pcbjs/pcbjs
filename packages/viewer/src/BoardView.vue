<script setup lang="ts">
// every length here is in mm, the unit of the view box
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import type { SiteData } from '@pcbjs/core/site-data'
import { clickOf, linkHint, sourceTarget, useStore, type Focus, type SourceKind } from './state'
import { clickPlan, commandOf } from './source'
import { EASE_OUT_CSS } from './scene/motion'
import { useViewBox, type Box } from './viewbox'
import { netRoles, pairGroups, routeHover } from './routes'
import { setReady } from './ready'
import { inScope, type Scope } from './scene/focus'
import { gridPaths, gridStep } from './grid'


const props = defineProps<{ board: SiteData; hidden: Set<string>; activeNet: string | null; activeRef: string | null; focus: Focus | null; flipped: boolean
  /** the items of the source highlight, null for none */
  source?: { ids: number[]; refs: string[]; points?: [number, number][]; reference?: string } | null
  /** a multi-part selection, outlined like the selected part */
  selectedRefs?: readonly string[]
  /** the parts of the circuit instance under the pointer in the side panel, outlined faintly */
  hoverRefs?: readonly string[]
  /** a part to frame at once, as ?select= asks */
  frameRef?: string | null
  /** shown beside the schematic, which owns the ready mark */
  beside?: boolean
  /** the focus a hover is held to: outside it a hover outlines the item alone and reaches nothing else */
  scope?: Scope | null }>()
const emit = defineEmits<{ pin: [string | null]; select: [string | null]; open: [{ id: number | null; ref: string | null }, SourceKind, boolean]; 'update:flipped': [boolean] }>()

const { source: src, viewports, ui, toggleGrid } = useStore()
// the site items by id, for the route and the width of a track; absent from data built before the 3D view
const itemById = computed(() => new Map((props.board.items ?? []).map(it => [it.id, it])))
const itemOfEl = (el: SVGElement | null) => (el?.dataset.id ? itemById.value.get(+el.dataset.id) ?? null : null)
const host = ref<HTMLDivElement | null>(null)
const svg = ref<SVGSVGElement | null>(null)
const content = ref<SVGGElement | null>(null)
const hl = ref<SVGGElement | null>(null)
const hv = ref<SVGGElement | null>(null)
const sh = ref<SVGGElement | null>(null)
const gh = ref<SVGGElement | null>(null)

// the last frame of each board is kept outside the component, so switching boards or a hot reload of this file keeps the zoom
const restored = viewports[props.board.name] ?? null
const { size, vb, px, fitBox, animateTo, stopAnimation, show, zoomBy, toView, onWheel, resize, press, pan, release, panning } = useViewBox(svg, (restored ?? props.board.viewBox) as Box, () => props.board.viewBox[2] * 20)
watch(vb, v => { viewports[props.board.name] = v })
const vbStr = computed(() => vb.value.map(v => +v.toFixed(5)).join(' '))

// the flip mirrors x about the centre of the board's view box, so fit gives the same frame in both orientations
const cx = computed(() => props.board.viewBox[0] + props.board.viewBox[2] / 2)
const mirror = computed(() => (props.flipped ? `translate(${2 * cx.value} 0) scale(-1 1)` : undefined))
const mirrorX = (x: number) => (props.flipped ? 2 * cx.value - x : x)

// back layers under front layers, reversed when seen from the back; layers for both sides stay on top
const ordered = computed(() => {
  const sided = props.board.layers.filter(l => l.side === 'front' || l.side === 'back')
  const both = props.board.layers.filter(l => l.side !== 'front' && l.side !== 'back')
  return [...(props.flipped ? [...sided].reverse() : sided), ...both]
})
const layerColor = computed(() => new Map(props.board.layers.map(l => [l.id, l.color])))

// hard keepouts in the layer's colour muted halfway to grey
const uid = useId()
const muted = (c: string) => `color-mix(in srgb, ${c} 50%, #8a8f98)`
const keepoutLayers = computed(() => [...new Set((props.board.keepouts ?? []).flatMap(k => k.layers))])
const hatchId = (layer: string) => `ko-${uid}-${keepoutLayers.value.indexOf(layer)}`
const keepouts = computed(() => (props.board.keepouts ?? []).flatMap((k, i) => {
  const d = k.outline.map(r => 'M' + r.map(p => p.join(' ')).join('L') + 'Z').join('')
  const forbids = [k.tracks && 'tracks', k.vias && 'vias', k.pours && 'pours'].filter(Boolean).join(', ')
  return k.layers.map(layer => ({ key: `${i}:${layer}`, layer, d, color: muted(layerColor.value.get(layer) ?? '#8a8f98'), title: `keepout on ${layer}${k.ref ? ` of ${k.ref}` : ''}: no ${forbids || 'copper'}` }))
}))
const failedLegs = computed(() => props.board.drc.flatMap(d => (d.rule === 'route-failed' && d.route ? [{ from: d.route.from, to: d.route.to, net: d.route.net, message: d.message }] : [])))

function fit(animate = true) { show(props.board.viewBox as Box, animate) }

// the grid sits in the view's own frame; flipped, the board's x = 0 lands at twice the centre
const grid = computed(() => (ui.grid && size.value.w ? gridPaths(vb.value, px.value, gridStep(1 / px.value), [props.flipped ? 2 * cx.value : 0, 0]) : null))
const substrate = computed(() => props.board.outline.map(r => 'M' + r.map(p => p.join(' ')).join('L') + 'Z').join(''))

let ro: ResizeObserver | null = null
let restoredUsed = false
// the ready signal: two frames after the view is shown at a size, the layer SVG and the overlay are in the DOM and painted
let readyRaf = 0
function signalReady() {
  cancelAnimationFrame(readyRaf)
  readyRaf = requestAnimationFrame(() => { readyRaf = requestAnimationFrame(() => { readyRaf = 0; if (!props.beside && host.value?.offsetParent && content.value?.querySelector('g.layer')) setReady('2d') }) })
}
onBeforeUnmount(() => cancelAnimationFrame(readyRaf))
onMounted(() => {
  ro = new ResizeObserver(([entry]) => {
    const { width: w, height: h } = entry.contentRect
    if (!w || !h) return // hidden behind the 3D view
    const prev = size.value
    signalReady()
    if (!prev.w) {
      size.value = { w, h }
      const framed = frameBox()
      if (framed) vb.value = fitBox(framed)
      else if (restored && !restoredUsed) { restoredUsed = true; vb.value = fitBox(restored) } else fit(false)
      return
    }
    resize(w, h)
  })
  ro.observe(host.value!)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => { ro?.disconnect(); window.removeEventListener('keydown', onKey) })

// a new board refits; an update of the same board keeps the view
watch(() => props.board.name, () => fit(false))
/** The view box of frameRef: the part's courtyard, else its extent, grown by a third of its size and at least 1.5 mm a side. */
function frameBox(): Box | null {
  const fp = props.frameRef ? props.board.footprints.find(f => f.ref === props.frameRef) : undefined
  if (!fp) return null
  const b = fp.bbox ?? { x: fp.at[0], y: fp.at[1], w: 0, h: 0 }
  const m = Math.max(1.5, Math.max(b.w, b.h) / 3)
  const x = props.flipped ? 2 * cx.value - (b.x + b.w) : b.x
  return [x - m, b.y - m, b.w + 2 * m, b.h + 2 * m]
}
// a frame request jumps there at once, so a screenshot taken at the ready mark shows it
watch(() => props.frameRef, () => { const b = frameBox(); if (b && size.value.w) { stopAnimation(); vb.value = fitBox(b); signalReady() } })
// another target or an update of the board: drawn again once the new SVG is in
watch(() => props.board, () => signalReady(), { flush: 'post' })
watch(() => props.focus?.n, () => {
  const f = props.focus
  if (!f) return
  const s = Math.max(f.r * 4, 6)
  animateTo(fitBox([mirrorX(f.at[0]) - s / 2, f.at[1] - s / 2, s, s]))
  if (f.pulse) pulse.value = { at: f.at, n: f.n }
})

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

// pointer: a press that moves more than a few pixels pans, otherwise it is a click
type Kind = 'pad' | 'via' | 'track' | 'zone' | 'text' | 'line' | 'shape'
const cursor = ref<[number, number] | null>(null)
const hoverEl = shallowRef<SVGElement | null>(null)
const hoverInfo = computed(() => {
  const el = hoverEl.value
  if (!el) return null
  const d = el.dataset
  // a track drawn by one command of a path string names that command, such as "H 9"
  const cmd = d.id ? commandOf(props.board, +d.id)?.text : undefined
  const route = routeHover(props.board, itemOfEl(el))
  return { kind: kindOf(el), net: route ? undefined : d.net, ref: d.ref, pad: d.pad, cmd, route, layer: (el.closest('g.layer') as SVGGElement | null)?.dataset.layer }
})
const scoped = (el: SVGElement | null) => !!el && inScope({ net: el.dataset.net, ref: el.dataset.ref }, props.scope ?? null)
const itemOf = (el: SVGElement) => ({ id: el.dataset.id ? +el.dataset.id : null, ref: el.dataset.ref ?? null })
// with the link key held, the hovered item's source, resolved only then
const hoverSrc = computed(() => {
  const el = hoverEl.value
  if (!src.meta || !el) return null
  const t = sourceTarget(props.board, itemOf(el), src.shift ? 'definition' : 'placement')
  if (!t) return 'no source location'
  const cmd = src.shift ? null : commandOf(props.board, itemOf(el).id)
  return cmd ? `${t.file}:${t.start[0]}:${t.start[1]} ${cmd.text}` : `${t.file}:${t.start[0]}`
})

function kindOf(el: Element): Kind {
  const k = (el as SVGElement).dataset.kind
  if (k === 'graphic') return el.getAttribute('fill') === 'none' ? 'line' : 'shape'
  return k === 'pad' || k === 'via' || k === 'track' || k === 'zone' || k === 'text' ? k : 'shape'
}
// everything under the pointer, best first: a pad wins over the track ending on it, and a zone only counts when nothing else is there
const rank: Record<Kind, number> = { pad: 0, via: 1, track: 2, shape: 3, text: 4, line: 5, zone: 6 }
function hit(e: { clientX: number; clientY: number }): SVGElement | null {
  let best: SVGElement | null = null
  for (const t of document.elementsFromPoint(e.clientX, e.clientY)) {
    const el = t.closest('[data-id]') as SVGElement | null
    if (!el || !el.closest('g.layer') || !svg.value?.contains(el)) continue
    if (!best || rank[kindOf(el)] < rank[kindOf(best)]) best = el
  }
  return best
}
function onMove(e: PointerEvent) {
  if (pan(e)) { hoverEl.value = null; return }
  const [x, y] = toView(e)
  cursor.value = [mirrorX(x), y]
  const el = hit(e)
  if (el !== hoverEl.value) hoverEl.value = el
}
function onUp(e: PointerEvent) {
  if (!release()) return
  const el = hit(e)
  // meta-click: the link key opens without selecting; click: every click selects and opens, shift for the definition
  const plan = clickPlan(el ? { kind: kindOf(el), ref: el.dataset.ref, net: el.dataset.net } : null, clickOf(e))
  if (plan.pin !== undefined) emit('pin', plan.pin)
  if (plan.select !== undefined) emit('select', plan.select)
  if (plan.open && el && (el.dataset.id || el.dataset.ref)) emit('open', itemOf(el), plan.open, plan.quiet)
}
function onLeave() { if (!panning()) { hoverEl.value = null; cursor.value = null } }

// highlight overlay: copies of the matching elements drawn as outlines above every layer
function outline(target: SVGGElement, els: Iterable<Element>, cls: string, halo = 3, casing = false) {
  const casings: SVGElement[] = [], under: SVGElement[] = [], over: SVGElement[] = []
  for (const el of els) {
    const c = el.cloneNode(true) as SVGElement
    for (const a of ['fill', 'stroke', 'stroke-width', 'opacity', 'class', 'style']) c.removeAttribute(a)
    c.setAttribute('class', cls)
    const sw = parseFloat(el.getAttribute('stroke-width') ?? '')
    if (el.getAttribute('fill') === 'none' && sw > 0 && halo > 0) {
      // a stroked track: a wider copy in the outline colour under a copy at the true width in the layer colour leaves an outline on both sides
      c.style.strokeWidth = `calc(${sw}px + var(--px) * ${halo})`
      c.style.vectorEffect = 'none'
      const inner = el.cloneNode(true) as SVGElement
      for (const a of ['opacity', 'class', 'style']) inner.removeAttribute(a)
      inner.setAttribute('class', 'fillin')
      inner.style.stroke = layerColor.value.get((el.closest('g.layer') as SVGGElement).dataset.layer!) ?? 'currentColor'
      under.push(c); over.push(inner)
    } else {
      // a dark casing under the coloured line keeps it legible on any copper colour
      if (casing) { const k = c.cloneNode(true) as SVGElement; k.setAttribute('class', 'casing'); casings.push(k) }
      over.push(c)
    }
  }
  target.append(...casings, ...under, ...over)
}
function bboxOf(els: SVGGraphicsElement[]): Box | null {
  const root = content.value!
  const inv = root.getCTM()?.inverse()
  if (!inv) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const el of els) {
    const ctm = el.getCTM()
    if (!ctm) continue
    const b = el.getBBox(), m = inv.multiply(ctm)
    for (const [x, y] of [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]) {
      const p = new DOMPoint(x, y).matrixTransform(m)
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y)
    }
  }
  return x0 < x1 ? [x0, y0, x1 - x0, y1 - y0] : null
}

function layerGroups() { return [...content.value!.querySelectorAll<SVGGElement>(':scope > g.layer')] }
/** The drawn items of each net on the visible copper, else on every visible layer: primary and secondary as netRoles gives them. */
function netEls(roles: Map<string, 'primary' | 'secondary'>) {
  const visible = layerGroups().filter(l => !props.hidden.has(l.dataset.layer!))
  const copper = visible.filter(l => l.dataset.kind === 'copper')
  const out = { primary: [] as SVGElement[], secondary: [] as SVGElement[] }
  for (const l of copper.length ? copper : visible) for (const el of l.querySelectorAll<SVGElement>('[data-net]')) { const r = roles.get(el.dataset.net!); if (r) out[r].push(el) }
  return out
}
function rebuild() {
  const g = hl.value
  if (!g || !content.value) return
  g.replaceChildren()
  const groups = layerGroups()
  const visible = groups.filter(l => !props.hidden.has(l.dataset.layer!))
  const net = props.activeNet, ref = props.activeRef
  const roles = netRoles(props.board, net)
  for (const l of groups) for (const el of l.querySelectorAll<SVGElement>('[data-id]')) el.classList.toggle('off', !!net && l.dataset.kind !== 'edge' && !roles.has(el.dataset.net!))
  if (net) {
    const els = netEls(roles)
    outline(g, els.secondary, 'mate', 2)
    outline(g, els.primary, 'net')
  }
  for (const r of new Set([...(ref ? [ref] : []), ...(props.selectedRefs ?? [])])) outlineRef(g, r, groups, visible)
}
// one selected footprint: its courtyard, else a box around its visible items, and its pads on the visible copper
function outlineRef(g: SVGGElement, ref: string, groups: SVGGElement[], visible: SVGGElement[]) {
  const sel = `[data-ref="${CSS.escape(ref)}"]`
  const crt = groups.filter(l => l.dataset.kind === 'courtyard').flatMap(l => [...l.querySelectorAll(sel)])
  if (crt.length) outline(g, crt, 'sel-crt', 0, true)
  else {
    const b = bboxOf(visible.flatMap(l => [...l.querySelectorAll<SVGGraphicsElement>(sel)]))
    if (b) {
      const pad = 0.25
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      r.setAttribute('x', String(b[0] - pad)); r.setAttribute('y', String(b[1] - pad)); r.setAttribute('width', String(b[2] + 2 * pad)); r.setAttribute('height', String(b[3] + 2 * pad))
      const k = r.cloneNode() as SVGElement
      r.setAttribute('class', 'sel-crt'); k.setAttribute('class', 'casing')
      g.append(k, r)
    }
  }
  const copper = visible.filter(l => l.dataset.kind === 'copper')
  outline(g, (copper.length ? copper : visible).flatMap(l => [...l.querySelectorAll(`${sel}[data-pad]`)]), 'sel-pad', 3, true)
}
// the circuit instance under the pointer in the side panel: its parts outlined as a selection, faded by the group's opacity
function rebuildGroupHover() {
  const g = gh.value
  if (!g || !content.value) return
  g.replaceChildren()
  const refs = props.hoverRefs ?? []
  if (!refs.length) return
  const groups = layerGroups()
  const visible = groups.filter(l => !props.hidden.has(l.dataset.layer!))
  for (const r of refs) outlineRef(g, r, groups, visible)
}
// the source highlight: an accent outline on every item a range of code produced, nothing dimmed
function rebuildSource() {
  const g = sh.value
  if (!g || !content.value) return
  g.replaceChildren()
  const s = props.source
  if (!s || (!s.ids.length && !s.refs.length && !s.points?.length && !s.reference)) return
  const visible = layerGroups().filter(l => !props.hidden.has(l.dataset.layer!))
  const ids = new Set(s.ids.map(String))
  const els: Element[] = []
  if (s.reference) for (const l of visible) els.push(...l.querySelectorAll(`[data-reference="${CSS.escape(s.reference)}"] path`))
  // a point: a ring and a cross, 0.6 mm across, in the accent
  for (const [x, y] of s.points ?? []) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    p.setAttribute('d', `M${x - 0.6} ${y}a0.6 0.6 0 1 0 1.2 0a0.6 0.6 0 1 0 -1.2 0M${x - 1} ${y}H${x + 1}M${x} ${y - 1}V${y + 1}`)
    p.setAttribute('class', 'src-hl'); p.setAttribute('fill', 'none')
    g.append(p)
  }
  for (const l of visible) for (const el of l.querySelectorAll<SVGElement>('[data-id]')) if (ids.has(el.dataset.id!)) els.push(el)
  // a footprint ref shows as its courtyard, else as a box around its visible items
  for (const ref of s.refs) {
    const sel = `[data-ref="${CSS.escape(ref)}"]`
    const crt = visible.filter(l => l.dataset.kind === 'courtyard').flatMap(l => [...l.querySelectorAll(sel)])
    if (crt.length) { els.push(...crt); continue }
    const b = bboxOf(visible.flatMap(l => [...l.querySelectorAll<SVGGraphicsElement>(sel)]))
    if (!b) continue
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    r.setAttribute('x', String(b[0] - 0.25)); r.setAttribute('y', String(b[1] - 0.25)); r.setAttribute('width', String(b[2] + 0.5)); r.setAttribute('height', String(b[3] + 0.5))
    r.setAttribute('class', 'src-hl')
    g.append(r)
  }
  outline(g, els, 'src-hl', 4)
}
// another viewer's hover: its items, or the courtyard of a part body it is on
function outlineRemote(g: SVGGElement) {
  const h = ui.remote?.board === props.board.name ? ui.remote.hover : null
  if (!h || !content.value) return
  const visible = layerGroups().filter(l => !props.hidden.has(l.dataset.layer!))
  const ids = new Set(h.ids.map(String))
  const els = visible.flatMap(l => [...l.querySelectorAll<SVGElement>('[data-id]')].filter(e => ids.has(e.dataset.id!) && e.dataset.kind !== 'zone'))
  if (!h.ids.length) for (const r of h.refs) els.push(...visible.filter(l => l.dataset.kind === 'courtyard').flatMap(l => [...l.querySelectorAll<SVGElement>(`[data-ref="${CSS.escape(r)}"]`)]))
  outline(g, els, 'hover', 1.5)
}
function rebuildHover() {
  const g = hv.value
  if (!g) return
  g.replaceChildren()
  outlineRemote(g)
  const el = hoverEl.value
  if (!el || !el.isConnected || kindOf(el) === 'zone') return
  // copper of a pair net lights both nets of the pair group in full
  const net = el.dataset.net
  if (!net || kindOf(el) === 'text' || !scoped(el) || !pairGroups(props.board).has(net) || !content.value) { outline(g, [el], 'hover', 1.5); return }
  const els = netEls(netRoles(props.board, net))
  outline(g, els.secondary, 'mate', 1)
  outline(g, els.primary, 'hover', 1.5)
}
watch(() => [props.board, [...props.hidden].join(), props.activeNet, props.activeRef, (props.selectedRefs ?? []).join(), props.flipped], rebuild, { flush: 'post' })
watch(() => [props.board, [...props.hidden].join(), (props.hoverRefs ?? []).join(), props.flipped], rebuildGroupHover, { flush: 'post' })
watch(() => [hoverEl.value, ui.remote, props.board, [...props.hidden].join(), props.flipped], rebuildHover, { flush: 'post' })
// what the other viewers of the board draw as a hover
watch(hoverEl, el => { ui.hoverItem = el ? { ids: el.dataset.id ? [+el.dataset.id] : [], refs: el.dataset.ref ? [el.dataset.ref] : [], net: el.dataset.net ?? null } : null })
// what the schematic marks for the hover
watch(hoverEl, el => { ui.probe = el && scoped(el) ? { ref: el.dataset.ref ?? null, net: el.dataset.net ?? null, id: el.dataset.id ? +el.dataset.id : null } : null })
onBeforeUnmount(() => { ui.probe = null; ui.hoverItem = null })
watch(() => [props.board, [...props.hidden].join(), props.flipped, props.source], rebuildSource, { flush: 'post' })
watch(() => props.board, () => { hoverEl.value = null })
onMounted(() => nextTick(() => { rebuild(); rebuildSource(); rebuildGroupHover() }))

// the DRC pulse: one ring that grows and fades, drawn with SMIL so it restarts for every click
const pulse = ref<{ at: [number, number]; n: number } | null>(null)
let pulseTimer = 0
watch(pulse, p => {
  if (!p) return
  nextTick(() => { for (const a of svg.value?.querySelectorAll<SVGAnimationElement>('.pulse animate') ?? []) a.beginElement() })
  clearTimeout(pulseTimer)
  pulseTimer = window.setTimeout(() => { if (pulse.value?.n === p.n) pulse.value = null }, 700)
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
  <div ref="host" class="board-view" :style="{ '--px': px + 'px' }">
    <svg ref="svg" class="board-svg" :viewBox="vbStr" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"
      :class="{ linking: src.meta && hoverEl }" @wheel.prevent="onWheel" @pointerdown="press" @pointermove="onMove" @pointerup="onUp" @pointerleave="onLeave" @pointercancel="onLeave">
      <g v-if="grid" class="grid"><path class="minor" :d="grid.minor" /><path class="major" :d="grid.major" /><path class="axes" :d="grid.axes" /></g>
      <g ref="content" :transform="mirror">
        <path class="substrate" fill-rule="evenodd" :d="substrate" />
        <g v-for="l in ordered" :key="l.id" v-show="!hidden.has(l.id)" class="layer" :data-kind="l.kind" :data-layer="l.id" :style="{ color: l.color }" v-html="l.svg"></g>
        <g class="holes" v-html="board.holes"></g>
        <g v-if="keepouts.length" class="keepouts">
          <defs>
            <pattern v-for="l in keepoutLayers" :id="hatchId(l)" :key="l" patternUnits="userSpaceOnUse" width="0.6" height="0.6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="0.6" :style="{ stroke: muted(layerColor.get(l) ?? '#8a8f98') }" stroke-width="0.12" />
            </pattern>
          </defs>
          <path v-for="k in keepouts" :key="k.key" v-show="!hidden.has(k.layer)" data-kind="keepout" :data-layer="k.layer" :d="k.d" fill-rule="evenodd" :fill="`url(#${hatchId(k.layer)})`" :style="{ stroke: k.color }"><title>{{ k.title }}</title></path>
        </g>
        <g ref="sh" class="hl"></g>
        <g ref="gh" class="hl ghover"></g>
        <g ref="hl" class="hl"></g>
        <g ref="hv" class="hl hv"></g>
        <g class="ratsnest" v-if="board.ratsnest.length">
          <line v-for="(r, i) in board.ratsnest" :key="i" :x1="r.from[0]" :y1="r.from[1]" :x2="r.to[0]" :y2="r.to[1]" />
        </g>
        <g v-if="failedLegs.length" class="route-failed">
          <g v-for="(f, i) in failedLegs" :key="i">
            <line :x1="f.from.x" :y1="f.from.y" :x2="f.to.x" :y2="f.to.y" />
            <circle :cx="f.from.x" :cy="f.from.y" :r="px * 3" /><circle :cx="f.to.x" :cy="f.to.y" :r="px * 3" />
            <title>{{ f.message }}</title>
          </g>
        </g>
        <g class="drc">
          <g v-for="(d, i) in board.drc" :key="i" :class="d.severity">
            <circle :cx="d.at[0]" :cy="d.at[1]" :r="px * 7" />
            <circle class="dot" :cx="d.at[0]" :cy="d.at[1]" :r="px * 1.5" />
            <title>{{ d.rule }}: {{ d.message }}</title>
          </g>
        </g>
        <circle v-if="pulse" :key="pulse.n" class="pulse" :cx="pulse.at[0]" :cy="pulse.at[1]" :r="px * 6">
          <animate attributeName="r" :values="`${px * 6};${px * 40}`" dur="0.6s" begin="indefinite" fill="freeze" calcMode="spline" keyTimes="0;1" :keySplines="EASE_OUT_SPLINE" />
          <animate attributeName="stroke-opacity" values="1;1;0" keyTimes="0;0.74;1" dur="0.6s" begin="indefinite" fill="freeze" calcMode="spline" :keySplines="`0 0 1 1;${EASE_OUT_SPLINE}`" />
        </circle>
      </g>
    </svg>

    <div class="bv-tools" role="toolbar" aria-label="Board view">
      <button class="icon" title="Fit to board (F)" aria-label="Fit to board" @click="fit()">
        <svg viewBox="0 0 16 16"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg>
      </button>
      <button class="icon" title="Zoom out (−)" aria-label="Zoom out" @click="zoomBy(1.25)"><svg viewBox="0 0 16 16"><path d="M3 8h10" /></svg></button>
      <button class="icon" title="Zoom in (+)" aria-label="Zoom in" @click="zoomBy(1 / 1.25)"><svg viewBox="0 0 16 16"><path d="M3 8h10M8 3v10" /></svg></button>
      <button class="icon" :class="{ on: ui.grid }" :aria-pressed="ui.grid" title="Millimetre grid" aria-label="Grid" @click="toggleGrid"><svg viewBox="0 0 16 16"><path d="M2 5.5h12M2 10.5h12M5.5 2v12M10.5 2v12" /></svg></button>
      <button class="text" :class="{ on: flipped }" :aria-pressed="flipped" title="Mirror the view to read the back side" @click="emit('update:flipped', !flipped)">Flip to back</button>
    </div>

    <div class="bv-scale" aria-hidden="true">
      <span class="bar" :style="{ width: scale.width + 'px' }"></span>{{ scale.mm }} mm
    </div>
    <div class="bv-readout">
      <span v-if="src.meta" class="k">{{ linkHint }}</span>
      <span v-if="hoverSrc" class="v src-hint">{{ hoverSrc }}</span>
      <template v-if="hoverInfo">
        <span v-if="hoverInfo.ref" class="v">{{ hoverInfo.ref }}<template v-if="hoverInfo.pad">.{{ hoverInfo.pad }}</template></span>
        <span v-if="hoverInfo.net" class="v">{{ hoverInfo.net }}</span>
        <span v-if="hoverInfo.route" class="v">{{ hoverInfo.route }}</span>
        <code v-if="hoverInfo.cmd && !hoverSrc?.endsWith(` ${hoverInfo.cmd}`)" class="v cmd">{{ hoverInfo.cmd }}</code>
        <span class="k">{{ hoverInfo.kind }} on {{ hoverInfo.layer }}</span>
      </template>
      <span v-if="cursor"><span class="k">x</span> {{ fmt(cursor[0]) }} <span class="k">y</span> {{ fmt(cursor[1]) }} mm</span>
      <span v-else class="k">{{ flipped ? 'back view' : 'front view' }}</span>
    </div>
  </div>
</template>
