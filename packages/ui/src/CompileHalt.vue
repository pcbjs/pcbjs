<script setup lang="ts">
import { computed } from 'vue'
import type { SiteData } from '@pcbjs/core/site-data'

const props = defineProps<{ halted?: SiteData['halted'] }>()
const stages = computed(() => props.halted?.stages ?? ['compile'])
const failed = computed(() => props.halted?.stage ?? 'compile')
const completed = computed(() => props.halted?.completed ?? [])
const description = computed(() => {
  const src = props.halted?.src
  return `Compilation halted at ${failed.value}${src ? `, ${src.file}:${src.line}:${src.col}` : ''}. DRC and ERC incomplete.`
})
</script>

<template>
  <div
    class="compile-halt"
    role="progressbar"
    aria-label="Compilation halted"
    :aria-valuemin="0"
    :aria-valuemax="stages.length"
    :aria-valuenow="completed.length"
    :aria-valuetext="description"
    :title="description"
  >
    <span
      v-for="stage in stages"
      :key="stage"
      :class="{ done: completed.includes(stage), failed: stage === failed }"
      :title="`${stage}: ${stage === failed ? 'failed' : completed.includes(stage) ? 'completed' : 'not completed'}`"
    ></span>
  </div>
</template>

<style scoped>
.compile-halt {
  position: absolute;
  inset: 0 0 auto;
  z-index: 41;
  display: flex;
  gap: 2px;
  height: 5px;
}
.compile-halt span {
  flex: 1;
  background: var(--canvas-line);
}
.compile-halt .done {
  background: var(--canvas-dim);
}
.compile-halt .failed {
  background: var(--err);
}
</style>
