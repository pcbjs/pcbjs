<script setup lang="ts">
import { computed, ref } from 'vue'
import { useData } from 'vitepress'
import { data as projects, type View } from '../../examples.data'
import BoardFrame from './BoardFrame.vue'
import BoardSvg from './BoardSvg.vue'
import Pills from './Pills.vue'
import ViewTabs from './ViewTabs.vue'

const { params } = useData()
const board = computed(() => projects.flatMap(p => p.boards).find(b => b.id === params.value?.board))
const view = ref<View>(board.value?.viewer ? '3d' : '2d')
</script>

<template>
  <div v-if="board" class="board-page">
    <header>
      <h1>{{ board.name }}</h1>
      <span class="project">examples/{{ board.project }}</span>
      <Pills :counts="board.counts" />
      <span class="gap" />
      <a class="source" :href="board.source" target="_blank" rel="noreferrer">Source</a>
      <ViewTabs v-model="view" :views="board.views" :label="`${board.name} view`" />
    </header>
    <div class="stage">
      <BoardFrame
        v-if="board.viewer"
        :key="board.id"
        :id="board.id"
        :viewer="board.viewer"
        :name="board.name"
        :view="view"
        :poster="view === 'sch' ? 'sch' : '2d'"
        :label="board.name"
        armed
        @view="v => (view = v)"
      />
      <BoardSvg v-else :key="view" :id="board.id" :view="view" :label="board.name" />
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
.stage > .board-svg,
.stage :deep(.poster) {
  height: 100%;
  padding: 24px;
}
@media (max-width: 768px) {
  header {
    padding: 10px 16px;
  }
}
</style>
