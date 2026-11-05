<script setup lang="ts">
import { computed } from 'vue'
import { injectPane } from './context'

const ctx = injectPane()!
const writable = computed(
  () => !!ctx.board.site?.dev && ctx.board.edit.mode?.mode === 'rw' && !!ctx.board.edit.client && !ctx.board.edit.mismatch && !ctx.board.site?.variant?.index,
)
const reason = computed(() =>
  !ctx.board.site?.dev
    ? 'Published preview. Selection, inspection and view controls remain available.'
    : writable.value
      ? 'The server permits source edits from this connection.'
      : 'Source editing is disabled for this connection or target. Selection, inspection and view controls remain available.',
)
</script>

<template>
  <span class="access-mode" :title="reason" role="status" data-ui="View.Access">
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path v-if="writable" d="m10.5 2.5 3 3-8 8-4 1 1-4zM9 4l3 3" />
      <template v-else>
        <rect x="3.5" y="7" width="9" height="7" rx="1.5" />
        <path d="M5.5 7V4.5a2.5 2.5 0 0 1 5 0V7" />
      </template>
    </svg>
    {{ writable ? 'Editable' : 'Read-only' }}
  </span>
</template>

<style scoped>
.access-mode {
  position: absolute;
  left: 8px;
  bottom: 40px;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  border: 1px solid var(--canvas-line);
  border-radius: 5px;
  background: var(--canvas-panel);
  color: var(--canvas-dim);
  font-size: 11px;
}
svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
}
</style>
