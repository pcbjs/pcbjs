<script setup lang="ts">
// an editor's pane: the compile's line and notices around the pane its entry of @pcbjs/ui gives, one view and its chip, no top bar
import { computed, inject, type Component } from 'vue'
import type { Shell } from '@pcbjs/ui'
import LoadScreen from './LoadScreen.vue'
import Notices from './Notices.vue'
import { useCompileLine } from './compile-line'

defineProps<{ pane: Component }>()
// provided under the key STORE names, a global symbol, so the pane reads it without loading the whole of @pcbjs/ui
const shell = inject<Shell>(Symbol.for('pcbjs:store'))!
const { ide, state } = shell
const line = useCompileLine(shell)
const { load, loadStatus, holdText, covering, idleHint } = line
const error = shell.currentError
const drawer = computed(() => (shell.shown.value ? shell.pane(shell.shown.value.name).drawer : null))
// the pane remounts for each board shown
const paneKey = computed(() => shell.shown.value?.name ?? '')
</script>

<template>
  <div class="app pcbjs-ui ide" :class="{ bare: !ide.panel, 'drawer-layers': drawer === 'layers', 'drawer-panel': drawer === 'panel' }">
    <Notices :shell="shell" :line="line" />
    <component :is="pane" :key="paneKey" :status="loadStatus || holdText">
      <template #empty>
        <LoadScreen v-if="!error && load" :hint="idleHint" />
        <div v-else-if="!error" class="empty">{{ state.loading ? 'Loading…' : 'Compiling…' }}</div>
      </template>
      <template #overlay>
        <LoadScreen v-if="covering" class="cover" />
      </template>
    </component>
  </div>
</template>
