<script setup lang="ts">
// the top of every page in dev: the compile's line, the sync notice and the server gone
import type { Shell } from '@pcbjs/ui'
import type { CompileLine } from './compile-line'
import ServerGone from './ServerGone.vue'

const props = defineProps<{ shell: Shell; line: CompileLine }>()
const live = props.shell.live
const reload = () => location.reload()
</script>

<template>
  <div v-if="line.recompiling.value && line.segments.value.length" class="load-line stages" aria-hidden="true">
    <span v-for="g in line.segments.value" :key="g.name" :class="[g.state, { unknown: g.fill < 0 }]" :title="g.name"
      ><i :style="{ width: Math.max(0, g.fill) * 100 + '%' }"></i
    ></span>
  </div>
  <div v-else-if="line.recompiling.value" class="load-line" :class="{ unknown: line.loadLine.value === null }" aria-hidden="true">
    <span :style="{ width: (line.loadLine.value ?? 1) * 100 + '%' }"></span>
  </div>
  <div v-if="live.notice" class="sync-notice" role="status">
    <span>{{ live.notice.repeated ? 'The view cannot stay in sync' : 'View resynced after falling out of sync' }}</span>
    <button v-if="live.notice.repeated" class="btn" @click="reload">Reload</button>
    <button
      class="btn"
      :disabled="!live.notice.url"
      :title="live.notice.file ? `opens an issue with ${live.notice.file} as text; nothing is sent until you submit it` : 'writing the incident'"
      @click="line.report"
    >
      Report
    </button>
    <button class="icon" aria-label="Dismiss" title="Dismiss" @click="live.notice = null"><span aria-hidden="true">×</span></button>
  </div>
  <ServerGone v-if="line.load.value?.phase === 'gone'" />
</template>
