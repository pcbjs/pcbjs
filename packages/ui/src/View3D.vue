<script setup lang="ts">
// The 3D view of a board as a component: orbit, hover, the selection's fade and the exploded stack; three.js loads on first mount.
import { defineAsyncComponent, onErrorCaptured, ref, watch } from 'vue'
import { useView, type ViewProps, type Hover, type View } from './view'
import { EXPLODE_MAX } from './query'
import ClientOnly from './ClientOnly.vue'
import type { Side } from './sides'

const Board3D = defineAsyncComponent(() => import('./Board3D.vue'))
type Camera = 'iso' | 'top' | 'bottom' | 'fit'

const props = withDefaults(defineProps<ViewProps & { side?: Side; explode?: number; camera?: Camera; layers?: string[] }>(), { tools: true })
const emit = defineEmits<{ 'update:select': [string[]]; hover: [Hover]; ready: [{ view: View }]; 'update:explode': [number] }>()
const { board, pane, root, poster } = useView(props, emit, '3d')
const failure = ref('')
const loading = ref(true)
onErrorCaptured(err => {
  failure.value = String((err as Error)?.message ?? err)
  loading.value = false
  return false
})
const scene = ref<{ view(kind: Camera): void }>()

watch(
  () => props.side,
  s => s && (pane.side = s),
  { immediate: true },
)
watch(
  () => props.explode,
  e => {
    if (e === undefined) return
    pane.explode = e > 0
    if (e > 0) pane.separation = Math.round(e * EXPLODE_MAX * 100) / 100
  },
  { immediate: true },
)
watch(
  () => (pane.explode ? pane.separation / EXPLODE_MAX : 0),
  e => e !== props.explode && emit('update:explode', e),
)
watch(
  () => [props.layers?.join(','), board.value?.name] as const,
  () => {
    const b = board.value
    if (b && props.layers) pane.hidden = new Set(b.layers.map(l => l.id).filter(id => !props.layers!.includes(id)))
  },
  { immediate: true },
)
const onReady = () => {
  loading.value = false
  if (props.camera) scene.value?.view(props.camera)
}
watch(
  () => props.camera,
  c => c && scene.value?.view(c),
)
</script>

<template>
  <div v-bind="root" @pcbjs-ready.once="onReady">
    <ClientOnly>
      <div v-if="board" class="view3d-host">
        <Board3D v-if="!failure" ref="scene" :key="board.name" />
        <template v-if="failure || loading">
          <img v-if="poster" class="pcbjs-poster" :src="poster" alt="" />
          <div class="empty" :role="failure ? 'alert' : 'status'">{{ failure ? `3D view failed: ${failure}` : 'Loading 3D view…' }}</div>
        </template>
      </div>
      <img v-else-if="poster" class="pcbjs-poster" :src="poster" alt="" />
      <template #placeholder>
        <img v-if="poster" class="pcbjs-poster" :src="poster" alt="" />
      </template>
    </ClientOnly>
  </div>
</template>
