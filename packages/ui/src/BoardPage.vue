<script setup lang="ts">
// The board page of a viewer: every view, the rails and the chip, as the children of its grid; see BoardFrame.
import { defineAsyncComponent } from 'vue'
import BoardFrame from './BoardFrame.vue'
import Board2D from './Board2D.vue'
import BoardSch from './BoardSch.vue'
import RailLeft from './RailLeft.vue'
import RailRight from './RailRight.vue'

defineProps<{
  /** the compile status the IDE pane's toolbar shows */
  status?: string
}>()
// the 3D view and its renderer load only when 3D is first chosen, keeping the 2D page light
const views = { '2d': Board2D, '3d': defineAsyncComponent(() => import('./Board3D.vue')), sch: BoardSch, checks: defineAsyncComponent(() => import('./ChecksView.vue')) }
const rails = { left: RailLeft, right: RailRight }
</script>

<template>
  <BoardFrame :views="views" :rails="rails" :status="status">
    <template v-if="$slots.empty" #empty><slot name="empty"></slot></template>
    <template v-if="$slots.overlay" #overlay><slot name="overlay"></slot></template>
  </BoardFrame>
</template>
