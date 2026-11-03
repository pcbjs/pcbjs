<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const marker = ref<HTMLElement>()
let observer: ResizeObserver | undefined
let mutations: MutationObserver | undefined
onMounted(() => {
  const stage = marker.value?.closest<HTMLElement>('.stage')
  if (!stage) return
  const set = (key: string, value: string) => {
    if (stage.style.getPropertyValue(key) !== value) stage.style.setProperty(key, value)
  }
  const measure = () => {
    const bounds = stage.getBoundingClientRect()
    const left = stage.querySelector<HTMLElement>(':scope > .ide-tools, :scope > .seg.mode')
    const right = stage.querySelector<HTMLElement>('.view3d-buttons, .board-view .bv-tools, .sch-view .bv-tools')
    const l = left?.getBoundingClientRect(), r = right?.getBoundingClientRect()
    const narrow = bounds.width < 720
    set('--badge-left', narrow ? '8px' : `${Math.max(8, (l?.right ?? bounds.left) - bounds.left + 12)}px`)
    set('--badge-right', narrow ? '8px' : `${Math.max(8, bounds.right - (r?.left ?? bounds.right) + 12)}px`)
    set('--badge-top', `${narrow ? Math.max(l?.bottom ?? bounds.top, r?.bottom ?? bounds.top) - bounds.top + 10 : 8}px`)
    const badges = stage.querySelector<HTMLElement>('.selection-controls')?.getBoundingClientRect()
    set('--options-top', `${Math.max(l?.bottom ?? bounds.top, r?.bottom ?? bounds.top, badges?.bottom ?? bounds.top) - bounds.top + 10}px`)
  }
  observer = new ResizeObserver(measure)
  const observe = () => {
    observer?.disconnect()
    observer?.observe(stage)
    stage.querySelectorAll<HTMLElement>('.ide-tools, .seg.mode, .bv-tools, .view3d-buttons, .selection-controls').forEach(el => observer?.observe(el))
    measure()
  }
  mutations = new MutationObserver(records => {
    if (records.some(record => !(record.target instanceof Element) || !record.target.closest('[data-ui-inspector]'))) observe()
  })
  mutations.observe(stage, { childList: true, subtree: true })
  observe()
})
onBeforeUnmount(() => { observer?.disconnect(); mutations?.disconnect() })
</script>

<template><span ref="marker" hidden aria-hidden="true"></span></template>
