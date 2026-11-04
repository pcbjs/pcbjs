<script setup lang="ts">
import { reactive } from 'vue'
import { withBase } from 'vitepress'
import boards from 'virtual:site-boards'
import { data, type Card, type View } from '../../examples.data'
import LiveBoard from './LiveBoard.vue'
import Pills from './Pills.vue'
import ViewTabs from './ViewTabs.vue'
import { first, md } from './text'

const view = reactive<Record<string, View>>({})
const LABEL = { '2d': '2D', '3d': '3D', sch: 'Schematic' } as const
const shown = (b: Card): View => view[b.id] ?? '3d'
// the basic path first, its cards naming their folder, then each advanced project after the divider
const sections = [
  {
    id: 'basic',
    title: 'Basic',
    about: `The three boards of the basic path, which <a href="${withBase('/docs/basics')}">Basics</a> walks step by step: start with these.`,
    known: '',
    basic: true,
    boards: data.basic.map(b => ({ ...b, summary: md(b.about) })),
  },
  ...data.advanced.map(p => ({
    id: p.project.replace('/', '-'),
    title: `examples/${p.project}`,
    about: md(first(p.about)),
    known: p.known,
    basic: false,
    boards: p.boards.map(b => ({ ...b, summary: md(b.summary) })),
  })),
]
</script>

<template>
  <template v-for="(p, i) in sections" :key="p.id">
    <div v-if="i === 1" class="level-divider" role="separator"><span>Advanced</span></div>
    <section class="project" :class="{ basic: p.basic }">
      <h2 :id="p.id">{{ p.title }}</h2>
      <p v-if="p.about" class="about" v-html="p.about" />
      <p v-if="p.known && p.known !== 'none'" class="known"><strong>Known findings:</strong> <span v-html="md(first(p.known))" /></p>
      <div class="cards">
        <article v-for="b in p.boards" :key="b.id" class="card">
          <div class="shot">
            <LiveBoard class="live" :board="boards[b.id]" :tools="false" :view="shown(b)" :label="`${b.name}, ${LABEL[shown(b)]}`" />
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
            <Pills :counts="b.counts" /> <span v-if="p.basic" class="where">examples/{{ b.project }}</span>
            <span v-if="b.summary" class="summary" v-html="b.summary" />
          </p>
        </article>
      </div>
    </section>
  </template>
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
/* the view sits below the strip of the name and the tabs */
.shot > .live {
  position: absolute;
  inset: 40px 8px 8px;
  height: auto;
  width: auto;
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
.where {
  display: block;
  margin: 4px 0 2px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.level-divider {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 56px 0 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-text-2);
}
.level-divider::before,
.level-divider::after {
  content: '';
  flex: 1;
  border-top: 1px solid var(--vp-c-divider);
}
</style>
