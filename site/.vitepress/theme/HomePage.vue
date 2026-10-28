<script setup lang="ts">
import { h, onBeforeUnmount, ref } from 'vue'
import { withBase } from 'vitepress'
import { data } from '../../home.data'
import BoardSvg from './BoardSvg.vue'
import MapDemo from './MapDemo.vue'

const INSTALL = 'npm install -D @pcbjs/pcbjs@beta'
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
const rows = [
  { title: 'Route by hand, or leave a leg to the router', snip: data.route, view: '2d' as const },
  { title: 'Pours join their pads through thermals', snip: data.pour, view: '2d' as const },
  { title: 'DRC points at the line', snip: data.drc, view: '2d' as const },
  { title: 'The schematic is code too', snip: data.schematic, view: 'sch' as const },
]
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
      <p class="then">then <code>npx pcbjs create my-board</code> · <a :href="withBase('/getting-started')">Getting started</a></p>
    </section>

    <MapDemo :hero="data.hero" />

    <section class="rows">
      <div v-for="r in rows" :key="r.title" class="row">
        <div class="text">
          <h2>{{ r.title }}</h2>
          <pre class="hc" v-html="r.snip.html" />
          <p v-if="r.snip.drc" class="finding">
            <span class="err">error</span> {{ r.snip.drc.rule }} <span class="where">{{ at(r.snip.drc.src) }}</span> {{ r.snip.drc.message }}
          </p>
        </div>
        <div class="result">
          <BoardSvg :id="r.snip.id" :view="r.view" :label="`${r.title}: the board this code compiles to`" lazy />
        </div>
      </div>
      <div class="row">
        <div class="text">
          <h2>Ready to order, and to share</h2>
          <pre class="hc" v-html="data.fab.html" />
          <p class="note">Gerbers, drills, BOM and placement, zipped, and a static viewer site for the board.</p>
        </div>
        <div class="result fab">
          <div class="status">{{ data.fab.status }}</div>
          <ul>
            <li v-for="f in data.fab.files" :key="f">{{ f }}</li>
          </ul>
          <div class="zip">{{ data.fab.zip }}</div>
        </div>
      </div>
    </section>

    <nav class="links" aria-label="More">
      <a :href="withBase('/docs/quickstart')">Docs</a>
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
.finding,
.fab {
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
.finding,
.note {
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
.fab {
  font-size: 12px;
  padding: 14px 16px;
  background: var(--vp-c-bg-alt);
}
.fab ul {
  list-style: none;
  margin: 8px 0;
  padding: 0;
  columns: 2;
  color: var(--vp-c-text-2);
}
.status {
  color: var(--vp-c-green-1, #2aa366);
  font-weight: 600;
}
.zip {
  color: var(--vp-c-text-1);
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
  .fab ul {
    columns: 1;
  }
}
</style>
