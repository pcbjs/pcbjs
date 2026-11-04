<script lang="ts">
// The 3D views alive on a page: no renderer is shared between them and browsers cap WebGL contexts, so past MAX the oldest away from the viewport goes first, else the oldest.
interface Live {
  near: () => boolean
  drop: () => void
}
const MAX = 6
const live: Live[] = []

function release(l: Live) {
  const i = live.indexOf(l)
  if (i >= 0) live.splice(i, 1)
}

function claim(l: Live) {
  release(l)
  live.push(l)
  if (live.length <= MAX) return
  const old = live.find(x => x !== l && !x.near()) ?? live[0]
  release(old)
  old.drop()
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { SchView, View2D, View3D, type Hover } from '@pcbjs/ui'
import type { BoardRef } from '@pcbjs/core/site-facets'
import type { View } from '../../boards'

// `armed` takes the wheel and a drag at once, else only after a click into the view; `tools` false hides the view's toolbar
const props = defineProps<{ board: BoardRef; view: View; label: string; highlight?: string[]; armed?: boolean; tools?: boolean }>()
const emit = defineEmits<{ hover: [Hover]; select: [string[]]; ready: [] }>()

const root = ref<HTMLElement | null>(null)
const shown = ref(false)
const ready = ref(false)
const VIEWS = { '2d': View2D, '3d': View3D, sch: SchView }
const poster = computed(() => (props.view === 'sch' ? props.board.poster.sch : props.board.poster['2d']))
let near = false
let observer: IntersectionObserver | undefined

const slot: Live = { near: () => near, drop: () => (shown.value = false) }

function show() {
  shown.value = true
  if (props.view === '3d') claim(slot)
  else release(slot)
}

function hide() {
  release(slot)
  shown.value = false
}

function onReady() {
  ready.value = true
  emit('ready')
}

watch(
  () => props.view,
  () => {
    ready.value = false
    if (shown.value) show()
  },
)
watch(shown, s => s || (ready.value = false))

onMounted(() => {
  observer = new IntersectionObserver(
    entries => {
      near = entries[entries.length - 1].isIntersecting
      near ? show() : hide()
    },
    { rootMargin: '200px' },
  )
  if (root.value) observer.observe(root.value)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  release(slot)
})
</script>

<template>
  <div ref="root" class="live-board" :class="{ ready }" role="img" :aria-label="label">
    <img v-if="poster" class="poster" :src="poster" alt="" />
    <component
      :is="VIEWS[view]"
      v-if="shown"
      :key="view"
      class="view"
      :board="board"
      :arm="armed ? 'always' : 'click'"
      :tools="tools !== false"
      :highlight="highlight"
      @ready="onReady"
      @hover="(h: Hover) => emit('hover', h)"
      @update:select="(s: string[]) => emit('select', s)"
    />
  </div>
</template>

<style scoped>
.live-board {
  position: relative;
  width: 100%;
  height: 100%;
}
.poster,
.view {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.poster {
  object-fit: contain;
  transition: opacity 0.2s;
}
.ready .poster {
  opacity: 0;
}
.view {
  --pcbjs-bg: var(--pcb-canvas);
}
</style>
