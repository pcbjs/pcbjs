<script setup lang="ts">
import { reactive } from 'vue'
import { withBase } from 'vitepress'
import { data as projects, type Card, type View } from '../../examples.data'
import BoardFrame from './BoardFrame.vue'
import BoardSvg from './BoardSvg.vue'
import Pills from './Pills.vue'
import ViewTabs from './ViewTabs.vue'

const view = reactive<Record<string, View>>({})
const LABEL = { '2d': '2D', '3d': '3D', sch: 'Schematic' } as const
const shown = (b: Card): View => view[b.id] ?? (b.viewer ? '3d' : '2d')
const first = (s: string) => /^.*?\.(?=\s|$)/.exec(s)?.[0] ?? s
const md = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
</script>

<template>
  <section v-for="p in projects" :key="p.project" class="project">
    <h2 :id="p.project.replace('/', '-')">examples/{{ p.project }}</h2>
    <p v-if="p.about" class="about" v-html="md(first(p.about))" />
    <p v-if="p.known && p.known !== 'none'" class="known"><strong>Known findings:</strong> <span v-html="md(first(p.known))" /></p>
    <div class="cards">
      <article v-for="b in p.boards" :key="b.id" class="card">
        <div class="shot">
          <BoardFrame
            v-if="b.viewer"
            :id="b.id"
            :tools="false"
            :viewer="b.viewer"
            :name="b.name"
            :view="shown(b)"
            :poster="shown(b) === 'sch' ? 'sch' : '2d'"
            :label="`${b.name}, ${LABEL[shown(b)]}`"
            @view="v => (view[b.id] = v)"
          />
          <BoardSvg v-else-if="b.aspect[shown(b)]" :key="`${b.id}-${shown(b)}`" :id="b.id" :view="shown(b)" :label="`${b.name}, ${LABEL[shown(b)]}`" lazy />
          <div class="name">{{ b.name }}</div>
          <ViewTabs
            class="tabs"
            :model-value="shown(b)"
            @update:model-value="v => (view[b.id] = v)"
            :views="b.views"
            :label="`${b.name} view`"
            :full="withBase(`/examples/${b.id}`)"
          />
        </div>
        <p class="body">
          <Pills :counts="b.counts" /> <span v-if="b.summary" class="summary">{{ b.summary }}</span>
        </p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.project {
  margin-top: 40px;
}
.project h2 {
  border-top: 0;
  margin-top: 0;
  padding-top: 0;
}
.about {
  color: var(--vp-c-text-1);
}
.known {
  font-size: 14px;
  color: var(--vp-c-text-2);
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  margin-top: 16px;
}
.card {
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
  container-type: inline-size;
}
.shot {
  position: relative;
  background: var(--pcb-canvas);
  aspect-ratio: 1;
}
.shot > .board-svg {
  height: 100%;
  padding: 40px 8px 8px;
}
/* the frame sits below the strip of the name and the tabs, clear of the viewer's own buttons */
.shot > .board-frame {
  position: absolute;
  inset: 40px 0 0;
  height: auto;
  width: auto;
}
.shot :deep(.poster) {
  padding: 0 8px 8px;
}
.name,
.tabs {
  position: absolute;
  top: 8px;
  z-index: 1;
}
.name {
  left: 10px;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  line-height: 26px;
  color: var(--vp-c-text-1);
  pointer-events: none;
}
.tabs {
  right: 8px;
}
.body {
  margin: 0;
  padding: 10px 14px 12px;
  font-size: 14px;
  line-height: 1.5;
}
.summary {
  color: var(--vp-c-text-2);
}
</style>
