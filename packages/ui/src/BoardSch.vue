<script setup lang="ts">
// the schematic canvas of the board a pane shows, hovers shared with the board views
import { injectPane } from './context'
import { computed } from 'vue'
import { useActions } from './use/actions'
import CanvasSch from './CanvasSch.vue'

const ctx = injectPane()!
const { board: store, pane } = ctx
const selection = computed(() => ({ ...store.sel, isolate: null, isolateChoice: null, level: null }))
const { site: board, drawing, remoteProbe, frameRef, onSchHover, onPick, onEnter } = useActions(ctx, 'sch')
</script>

<template>
  <CanvasSch
    v-if="board && drawing"
    :board="board"
    :drawing="drawing"
    :hidden="pane.schHidden"
    :theme="ctx.theme()"
    :sel="selection"
    :drawn="store.drawn"
    :hover-net="store.hover.net"
    :hover-refs="store.hover.refs"
    :probe="store.probe ?? remoteProbe"
    :focus="pane.schFocus"
    :frame-ref="frameRef"
    v-model:split="pane.split"
    @hover="onSchHover"
    @pick="onPick"
    @enter="onEnter"
  />
</template>
