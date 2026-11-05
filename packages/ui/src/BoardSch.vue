<script setup lang="ts">
// the schematic canvas of the board a pane shows, hovers shared with the board views
import { injectPane } from './context'
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { schematicState } from './schview'
import { setReady } from './ready'
import { useActions } from './use/actions'
import CanvasSch from './CanvasSch.vue'
import LockButton from './LockButton.vue'
import { usePlacementLock } from './use/placement-lock'

const ctx = injectPane()!
const lock = usePlacementLock(ctx)
const { board: store, pane } = ctx
const selection = computed(() => ({ ...store.sel, isolate: null, isolateChoice: null, level: null }))
const { site: board, drawing, remoteProbe, frameRef, onSchHover, onPick, onEnter } = useActions(ctx, 'sch')
const state = computed(() => schematicState(drawing.value))
const empty = ref<HTMLElement | null>(null)
let frame = 0
watch(
  [empty, board, state],
  () => {
    cancelAnimationFrame(frame)
    if (empty.value) frame = requestAnimationFrame(() => setReady('sch', empty.value))
  },
  { flush: 'post' },
)
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <CanvasSch
    v-if="board && drawing && state === 'ready'"
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
  <div v-else-if="board" ref="empty" class="empty sch-empty" role="status">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4m10 0h4M7 8h10v8H7zM12 3v5m0 8v5" /></svg>
    <strong>{{ state === 'empty' ? 'No schematic yet' : 'Schematic unavailable' }}</strong>
    <span>{{
      state === 'empty'
        ? 'This draft has no schematic content to display. You can keep working in 2D or 3D.'
        : 'The schematic has invalid page bounds. Recompile the board to refresh this view.'
    }}</span>
  </div>
  <div v-if="lock.visible.value" class="bv-edit" role="toolbar" aria-label="Schematic placement"><LockButton :control="lock" /></div>
</template>

<style scoped>
.sch-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--canvas-dim);
}
.sch-empty svg {
  width: 32px;
  height: 32px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
}
.sch-empty span {
  max-width: 36ch;
  line-height: 1.5;
}
</style>
