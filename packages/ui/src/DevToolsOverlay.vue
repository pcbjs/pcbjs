<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { injectPane } from './context'
import { uiTree, uiSnapshot, type UiNode } from './devtools'

const ctx = injectPane()!
const host = ref<HTMLElement>()
const nodes = shallowRef<UiNode[]>([])
const selected = shallowRef<Element | null>(null)
const picking = ref(false)
const query = ref('')
const note = ref('')
const shown = computed(() => nodes.value.filter(n => !query.value || `${n.label} ${n.component ?? ''}`.toLowerCase().includes(query.value.toLowerCase())))
const node = computed(() => nodes.value.find(n => n.element === selected.value))
const box = computed(() => node.value?.properties.bounds as { x: number; y: number; width: number; height: number } | undefined)
const details = computed(() =>
  JSON.stringify(
    node.value
      ? {
          component: node.value.component,
          source: node.value.source,
          parent: node.value.parent,
          children: nodes.value.filter(n => n.parent === node.value!.id).map(n => n.id),
          ...node.value.properties,
        }
      : {},
    null,
    2,
  ),
)
const state = computed(() => ({
  board: ctx.board.name,
  target: ctx.board.site?.variant?.name ?? null,
  view: ctx.pane.mode,
  side: ctx.pane.side,
  mirror: ctx.pane.mirror,
  selection: ctx.board.sel,
  explode: ctx.pane.explode,
  separation: ctx.pane.separation,
  hiddenLayers: [...ctx.pane.hidden],
}))
let frame = 0
let observer: MutationObserver | undefined
const stage = () => host.value?.closest('.stage')
const inspectable = (target: EventTarget | null): target is Element => target instanceof Element && !!stage()?.contains(target) && !target.closest('[data-ui-inspector]')
const snapshot = () => {
  const root = stage()
  nodes.value = root ? uiTree(root) : []
}
const refresh = () => {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    snapshot()
  })
}
function choose(el: Element) {
  selected.value = el
  picking.value = false
  refresh()
}
function pick(e: MouseEvent) {
  if (!picking.value || !inspectable(e.target)) return
  e.preventDefault()
  e.stopImmediatePropagation()
  choose(e.target.closest('[data-ui],button,input,select,textarea,[role],canvas') ?? e.target)
}
function hover(e: PointerEvent) {
  if (picking.value && inspectable(e.target)) {
    selected.value = e.target.closest('[data-ui],button,input,select,textarea,[role],canvas') ?? e.target
    refresh()
  }
}
function shield(e: PointerEvent) {
  if (!picking.value || !inspectable(e.target)) return
  e.preventDefault()
  e.stopImmediatePropagation()
}
function escape(e: KeyboardEvent) {
  if (e.key !== 'Escape' || (!picking.value && !(e.target instanceof Element && e.target.closest('[data-ui-inspector]')))) return
  e.preventDefault()
  e.stopImmediatePropagation()
  if (picking.value) picking.value = false
  else ctx.pane.devtools = false
}
function changed(e: Event) {
  if (inspectable(e.target)) refresh()
}
async function copy() {
  try {
    snapshot()
    await navigator.clipboard.writeText(JSON.stringify({ state: state.value, selected: node.value?.id ?? null, tree: uiSnapshot(nodes.value) }, null, 2))
    note.value = 'Copied'
  } catch {
    note.value = 'Clipboard unavailable; select and copy the details below.'
  }
}
watch(() => [ctx.pane.mode, ctx.board.sel, ctx.pane.explode], refresh)
onMounted(() => {
  refresh()
  observer = new MutationObserver(records => {
    if (records.some(r => !(r.target instanceof Element ? r.target : r.target.parentElement)?.closest('[data-ui-inspector]'))) refresh()
  })
  const root = host.value?.closest('.stage')
  if (root) observer.observe(root, { childList: true, subtree: true, attributes: true })
  window.addEventListener('resize', refresh)
  document.addEventListener('scroll', refresh, true)
  document.addEventListener('input', changed, true)
  document.addEventListener('change', changed, true)
  document.addEventListener('pointermove', hover, true)
  document.addEventListener('pointerdown', shield, true)
  document.addEventListener('pointerup', shield, true)
  document.addEventListener('click', pick, true)
  document.addEventListener('keydown', escape, true)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  cancelAnimationFrame(frame)
  window.removeEventListener('resize', refresh)
  document.removeEventListener('scroll', refresh, true)
  document.removeEventListener('input', changed, true)
  document.removeEventListener('change', changed, true)
  document.removeEventListener('pointermove', hover, true)
  document.removeEventListener('pointerdown', shield, true)
  document.removeEventListener('pointerup', shield, true)
  document.removeEventListener('click', pick, true)
  document.removeEventListener('keydown', escape, true)
})
</script>

<template>
  <aside ref="host" class="ui-inspector" data-ui-inspector role="region" aria-label="Preview UI inspector" @pointerdown.stop @keydown.stop>
    <header>
      <strong>UI inspector</strong
      ><button title="Pick an element" aria-label="Pick an element" :aria-pressed="picking" @click="picking = !picking">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
          <circle cx="8" cy="8" r="2.5" />
        </svg></button
      ><button title="Copy UI report" aria-label="Copy UI report" @click="copy">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="5" y="5" width="8" height="9" rx="1" />
          <path d="M3 11H2V2h8v1" />
        </svg></button
      ><button title="Close inspector" aria-label="Close inspector" @click="ctx.pane.devtools = false">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    </header>
    <input v-model="query" type="search" aria-label="Filter UI elements" placeholder="Find an element…" />
    <div class="ui-tree" role="list" aria-label="UI hierarchy">
      <button
        v-for="n in shown"
        :key="n.id"
        role="listitem"
        :class="{ on: n.element === selected }"
        :style="{ paddingLeft: `${8 + n.depth * 12}px` }"
        :title="`${n.component ?? n.properties.tag} · ${n.id}`"
        @click="choose(n.element)"
      >
        <span class="dim">{{ n.component ? '◇' : '·' }}</span> {{ n.label }}
      </button>
    </div>
    <details open>
      <summary>Element properties</summary>
      <pre tabindex="0">{{ details }}</pre>
    </details>
    <details>
      <summary>Preview state</summary>
      <pre tabindex="0">{{ JSON.stringify(state, null, 2) }}</pre>
    </details>
    <small v-if="note" role="status">{{ note }}</small>
  </aside>
  <div
    v-if="box"
    data-ui-inspector
    class="ui-inspector-highlight"
    :style="{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` }"
    aria-hidden="true"
  ></div>
</template>

<style scoped>
.ui-inspector {
  position: absolute;
  z-index: 120;
  right: 12px;
  bottom: 12px;
  width: min(340px, calc(100% - 24px));
  max-height: min(70%, 680px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel, var(--bg));
  color: var(--fg);
  box-shadow: 0 6px 24px #0003;
  font:
    12px/1.4 system-ui,
    sans-serif;
}
header {
  display: flex;
  align-items: center;
  gap: 6px;
}
header strong {
  flex: 1;
}
header button {
  display: grid;
  place-items: center;
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  padding: 5px;
}
header button svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.ui-inspector input {
  min-height: 28px;
  width: 100%;
}
.ui-tree {
  min-height: 90px;
  max-height: 240px;
  overflow: auto;
  flex-shrink: 0;
}
.ui-tree button {
  display: block;
  width: 100%;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border: none;
  border-radius: 4px;
  min-height: 26px;
}
.ui-tree button.on,
header button[aria-pressed='true'] {
  background: var(--accent);
  color: var(--bg);
}
summary {
  cursor: pointer;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 180px;
  overflow: auto;
  font-size: 11px;
  user-select: text;
}
.ui-inspector-highlight {
  position: fixed;
  z-index: 119;
  pointer-events: none;
  border: 2px solid #58a6ff;
  background: #58a6ff18;
  border-radius: 3px;
}
</style>
