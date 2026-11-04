<script setup lang="ts">
import { computed, h, nextTick, onMounted, ref, watch } from 'vue'
import { ChecksView, useBoard } from '@pcbjs/ui'
import { data } from '../../guide.data'
import boards from 'virtual:guide-boards'
import LiveBoard from './LiveBoard.vue'
import type { View } from '../../boards'

type GuideView = View | 'checks'
const props = defineProps<{ example: string; file?: string; view?: GuideView }>()
const demo = computed(() => data.boards[props.example])
if (!demo.value) throw new Error(`Missing compiled guide example: ${props.example}`)
const root = ref<HTMLElement | null>(null)
const code = ref<HTMLElement | null>(null)
const file = ref(props.file ?? demo.value.activeFile)
const view = ref<GuideView>(props.view ?? demo.value.initialView)
const activeLine = ref<number | null>(null)
const pinned = ref(false)
const copied = ref<'idle' | 'ok' | 'failed'>('idle')
const current = computed(() => demo.value.files.find(f => f.name === file.value) ?? demo.value.files[0])
const source = computed(() => data.sources[current.value.source])
const sourceHtml = computed(() =>
  source.value.html.replace(/class="line" data-line="(\d+)"/g, (text, n) =>
    current.value.focus.includes(Number(n)) ? text.replace('class="line"', 'class="line relevant"') : text,
  ),
)
const lines = computed(() => (activeLine.value === null ? current.value.focus : [activeLine.value]))
const ranges = computed(() => current.value.ranges.filter(r => lines.value.includes(r.start[0])))
const unique = <T,>(items: T[]) => [...new Set(items)]
const refs = computed<string[]>(() => unique(ranges.value.flatMap(r => r.refs)))
const ids = computed<number[]>(() => unique(ranges.value.flatMap(r => r.ids)))
const uids = computed<string[]>(() => unique(ranges.value.flatMap(r => r.uids)))
const nets = computed<string[]>(() => unique(ranges.value.flatMap(r => r.nets ?? [])))
const store = useBoard(boards[props.example])
const Palette = () => h('style', data.css.replaceAll('.hc ', '.guide-demo .hc '))

function paint() {
  for (const line of root.value?.querySelectorAll<HTMLElement>('.source [data-line]') ?? []) {
    const n = Number(line.dataset.line)
    line.classList.toggle('relevant', current.value.focus.includes(n))
    line.classList.toggle('chosen', activeLine.value === n)
  }
  let lit = false
  for (const entity of root.value?.querySelectorAll<SVGElement>('.drawing [data-id], .drawing [data-ref], .drawing [data-net]') ?? []) {
    const selected = ids.value.includes(Number(entity.dataset.id)) || refs.value.includes(entity.dataset.ref ?? '') || nets.value.includes(entity.dataset.net ?? '')
    entity.classList.toggle('lit', selected)
    lit ||= selected
  }
  root.value?.querySelector('.drawing')?.classList.toggle('has-highlight', lit)
  const resolved = store.site?.items.filter(item => uids.value.includes(item.uid)).map(item => item.id) ?? []
  store.hover.item = resolved.length || refs.value.length ? { ids: resolved, refs: refs.value, net: nets.value[0] ?? null } : null
  store.hover.refs = refs.value
  store.hover.net = nets.value[0] ?? null
}
function reset() {
  activeLine.value = null
  pinned.value = false
}
function selectLine(e: Event) {
  if (pinned.value) return
  const line = (e.target as Element).closest<HTMLElement>('[data-line]')
  activeLine.value = line ? Number(line.dataset.line) : null
}
function pinLine(e: MouseEvent) {
  pinned.value = false
  selectLine(e)
  pinned.value = activeLine.value !== null
}
function selectEntity(e: Event) {
  if (pinned.value) return
  const el = (e.target as Element).closest<SVGElement>('[data-id], [data-ref], [data-net]')
  if (!el) return
  const r = current.value.ranges.find(r => r.ids.includes(Number(el.dataset.id)) || r.refs.includes(el.dataset.ref ?? '') || r.nets?.includes(el.dataset.net ?? ''))
  if (r) activeLine.value = r.start[0]
}
function nextLine(delta: number) {
  const candidates = unique(current.value.ranges.map(r => r.start[0])).sort((a, b) => a - b)
  if (!candidates.length) return
  const index = candidates.indexOf(activeLine.value ?? lines.value[0])
  activeLine.value = candidates[(index + delta + candidates.length) % candidates.length]
  pinned.value = true
  void nextTick(scrollFocus)
}
function scrollFocus() {
  const line = root.value?.querySelector<HTMLElement>(`.source [data-line="${activeLine.value ?? current.value.focus[0]}"]`)
  if (line && code.value) code.value.scrollTop += line.getBoundingClientRect().top - code.value.getBoundingClientRect().top - 60
}
async function copy() {
  try {
    await navigator.clipboard.writeText(source.value.code)
    copied.value = 'ok'
    return
  } catch {
    /* LAN HTTP may not expose the clipboard API. */
  }
  const previous = document.activeElement as HTMLElement | null
  const field = document.createElement('textarea')
  field.value = source.value.code
  field.style.cssText = 'position:fixed;left:-9999px;top:0'
  document.body.append(field)
  field.select()
  try {
    copied.value = document.execCommand('copy') ? 'ok' : 'failed'
  } catch {
    copied.value = 'failed'
  } finally {
    field.remove()
    previous?.focus({ preventScroll: true })
  }
}
watch([current, view, activeLine, () => store.site], () => void nextTick(paint), { deep: false })
watch(file, () => {
  reset()
  copied.value = 'idle'
  void nextTick(scrollFocus)
})
onMounted(() => {
  paint()
  scrollFocus()
})
</script>

<template>
  <section ref="root" class="guide-demo" :data-example="example" :aria-label="`${demo.title}: source and compiled preview`">
    <Palette />
    <header class="demo-heading">
      <strong>{{ demo.title }}</strong
      ><span>Compiled from the source below</span>
    </header>
    <div class="workspace">
      <div class="source-pane">
        <div class="file-tabs" role="tablist" aria-label="Complete project source">
          <button v-for="f in demo.files" :key="f.name" role="tab" :aria-selected="file === f.name" @click="file = f.name">{{ f.name }}</button>
        </div>
        <div class="source-actions">
          <span>Highlighted lines are this step’s focus</span>
          <button
            type="button"
            :title="copied === 'ok' ? 'Copied' : copied === 'failed' ? 'Copy failed; select the source to copy manually' : 'Copy complete file'"
            :aria-label="copied === 'ok' ? 'Copied' : copied === 'failed' ? 'Copy failed; select the source to copy manually' : 'Copy complete file'"
            @click="copy"
          >
            {{ copied === 'ok' ? '✓' : copied === 'failed' ? '!' : '⧉' }}
          </button>
        </div>
        <pre
          ref="code"
          class="source hc"
          tabindex="0"
          aria-label="Complete source; arrow keys select expressions, Escape restores lesson focus"
          @mouseover="selectLine"
          @mouseleave="!pinned && (activeLine = null)"
          @click="pinLine"
          @keydown.down.prevent="nextLine(1)"
          @keydown.up.prevent="nextLine(-1)"
          @keydown.esc.prevent="reset"
          v-html="sourceHtml"
        />
      </div>
      <div class="preview-pane">
        <div class="view-tabs" role="tablist" aria-label="Preview view">
          <button v-for="v in demo.views" :key="v" role="tab" :aria-selected="view === v" @click="view = v">
            {{ v === 'sch' ? 'Schematic' : v === 'checks' ? 'DRC/ERC' : v.toUpperCase() }}
          </button>
          <button class="reset" title="Restore lesson highlights" aria-label="Restore lesson highlights" @click="reset">↺</button>
        </div>
        <div
          v-if="view === '2d' || view === 'sch'"
          :key="view"
          class="drawing"
          role="img"
          :aria-label="`${demo.title}, ${view === 'sch' ? 'schematic' : 'board'} at this step`"
          @mouseover="selectEntity"
          @mouseleave="!pinned && (activeLine = null)"
          v-html="demo.svg[view]"
        />
        <LiveBoard v-else-if="view === '3d'" class="model" :board="boards[example]" view="3d" :label="`${demo.title} in 3D`" :tools="false" :highlight="refs" @ready="paint" />
        <ChecksView v-else class="checks" :board="boards[example]" />
        <div class="state-caption" aria-live="polite">
          <span v-if="view === 'checks'">{{ demo.counts.drcErrors + demo.counts.ercErrors }} errors · {{ demo.counts.drcWarnings + demo.counts.ercWarnings }} warnings</span>
          <span v-else-if="view === 'sch'">{{ demo.declared.length }} declared parts</span>
          <span v-else>{{ demo.placed.length }} placed parts · {{ demo.counts.tracks }} tracks</span>
          <span v-if="!demo.placed.length && view !== 'sch'">No footprints placed yet</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.guide-demo {
  scroll-margin-top: 110px;
  margin: 24px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  overflow: hidden;
  background: var(--vp-c-bg);
}
.demo-heading {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--vp-c-bg-alt);
  font-size: 13px;
}
.demo-heading span,
.source-actions,
.state-caption {
  color: var(--vp-c-text-2);
  font-size: 12px;
}
.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
}
.source-pane,
.preview-pane {
  min-width: 0;
}
.source-pane {
  border-right: 1px solid var(--vp-c-divider);
}
.file-tabs,
.view-tabs {
  display: flex;
  overflow-x: auto;
  gap: 4px;
  padding: 6px;
  border-bottom: 1px solid var(--vp-c-divider);
}
.file-tabs button,
.view-tabs button {
  flex-shrink: 0;
  padding: 5px 8px;
  font-size: 12px;
  border-radius: 5px;
}
button[aria-selected='true'] {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}
button:focus-visible,
pre:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: -2px;
}
.reset {
  margin-left: auto;
}
.source-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
}
.source-actions button {
  padding: 2px 6px;
  font-size: 19px;
}
.source {
  margin: 0;
  padding: 8px 0 16px;
  max-height: 460px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.65;
  counter-reset: line;
}
.source :deep(.line) {
  display: inline-block;
  min-width: 100%;
  padding-right: 16px;
}
.source :deep(.line)::before {
  counter-increment: line;
  content: counter(line);
  display: inline-block;
  width: 3.5em;
  margin-right: 12px;
  text-align: right;
  color: var(--vp-c-text-3);
  user-select: none;
}
.source :deep(.line.relevant) {
  background: var(--vp-c-brand-soft);
  box-shadow: inset 3px 0 var(--vp-c-brand-1);
}
.source :deep(.line.chosen) {
  background: var(--vp-c-brand-soft);
  outline: 1px solid var(--vp-c-brand-1);
  outline-offset: -1px;
}
.preview-pane {
  display: flex;
  flex-direction: column;
  background: var(--pcb-canvas);
}
.drawing {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 300px;
  padding: 16px;
}
.drawing :deep(svg) {
  width: 100%;
  max-height: 430px;
}
.drawing.has-highlight :deep([data-id]:not(.lit)),
.drawing.has-highlight :deep(.sch-sym:not(.lit)) {
  opacity: 0.25;
}
.drawing :deep(.sch-sym.lit) {
  --sch-body: var(--vp-c-brand-1);
}
.checks {
  min-height: 380px;
  max-height: 500px;
  flex: 1;
}
.model {
  min-height: 380px;
  flex: 1;
}
.state-caption {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--vp-c-divider);
}
@media (max-width: 1100px) {
  .workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .source-pane {
    border-right: 0;
  }
  .source {
    max-height: 340px;
  }
  .preview-pane {
    border-top: 1px solid var(--vp-c-divider);
  }
}
</style>
