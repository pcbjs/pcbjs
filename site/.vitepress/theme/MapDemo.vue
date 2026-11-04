<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { withBase } from 'vitepress'
import type { View } from '../../examples.data'
import type { Home } from '../../home.data'
import type { Hover } from '@pcbjs/ui'
import boards from 'virtual:site-boards'
import BoardSvg from './BoardSvg.vue'
import LiveBoard from './LiveBoard.vue'
import ViewTabs from './ViewTabs.vue'
import { excerptRange } from '../../scripts/source-selection.mjs'

const props = defineProps<{ hero: Home['hero']; initialView?: View }>()

const root = ref<HTMLElement | null>(null)
const code = ref<HTMLElement | null>(null)
const view = ref<View>(props.initialView ?? '3d')
// the 3D view mounts on first use and then stays, hidden behind the SVGs
const framed = ref(false)
watch(view, v => (framed.value ||= v === '3d'), { immediate: true })
const NONE: Hover = { uids: [], refs: [], net: null }
const hover = ref<Hover>(NONE)
const chip = ref('')
const active = ref(false)
const pinned = ref(false)
let tour: ReturnType<typeof setInterval> | undefined
let step = 0

const all = (sel: string) => [...(root.value?.querySelectorAll<HTMLElement>(sel) ?? [])]
const spansOf = (k: number) => all(`.code [data-r="${k}"]`)
const width = (k: number) => spansOf(k).reduce((n, s) => n + (s.textContent?.length ?? 0), 0)

function unlight() {
  for (const e of all('.hl')) e.classList.remove('hl')
  for (const e of all('.dim')) e.classList.remove('dim')
  active.value = false
  chip.value = ''
}

function clear() {
  unlight()
  hover.value = NONE
}

/** Lights range `k` in the code and its items in both drawings; `label` overrides its chip. */
function light(k: number, label?: string) {
  unlight()
  const r = props.hero.ranges[k]
  if (!r) return
  for (const s of spansOf(k)) s.classList.add('hl')
  for (const id of r.ids) for (const e of all(`.draw [data-id="${id}"]`)) e.classList.add('hl')
  for (const ref of r.refs) for (const e of all(`.draw [data-ref="${ref}"]`)) e.classList.add('hl')
  for (const d of all('.draw .board-svg')) if (d.querySelector('.hl')) d.classList.add('dim')
  chip.value = label ?? r.chip
  active.value = true
}

/** Lights range `k` and its items in the 3D view too. */
function show(k: number, label?: string) {
  light(k, label)
  const r = props.hero.ranges[k]
  hover.value = r ? { uids: r.uids, refs: r.refs, net: null } : NONE
}

/** The innermost range that drew one of the items: by SVG data-id or frame uid, else by part ref. */
function rangeFor(items: (number | string)[], refs: string[]): number {
  return excerptRange(props.hero.ranges, items, refs, width)
}

function rangeOf(el: Element): number {
  const id = Number(el.getAttribute('data-id'))
  const ref = el.getAttribute('data-ref')
  return rangeFor(id ? [id] : [], ref ? [ref] : [])
}

/** A hover in the 3D view lights its range without echoing it back to the view. */
function onFrame(h: Hover) {
  stopTour()
  if (pinned.value) return
  const k = rangeFor(h.uids, h.refs)
  if (k < 0) {
    unlight()
    chip.value = h.refs.join(', ') || (h.net ? `net ${h.net}` : '')
    return
  }
  light(k)
  reveal(k)
}

/** A click in the 3D view pins the range of the part, or lets go. */
function onPick(refs: string[]) {
  stopTour()
  const part = refs[0]?.split('/')[0]
  const k = part ? rangeFor([], [part]) : -1
  pinned.value = k >= 0
  if (k < 0) return unlight()
  light(k)
  reveal(k)
}

function stopTour() {
  clearInterval(tour)
  tour = undefined
}

function onCode(e: Event) {
  stopTour()
  if (pinned.value) return
  const span = (e.target as Element).closest('[data-r]')
  span ? show(Number(span.getAttribute('data-r'))) : clear()
}

function onDraw(e: MouseEvent) {
  stopTour()
  if (pinned.value) return
  // a pad under a track or silk still names the pad
  const pad = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.hasAttribute('data-pad') && x.closest('.draw'))
  const el = pad ?? (e.target as Element).closest('[data-id], [data-ref]')
  if (!el) return clear()
  const k = rangeOf(el)
  const label = pad ? `pad ${pad.getAttribute('data-ref')}.${pad.getAttribute('data-pad')}` : undefined
  if (k >= 0) return show(k, label)
  clear()
  if (label) chip.value = label
}

function leave() {
  if (!pinned.value) clear()
}

function pin(e: MouseEvent) {
  pinned.value = false
  if (!(e.target as Element).closest('[data-r], [data-id], [data-ref]')) return clear()
  ;(code.value?.contains(e.target as Node) ? onCode : onDraw)(e)
  pinned.value = active.value
}

/** Scrolls the code box, not the page, so the range is in view. */
function reveal(k: number) {
  const box = code.value,
    span = spansOf(k)[0]
  if (!box || !span) return
  const top = span.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
  box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3), behavior: 'smooth' })
}

function next() {
  const k = props.hero.tour[step++ % props.hero.tour.length]
  show(k)
  reveal(k)
}

/** A click outside the demo lets go of a pinned item. */
function outside(e: Event) {
  if (!pinned.value || root.value?.contains(e.target as Node)) return
  pinned.value = false
  clear()
}

onMounted(() => {
  document.addEventListener('click', outside)
  if (!props.hero.tour.length) return
  next()
  tour = setInterval(next, 2000)
})
onBeforeUnmount(() => {
  stopTour()
  document.removeEventListener('click', outside)
})
</script>

<template>
  <section ref="root" class="map-demo" :class="{ active, pinned }" @pointerenter="stopTour">
    <div class="code">
      <div class="bar">
        <span>{{ hero.file.split('/').pop() }}</span>
        <span class="hint">hover or click</span>
      </div>
      <pre ref="code" class="hc" @mouseover="onCode" @mouseleave="leave" @click="pin" v-html="hero.html" />
    </div>
    <div class="board">
      <div class="bar">
        <ViewTabs v-model="view" :views="hero.views" :label="`${hero.name} view`" :full="withBase(`/examples/${hero.id}`)" />
        <code class="chip" :class="{ shown: chip }">{{ chip || ' ' }}</code>
      </div>
      <div class="draw" @mouseover="onDraw" @mouseleave="leave" @click="pin">
        <BoardSvg v-show="view === '2d'" view="2d" :aspect="hero.aspect['2d']" label="The Blinky board: copper, silkscreen and outline" />
        <BoardSvg v-if="hero.aspect.sch" v-show="view === 'sch'" view="sch" :aspect="hero.aspect.sch" label="Blinky's schematic" />
        <LiveBoard
          v-if="framed"
          class="frame"
          :class="{ off: view !== '3d' }"
          :board="boards[hero.id]"
          view="3d"
          armed
          :label="`The ${hero.name} board in 3D`"
          :highlight="hover.refs"
          @hover="onFrame"
          @select="onPick"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.map-demo {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  overflow: hidden;
  background: var(--vp-c-bg-alt);
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  font-size: 13px;
  color: var(--vp-c-text-2);
  border-bottom: 1px solid var(--vp-c-divider);
  font-family: var(--vp-font-family-mono);
}
.hint {
  font-family: var(--vp-font-family-base);
  color: var(--vp-c-text-3);
}
.code {
  border-right: 1px solid var(--vp-c-divider);
  min-width: 0;
}
pre {
  margin: 0;
  padding: 12px 14px;
  max-height: 520px;
  overflow: auto;
  font-size: 12.5px;
  line-height: 1.6;
  cursor: default;
}
pre :deep([data-r]) {
  border-radius: 3px;
  cursor: pointer;
}
pre :deep([data-r].hl) {
  background: var(--vp-c-brand-soft);
  box-shadow: 0 0 0 1px var(--vp-c-brand-1);
}
.board {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--pcb-canvas);
}
.chip {
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  opacity: 0;
  transition: opacity 0.15s;
}
.chip.shown {
  opacity: 1;
}
.draw {
  position: relative;
  flex: 1;
  min-height: 360px;
  display: grid;
  place-items: center;
  padding: 16px;
}
.draw > .frame {
  position: absolute;
  inset: 0;
}
.draw > .frame.off {
  visibility: hidden;
}
.draw :deep([data-id]),
.draw :deep(.sch-sym) {
  transition: opacity 0.15s;
}
.draw :deep(.sch-sym) {
  pointer-events: bounding-box;
}
.draw :deep(.dim [data-id]:not(.hl)),
.draw :deep(.dim .sch-sym:not(.hl)) {
  opacity: 0.22;
}
.draw :deep(.sch-sym.hl) {
  --sch-body: var(--vp-c-brand-1);
}
@media (max-width: 768px) {
  .map-demo {
    grid-template-columns: minmax(0, 1fr);
  }
  .code {
    border-right: 0;
    border-bottom: 1px solid var(--vp-c-divider);
  }
  pre {
    max-height: 300px;
  }
}
</style>
