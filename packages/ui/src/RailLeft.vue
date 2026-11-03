<script setup lang="ts">
// the left rail of a board page: the layers, the board's counts and the stackup, or the sheet's rows beside the schematic
import { computed } from 'vue'
import { injectPane } from './context'
import LayersPanel from './LayersPanel.vue'
import BoardPanel from './BoardPanel.vue'
import StackupPanel from './StackupPanel.vue'
import SheetPanel from './SheetPanel.vue'

const { board: store, pane } = injectPane()!
const drawing = computed(() => store.site?.schematic.drawing ?? null)
</script>

<template>
  <SheetPanel v-if="pane.mode === 'sch' && drawing" />
  <template v-else>
    <LayersPanel />
    <BoardPanel />
    <StackupPanel />
  </template>
</template>
