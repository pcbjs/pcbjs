<script setup lang="ts">
import type { View } from '../../examples.data'
// codicons by Microsoft, CC BY 4.0, https://github.com/microsoft/vscode-codicons: the VS Code extension's view buttons
import Board from '@vscode/codicons/src/icons/circuit-board.svg'
import Model from '@vscode/codicons/src/icons/package.svg'
import Schematic from '@vscode/codicons/src/icons/type-hierarchy-sub.svg'
import Full from '@vscode/codicons/src/icons/screen-full.svg'

defineProps<{ views: View[]; label: string; full?: string }>()
const view = defineModel<View>({ required: true })
const TABS = [
  { view: '2d', text: '2D', title: '2D view', icon: Board },
  { view: '3d', text: '3D', title: '3D view', icon: Model },
  { view: 'sch', text: 'Schematic', title: 'Schematic', icon: Schematic },
] as const
</script>

<template>
  <div class="view-tabs">
    <div class="group" role="tablist" :aria-label="label">
      <button
        v-for="t in TABS.filter(t => views.includes(t.view))"
        :key="t.view"
        type="button"
        role="tab"
        :title="t.title"
        :aria-selected="view === t.view"
        :class="{ on: view === t.view }"
        @click="view = t.view"
      >
        <component :is="t.icon" class="icon" aria-hidden="true" /><span class="text">{{ t.text }}</span>
      </button>
    </div>
    <a v-if="full" class="full" :href="full" title="Full screen"><Full class="icon" aria-hidden="true" /><span class="text">Full screen</span></a>
  </div>
</template>

<style scoped>
.view-tabs {
  display: flex;
  gap: 6px;
  font-family: var(--vp-font-family-base);
}
.group,
.full {
  display: flex;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  overflow: hidden;
  background: var(--vp-c-bg);
}
button,
.full {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 12px;
  line-height: 20px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
  white-space: nowrap;
  text-decoration: none;
}
button + button {
  border-left: 1px solid var(--vp-c-divider);
}
button:hover,
.full:hover {
  color: var(--vp-c-text-1);
}
button.on {
  background: var(--vp-c-brand-3);
  color: #fff;
}
.icon {
  width: 14px;
  height: 14px;
  flex: none;
}
/* in a narrow card the full screen link, then the views but the active one, keep only their icon, named by their title */
@container (max-width: 400px) {
  .full .text {
    display: none;
  }
}
@container (max-width: 300px) {
  button:not(.on) .text {
    display: none;
  }
}
</style>
