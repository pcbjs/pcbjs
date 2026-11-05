<script setup lang="ts">
import type { usePlacementLock } from './use/placement-lock'
defineProps<{ control: ReturnType<typeof usePlacementLock> }>()
</script>

<template>
  <span v-if="control.visible.value" :title="control.reason.value ?? (control.locked.value ? 'Unlock placement' : 'Lock placement')">
    <button
      class="lock-button"
      :aria-label="control.locked.value ? 'Unlock placement' : 'Lock placement'"
      :aria-pressed="control.locked.value"
      :disabled="!!control.reason.value"
      @click="control.toggle"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="3.5" y="7" width="9" height="7" rx="1.5" />
        <path :d="control.locked.value ? 'M5.5 7V4.5a2.5 2.5 0 0 1 5 0V7' : 'M5.5 7V4.5a2.5 2.5 0 0 1 5 0'" />
      </svg>
    </button>
  </span>
</template>

<style scoped>
.lock-button {
  min-width: 28px;
  min-height: 28px;
}
.lock-button:disabled {
  pointer-events: none;
}
svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
}
</style>
