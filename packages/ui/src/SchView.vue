<script setup lang="ts">
// The schematic of a board as a component: zoom, pan, hover and the selection shared with the board views of the same board.
import { useView, type ViewProps, type Hover, type View } from './view'
import BoardSch from './BoardSch.vue'
import ClientOnly from './ClientOnly.vue'

const props = withDefaults(defineProps<ViewProps>(), { tools: true })
const emit = defineEmits<{ 'update:select': [string[]]; hover: [Hover]; ready: [{ view: View }] }>()
const { board, root, poster } = useView(props, emit, 'sch')
</script>

<template>
  <div v-bind="root">
    <ClientOnly>
      <BoardSch v-if="board" :key="board.name" />
      <img v-else-if="poster" class="pcbjs-poster" :src="poster" alt="" />
      <template #placeholder>
        <img v-if="poster" class="pcbjs-poster" :src="poster" alt="" />
      </template>
    </ClientOnly>
  </div>
</template>
