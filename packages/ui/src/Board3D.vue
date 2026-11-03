<script setup lang="ts">
// the 3D canvas of the board a pane shows: the selection fades the rest, a hovered net is outlined only
import { ref } from 'vue'
import { injectPane } from './context'
import { useActions } from './use/actions'
import Canvas3D from './Canvas3D.vue'

const ctx = injectPane()!
const { board: store, pane } = ctx
const { site: board, frameRef, frameArea, boardHoverRefs, onPick, onFinding, onEnter } = useActions(ctx, '3d')
const canvas = ref<InstanceType<typeof Canvas3D>>()
defineExpose({ view: (kind: 'fit' | 'top' | 'bottom' | 'iso') => canvas.value?.view(kind) })
</script>

<template>
  <Canvas3D
    v-if="board"
    ref="canvas"
    :board="board"
    :stale="store.stale"
    :hidden="pane.hidden"
    :sel="store.sel"
    :drawn="store.layoutDrawn"
    :iso="store.iso"
    :hover-net="store.hover.net"
    :hover-refs="boardHoverRefs"
    :finding="store.finding?.id ?? null"
    :review="pane.tab === 'drc'"
    :frame-ref="frameRef"
    :frame-area="frameArea"
    :from-below="pane.side === 'B'"
    v-model:fade="pane.fade"
    v-model:explode="pane.explode"
    v-model:separation="pane.separation"
    @pick="onPick"
    @finding="onFinding"
    @enter="onEnter"
    @net="store.hover.net = $event"
  />
</template>
