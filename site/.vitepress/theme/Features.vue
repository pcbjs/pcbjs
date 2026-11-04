<script setup lang="ts">
import { topicLink } from '../../scripts/development.mjs'
import { withBase } from 'vitepress'
import boards from 'virtual:site-boards'
import { data } from '../../features.data'
import LiveBoard from './LiveBoard.vue'
import StatusPill from './StatusPill.vue'
import { CATEGORY, md } from './text'

const LABEL = { '2d': '2D', '3d': '3D', sch: 'schematic' } as const
const of = (c: string) => data.features.filter(f => f.category === c)
const built = (c: string) => of(c).filter(f => f.status !== 'planned')
const planned = (c: string) => of(c).filter(f => f.status === 'planned')
const roadmap = data.categories.filter(c => planned(c).length)
</script>

<template>
  <nav class="jump" aria-label="Categories">
    <a v-for="c in data.categories" :key="c" :href="`#${c}`"
      >{{ CATEGORY[c] }} <span>{{ built(c).length }}</span></a
    >
    <a href="#roadmap"
      >Roadmap <span>{{ data.features.filter(f => f.status === 'planned').length }}</span></a
    >
  </nav>

  <section v-for="c in data.categories" :key="c" class="category">
    <h2 :id="c">{{ CATEGORY[c] }}</h2>
    <div class="cards">
      <article v-for="f in built(c)" :key="f.id" :id="`${c}-${f.id}`" class="feature">
        <div class="shot">
          <LiveBoard class="live" :board="boards[f.board!]" :view="f.view!" :tools="false" :label="`${f.title}, ${LABEL[f.view!]}`" />
        </div>
        <div class="body">
          <h3>{{ f.title }} <StatusPill :status="f.status" /></h3>
          <p class="summary" v-html="md(f.summary ?? '')" />
          <p class="links">
            <code>{{ f.flag }}</code>
            <span class="gap" />
            <a :href="withBase(topicLink(f.docs))">Docs</a>
            <a v-if="f.page" :href="withBase(`/examples/${f.board}`)">Board</a>
          </p>
        </div>
      </article>
    </div>
  </section>

  <section class="category">
    <h2 id="roadmap">Roadmap</h2>
    <div class="roadmap">
      <div v-for="c in roadmap" :key="c">
        <h3>{{ CATEGORY[c] }}</h3>
        <ul>
          <li v-for="f in planned(c)" :key="f.id">{{ f.title }}</li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.jump {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}
.jump a {
  padding: 2px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-1);
  text-decoration: none;
}
.jump a:hover {
  border-color: var(--vp-c-brand-1);
}
.jump span {
  color: var(--vp-c-text-3);
}
.category {
  margin-top: 40px;
}
.category h2 {
  border-top: 0;
  margin-top: 0;
  padding-top: 0;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
  margin-top: 16px;
}
.feature {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
}
.shot {
  position: relative;
  aspect-ratio: 4 / 3;
  background: var(--pcb-canvas);
}
.shot > .live {
  position: absolute;
  inset: 8px;
  width: auto;
  height: auto;
}
.body {
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: 10px 14px 12px;
}
.body h3 {
  margin: 0;
  font-size: 16px;
  line-height: 1.4;
}
.summary {
  flex: 1;
  margin: 6px 0 8px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}
.links {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0;
  font-size: 13px;
}
.links code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.links .gap {
  flex: 1;
}
.links a {
  font-weight: 500;
  white-space: nowrap;
}
.roadmap {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px 24px;
}
.roadmap h3 {
  margin: 8px 0 0;
  font-size: 15px;
}
.roadmap ul {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 14px;
  color: var(--vp-c-text-2);
}
</style>
