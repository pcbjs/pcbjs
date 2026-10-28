<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { View } from '../../examples.data'
import type { Home } from '../../home.data'
import BoardSvg from './BoardSvg.vue'

const props = defineProps<{ hero: Home['hero'] }>()

const root = ref<HTMLElement | null>(null)
const code = ref<HTMLElement | null>(null)
const view = ref<View>('2d')
const chip = ref('')
const active = ref(false)
const pinned = ref(false)
let tour: ReturnType<typeof setInterval> | undefined
let step = 0

const all = (sel: string) => [...(root.value?.querySelectorAll<HTMLElement>(sel) ?? [])]
const spansOf = (k: number) => all(`.code [data-r="${k}"]`)
const width = (k: number) => spansOf(k).reduce((n, s) => n + (s.textContent?.length ?? 0), 0)

function clear() {
  for (const e of all('.hl')) e.classList.remove('hl')
  for (const e of all('.dim')) e.classList.remove('dim')
  active.value = false
  chip.value = ''
}

/** Lights range `k` in the code and its items in both drawings; `label` overrides its chip. */
function show(k: number, label?: string) {
  clear()
  const r = props.hero.ranges[k]
  if (!r) return
  for (const s of spansOf(k)) s.classList.add('hl')
  for (const id of r.ids) for (const e of all(`.draw [data-id="${id}"]`)) e.classList.add('hl')
  for (const ref of r.refs) for (const e of all(`.draw [data-ref="${ref}"]`)) e.classList.add('hl')
  for (const d of all('.draw .board-svg')) if (d.querySelector('.hl')) d.classList.add('dim')
  chip.value = label ?? r.chip
  active.value = true
}

/** The innermost range that drew the element: by item id, else by part ref. */
function rangeOf(el: Element): number {
  const id = Number(el.getAttribute('data-id'))
  const ref = el.getAttribute('data-ref')
  const hits = props.hero.ranges.flatMap((r, k) => ((id ? r.ids.includes(id) : ref && r.refs.includes(ref)) ? [k] : []))
  return hits.sort((a, b) => width(a) - width(b))[0] ?? -1
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
        <div class="tabs" role="tablist" aria-label="Blinky view">
          <button role="tab" :aria-selected="view === '2d'" :class="{ on: view === '2d' }" @click="view = '2d'">Board</button>
          <button role="tab" :aria-selected="view === 'sch'" :class="{ on: view === 'sch' }" @click="view = 'sch'">Schematic</button>
        </div>
        <code class="chip" :class="{ shown: chip }">{{ chip || ' ' }}</code>
      </div>
      <div class="draw" @mouseover="onDraw" @mouseleave="leave" @click="pin">
        <BoardSvg v-show="view === '2d'" :id="hero.id" view="2d" label="The Blinky board: copper, silkscreen and outline" />
        <BoardSvg v-show="view === 'sch'" :id="hero.id" view="sch" label="Blinky's schematic" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.map-demo {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
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
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--pcb-canvas);
}
.tabs {
  display: flex;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  overflow: hidden;
  font-family: var(--vp-font-family-base);
}
.tabs button {
  padding: 2px 10px;
  font-size: 12px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
}
.tabs button.on {
  background: var(--vp-c-brand-3);
  color: #fff;
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
  flex: 1;
  display: grid;
  place-items: center;
  padding: 16px;
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
