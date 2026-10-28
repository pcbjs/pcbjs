<script setup lang="ts">
// closes on a click outside, on Escape and once an item is chosen
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps<{ label?: string; align?: 'left' | 'right' }>()
const el = ref<HTMLDetailsElement | null>(null)
const close = () => {
  if (el.value) el.value.open = false
}
function onDoc(e: Event) {
  if (el.value?.open && !el.value.contains(e.target as Node)) close()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && el.value?.open) {
    close()
    el.value.querySelector('summary')?.focus()
  }
}
function onPick(e: Event) {
  if ((e.target as Element).closest('a, button')) close()
}
onMounted(() => {
  document.addEventListener('pointerdown', onDoc)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDoc)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <details ref="el" class="menu" :class="align ?? 'left'">
    <summary :aria-label="label"><slot name="button" /></summary>
    <div class="menu-list" role="menu" @click="onPick"><slot /></div>
  </details>
</template>
