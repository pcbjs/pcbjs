<script setup lang="ts">
// the loading screen of boot-screen.js, the same markup the dev server inlines: the first load, no board to show, and the server gone
import { computed, onMounted, ref, watchEffect } from 'vue'
import mark from './mark.svg?raw'
import { fillScreen, phase, screenInner } from './boot-screen.js'
import { loadBusy, loadName, loadProgress, loadScreenState, loadText } from './loading'
import { useLoad } from './load'

const props = defineProps<{ hint?: string; actions?: string }>()
const v = useLoad()
const shown = computed(() => ({
  name: v ? loadName(v.load, v.boot?.project ?? null) : 'pcbjs',
  text: v ? loadText(v.load) : '',
  busy: v ? loadBusy(v.load) : true,
  state: v ? loadScreenState(v.load) : 'loading' as const,
  progress: v ? loadProgress(v.load) : null,
  hint: v && loadScreenState(v.load) === 'idle' ? props.hint ?? '' : '',
}))
// rendered once, then filled in place so the dots' waves and the spinner run on
const inner = screenInner({ mark, actions: props.actions })
const style = { '--phase': phase() }
const el = ref<HTMLElement>()
onMounted(() => watchEffect(() => fillScreen(el.value!, shown.value)))
</script>

<template>
  <div ref="el" class="load-screen" :data-state="shown.state" :data-busy="shown.busy ? '' : undefined" role="status" aria-live="polite" :style="style" v-html="inner"></div>
</template>
