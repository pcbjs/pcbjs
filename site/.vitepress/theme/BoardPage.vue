<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useData } from 'vitepress'
import { PcbViewer, useBoard } from '@pcbjs/ui'
import boards from 'virtual:site-boards'
import { data as examples, type View } from '../../examples.data'
import Pills from './Pills.vue'
import ViewTabs from './ViewTabs.vue'

const { params } = useData()
const card = computed(() => [...examples.basic, ...examples.advanced.flatMap(p => p.boards)].find(b => b.id === params.value?.board))
const board = computed(() => (card.value ? boards[card.value.id] : undefined))
const source = computed(() => (board.value ? useBoard(board.value) : undefined))
// the viewer's own view, which its switch and these tabs both set
const view = ref<View>('3d')
watch(card, () => (view.value = '3d'))
const poster = computed(() => (view.value === 'sch' ? board.value?.poster.sch : board.value?.poster['2d']))
</script>

<template>
  <div v-if="card && board" class="board-page">
    <header>
      <h1>{{ card.name }}</h1>
      <span class="project">examples/{{ card.project }}</span>
      <Pills :counts="card.counts" />
      <span class="gap" />
      <a class="source" :href="card.source" target="_blank" rel="noreferrer">Source</a>
      <ViewTabs v-model="view" :views="card.views" :label="`${card.name} view`" />
    </header>
    <div class="stage">
      <PcbViewer :key="card.id" v-model:view="view" :board="board" />
      <img v-if="source?.state !== 'ready' && poster" class="poster" :src="poster" :alt="card.name" />
    </div>
  </div>
</template>

<style scoped>
.board-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--vp-nav-height));
}
header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 14px;
  padding: 10px 24px;
  border-bottom: 1px solid var(--vp-c-divider);
}
h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
}
.project {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.gap {
  flex: 1;
}
.source {
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.source:hover {
  color: var(--vp-c-brand-1);
}
.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--pcb-canvas);
}
.stage > .pcbjs-viewer {
  height: 100%;
}
.poster {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 24px;
  object-fit: contain;
  background: var(--pcb-canvas);
}
@media (max-width: 768px) {
  header {
    padding: 10px 16px;
  }
}
</style>
