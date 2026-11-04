<script setup lang="ts">
// The home page demo's board or schematic inlined, its items keeping their ids and refs for the source map, themed by the site's CSS variables.
import { defineAsyncComponent, type Component } from 'vue'
import type { View } from '../../boards'

const props = defineProps<{ view: View; aspect?: number; label: string }>()

// scripts/boards.mjs writes them before every build and dev server; svg-loader makes each a Vue component
const svgs = import.meta.glob<{ default: Component }>('../../.gallery/hero/*.svg')
const load = svgs[`../../.gallery/hero/${props.view}.svg`]
const svg = load ? defineAsyncComponent(load) : null
</script>

<template>
  <div class="board-svg" :style="{ aspectRatio: aspect ?? 1 }" role="img" :aria-label="label">
    <component :is="svg" v-if="svg" />
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
