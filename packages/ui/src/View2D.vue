<script setup lang="ts">
import AccessMode from './AccessMode.vue'
// The 2D view of a board as a component: zoom, pan, hover and the selection, the side on top and the mirror; the poster until it mounts.
import { watch } from 'vue'
import { useView, type ViewProps, type Hover, type View } from './view'
import Board2D from './Board2D.vue'
import ClientOnly from './ClientOnly.vue'
import type { Side } from './sides'

// unset booleans stay unset, so the view keeps its own state until a prop says otherwise
const props = withDefaults(defineProps<ViewProps & { side?: Side; mirror?: boolean; layers?: string[] }>(), { tools: true, mirror: undefined })
const emit = defineEmits<{
  'update:select': [string[]]
  hover: [Hover]
  ready: [{ view: View }]
  'update:side': [Side]
  'update:mirror': [boolean]
}>()
const { board, pane, root, poster } = useView(props, emit, '2d')

watch(
  () => [props.side, props.mirror] as const,
  ([side, mirror]) => {
    if (side) pane.side = side
    if (mirror !== undefined) pane.mirror = mirror
  },
  { immediate: true },
)
watch(
  () => pane.side,
  s => s !== props.side && emit('update:side', s),
)
watch(
  () => pane.mirror,
  m => m !== props.mirror && emit('update:mirror', m),
)
watch(
  () => [props.layers?.join(','), board.value?.name] as const,
  () => {
    const b = board.value
    if (b && props.layers) pane.hidden = new Set(b.layers.map(l => l.id).filter(id => !props.layers!.includes(id)))
  },
  { immediate: true },
)
</script>

<template>
  <div v-bind="root">
    <ClientOnly>
      <Board2D v-if="board" :key="board.name" />
      <img v-else-if="poster" class="pcbjs-poster" :src="poster" alt="" />
      <template #placeholder>
        <img v-if="poster" class="pcbjs-poster" :src="poster" alt="" />
      </template>
    </ClientOnly>
    <AccessMode v-if="board && props.tools" />
  </div>
</template>
