<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { bubbleAt } from './bubble'

const props = defineProps<{ x: number; y: number; severity?: string }>()
const el = shallowRef<HTMLElement | null>(null)
const size = shallowRef<[number, number]>([0, 0])
const bounds = shallowRef<[number, number, number, number]>([0, 0, 0, 0])
let observer: ResizeObserver | null = null
const measure = () => {
  const host = el.value?.offsetParent as HTMLElement | null
  if (!host || !el.value) return
  const r = host.getBoundingClientRect()
  bounds.value = [Math.max(0, -r.left), Math.max(0, -r.top), Math.min(host.clientWidth, window.innerWidth - r.left), Math.min(host.clientHeight, window.innerHeight - r.top)]
  size.value = [el.value.offsetWidth, el.value.offsetHeight]
}
onMounted(() => {
  observer = new ResizeObserver(measure)
  observer.observe(el.value!)
  if (el.value?.offsetParent) observer.observe(el.value.offsetParent)
  window.addEventListener('resize', measure)
  measure()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', measure)
})
const style = computed(() => {
  const [x, y] = bubbleAt(props.x, props.y, ...size.value, bounds.value)
  return {
    left: `${x}px`,
    top: `${y}px`,
    maxWidth: `${Math.max(0, bounds.value[2] - bounds.value[0] - 16)}px`,
    maxHeight: `${Math.max(0, bounds.value[3] - bounds.value[1] - 16)}px`,
  }
})
</script>

<template>
  <div ref="el" class="view-bubble" :class="severity" :style="style" role="tooltip"><slot /></div>
</template>
