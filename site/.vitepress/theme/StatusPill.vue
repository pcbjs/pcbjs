<script setup lang="ts">
import type { Status } from '../../features.data'

defineProps<{ status: Status }>()
const TEXT = { shipped: 'Shipped', beta: 'Beta', planned: 'Planned' }
</script>

<template>
  <span class="status-pill" :class="status">{{ TEXT[status] }}</span>
</template>

<style scoped>
.status-pill {
  display: inline-block;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 20px;
  font-weight: 500;
  white-space: nowrap;
}
.shipped {
  color: var(--vp-c-green-1);
  background: var(--vp-c-green-soft);
}
.beta {
  color: var(--vp-c-yellow-1);
  background: var(--vp-c-yellow-soft);
}
.planned {
  color: var(--vp-c-text-2);
  background: var(--vp-c-default-soft);
}
</style>
