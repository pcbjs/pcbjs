<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import { data as aspects } from '../../aspects.data'
import type { View } from '../../examples.data'

const props = defineProps<{ id: string; view: View; label: string; lazy?: boolean }>()

// scripts/boards.mjs writes .gallery before every build and dev server; each SVG is its own chunk
const svgs = import.meta.glob<{ default: Component }>('../../.gallery/*.svg')
const load = svgs[`../../.gallery/${props.id}-${props.view}.svg`]
const svg = load ? defineAsyncComponent(load) : null
const aspect = aspects[props.id]?.[props.view] ?? 1

// a lazy board is a sized placeholder on the server and until it nears the viewport
const root = ref<HTMLElement | null>(null)
const shown = ref(!props.lazy)
let observer: IntersectionObserver | null = null
onMounted(() => {
  if (shown.value || !root.value) return
  observer = new IntersectionObserver(
    entries => {
      if (!entries.some(e => e.isIntersecting)) return
      shown.value = true
      observer?.disconnect()
    },
    { rootMargin: '400px' },
  )
  observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div ref="root" class="board-svg" :style="{ aspectRatio: aspect }" role="img" :aria-label="label">
    <component :is="svg" v-if="svg && shown" />
  </div>
</template>

<style scoped>
.board-svg {
  width: 100%;
}
.board-svg > :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
