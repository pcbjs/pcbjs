<script setup lang="ts">
import { topicLink } from '../../scripts/development.mjs'
import { h, onBeforeUnmount, reactive, ref } from 'vue'
import { withBase } from 'vitepress'
import { data } from '../../home.data'
import { data as gallery } from '../../features.data'
import type { View } from '../../examples.data'
import boards from 'virtual:site-boards'
import LiveBoard from './LiveBoard.vue'
import MapDemo from './MapDemo.vue'
import StatusPill from './StatusPill.vue'
import ViewTabs from './ViewTabs.vue'
import { CATEGORY, md } from './text'

const INSTALL = 'npm i -D @pcbjs/pcbjs'
const github = 'https://github.com/pcbjs/pcbjs'
const copied = ref(false)
let reset: ReturnType<typeof setTimeout> | undefined

async function copy() {
  await navigator.clipboard.writeText(INSTALL)
  copied.value = true
  clearTimeout(reset)
  reset = setTimeout(() => (copied.value = false), 1500)
}
onBeforeUnmount(() => clearTimeout(reset))

// the token colours of every highlighted block, light and dark
const Palette = () => h('style', data.css)
const at = (src: string) => src.replace(/:\d+$/, '')
// the key cards of the catalogue, one row each, in the order of its categories
const keys = gallery.features.filter(f => f.key)
const views = reactive(keys.map(f => f.view as View))
</script>

<template>
  <div class="home">
    <Palette />
    <section class="hero">
      <h1>PCB design with TSX</h1>
      <p class="lede">A board is a TypeScript module: pcbjs places, routes and checks it, then writes the Gerbers.</p>
      <div class="install">
        <code><span class="prompt">$</span> {{ INSTALL }}</code>
        <button type="button" :aria-label="copied ? 'Copied' : 'Copy the install command'" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
      </div>
      <p class="then">then <code>npx pcbjs create my-board</code> · <a :href="withBase('/guide/getting-started/')">Getting started</a></p>
    </section>

    <MapDemo :hero="data.hero" />

    <section class="rows">
      <article v-for="(f, i) in keys" :key="f.id" class="row key-card">
        <div class="text">
          <p class="meta">
            <a :href="withBase(`/features#${f.category}`)">{{ CATEGORY[f.category] }}</a> <StatusPill :status="f.status" />
          </p>
          <h2>{{ f.title }}</h2>
          <p class="summary" v-html="md(f.summary ?? '')" />
          <pre v-if="f.snippet" class="hc" v-html="data.snippets[f.snippet]" />
          <p v-if="f.drc" class="finding">
            <span class="err">error</span> {{ f.drc.rule }} <span class="where">{{ at(f.drc.src) }}</span> {{ f.drc.message }}
          </p>
          <p class="more">
            <code>{{ f.flag }}</code> · <a :href="withBase(topicLink(f.docs))">Docs</a> ·
            <a :href="withBase(`/features#${f.category}`)">All {{ CATEGORY[f.category].toLowerCase() }} features</a>
          </p>
        </div>
        <div class="result board">
          <LiveBoard class="live" :board="boards[f.board!]" :view="views[i]" :tools="false" :label="`${f.title}: its demo board`" />
          <ViewTabs class="tabs" v-model="views[i]" :views="f.views!" :label="`${f.title} view`" :full="f.page ? withBase(`/examples/${f.board}`) : undefined" />
        </div>
      </article>
      <p class="all"><a :href="withBase('/features')">Every feature, and the roadmap</a></p>
    </section>

    <nav class="links" aria-label="More">
      <a :href="withBase('/guide/getting-started/quickstart')">Docs</a>
      <a :href="withBase('/features')">Features</a>
      <a :href="withBase('/examples')">Examples</a>
      <a :href="github" target="_blank" rel="noreferrer">GitHub</a>
      <a href="https://www.npmjs.com/package/@pcbjs/pcbjs" target="_blank" rel="noreferrer">npm</a>
    </nav>
  </div>
</template>

<style scoped>
.home {
  max-width: 1152px;
  margin: 0 auto;
  padding: 48px 24px 64px;
}
.hero {
  text-align: center;
  margin-bottom: 40px;
}
h1 {
  font-size: 56px;
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: -0.02em;
  background: var(--vp-home-hero-name-background);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.lede {
  margin: 16px auto 0;
  max-width: 560px;
  font-size: 19px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}
.install {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  margin-top: 28px;
  padding: 10px 10px 10px 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  max-width: 100%;
}
.install code {
  font-size: 17px;
  white-space: nowrap;
  overflow-x: auto;
}
.prompt {
  color: var(--vp-c-text-3);
  user-select: none;
}
.install button {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  color: #fff;
  background: var(--vp-c-brand-3);
}
.install button:hover {
  background: var(--vp-c-brand-2);
}
.then {
  margin-top: 12px;
  font-size: 14px;
  color: var(--vp-c-text-2);
}
.then code,
.finding {
  font-family: var(--vp-font-family-mono);
}
.then code {
  font-size: 13px;
}
.then a {
  color: var(--vp-c-brand-1);
  font-weight: 500;
}
.rows {
  margin-top: 64px;
  display: grid;
  gap: 48px;
}
.row {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 32px;
  align-items: center;
}
h2 {
  font-size: 22px;
  font-weight: 600;
  margin: 0 0 12px;
  border: 0;
  padding: 0;
}
pre {
  margin: 0;
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--vp-c-bg-alt);
  overflow-x: auto;
  font-size: 12.5px;
  line-height: 1.6;
}
.meta {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  gap: 8px;
  align-items: center;
}
.meta a {
  color: var(--vp-c-brand-1);
}
.summary {
  margin: 0 0 12px;
  color: var(--vp-c-text-2);
}
.finding,
.more {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.err {
  color: var(--vp-c-red-1);
}
.where {
  color: var(--vp-c-text-1);
}
.result {
  border-radius: 10px;
  overflow: hidden;
  background: var(--pcb-canvas);
  padding: 12px;
}
.board {
  position: relative;
  aspect-ratio: 4 / 3;
  padding: 44px 12px 12px;
}
.board > .live {
  position: absolute;
  inset: 44px 12px 12px;
  width: auto;
  height: auto;
}
.board > .tabs {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1;
}
.more a,
.all a {
  color: var(--vp-c-brand-1);
  font-weight: 500;
}
.all {
  margin: 0;
  text-align: center;
  font-size: 16px;
}
.links {
  display: flex;
  justify-content: center;
  gap: 32px;
  margin-top: 72px;
  padding-top: 24px;
  border-top: 1px solid var(--vp-c-divider);
  font-weight: 500;
}
.links a {
  color: var(--vp-c-text-2);
}
.links a:hover {
  color: var(--vp-c-brand-1);
}
@media (max-width: 768px) {
  .home {
    padding: 32px 16px 48px;
  }
  h1 {
    font-size: 38px;
  }
  .lede {
    font-size: 17px;
  }
  .install {
    gap: 8px;
    padding: 8px 8px 8px 12px;
  }
  .install code {
    font-size: 12.5px;
  }
  .install button {
    padding: 5px 10px;
  }
  .row {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
}
</style>
