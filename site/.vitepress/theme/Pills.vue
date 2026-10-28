<script setup lang="ts">
const props = defineProps<{ counts: Record<string, number> }>()
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** One pill per check: clean, else its errors, else its warnings; unconnected pads count as DRC errors. */
function pill(check: 'DRC' | 'ERC', errors: number, warnings: number) {
  if (errors) return { check, tone: 'bad', text: `${check} ${plural(errors, 'error')}` }
  if (warnings) return { check, tone: 'warn', text: `${check} ${plural(warnings, 'warning')}` }
  return { check, tone: 'ok', text: `${check} clean` }
}
const c = props.counts
const pills = [pill('DRC', (c.drcErrors ?? 0) + (c.unconnected ?? 0), c.drcWarnings ?? 0), pill('ERC', c.ercErrors ?? 0, c.ercWarnings ?? 0)]
</script>

<template>
  <span class="pills">
    <span v-for="p in pills" :key="p.check" class="pill" :class="p.tone">{{ p.text }}</span>
  </span>
</template>

<style scoped>
.pills {
  display: inline-flex;
  gap: 6px;
  flex: none;
}
.pill {
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 20px;
  font-weight: 500;
  white-space: nowrap;
}
.ok {
  color: var(--vp-c-green-1);
  background: var(--vp-c-green-soft);
}
.warn {
  color: var(--vp-c-yellow-1);
  background: var(--vp-c-yellow-soft);
}
.bad {
  color: var(--vp-c-red-1);
  background: var(--vp-c-red-soft);
}
</style>
