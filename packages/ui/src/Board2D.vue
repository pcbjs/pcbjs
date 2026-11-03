<script setup lang="ts">
// the 2D canvas of the board a pane shows, with its view state, selection, hover and focus
import { injectPane } from './context'
import { useActions } from './use/actions'
import Canvas2D from './Canvas2D.vue'

defineProps<{ beside?: boolean }>()
const ctx = injectPane()!
const { board: store, pane } = ctx
const { site: board, frameRef, frameArea, boardHoverRefs, onPick, onFinding, onEnter } = useActions(ctx, '2d')
</script>

<template>
  <Canvas2D
    v-if="board"
    :board="board"
    :stale="store.stale"
    :hidden="pane.hidden"
    :sel="store.sel"
    :drawn="store.layoutDrawn"
    :fade="pane.fade"
    :iso="store.iso"
    :hover-net="store.hover.net"
    :hover-refs="boardHoverRefs"
    :finding="store.finding?.id ?? null"
    :review="pane.tab === 'drc'"
    :focus="pane.focus"
    :beside="beside"
    v-model:side="pane.side"
    v-model:mirror="pane.mirror"
    :frame-ref="frameRef"
    :frame-area="frameArea"
    @pick="onPick"
    @finding="onFinding"
    @enter="onEnter"
  />
</template>
