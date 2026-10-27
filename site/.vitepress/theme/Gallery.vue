<script setup lang="ts">
import { reactive } from 'vue'
import { withBase } from 'vitepress'
import { data as projects } from '../../examples.data'

const view = reactive<Record<string, '2d' | '3d' | 'sch'>>({})
const LABEL = { '3d': '3D', '2d': '2D', sch: 'Schematic' } as const
const shown = (id: string) => view[id] ?? '3d'
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const seconds = (ms: number) => ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
const md = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/`([^`]+)`/g, '<code>$1</code>')
</script>

<template>
  <section v-for="p in projects" :key="p.project" class="project">
    <h2 :id="p.project.replace('/', '-')">
      <a :href="p.source" target="_blank" rel="noreferrer">examples/{{ p.project }}</a>
    </h2>
    <p v-if="p.about" class="about" v-html="md(p.about)" />
    <p v-if="p.known && p.known !== 'none'" class="known"><strong>Known findings:</strong> <span v-html="md(p.known)" /></p>
    <div class="cards">
      <article v-for="b in p.boards" :key="b.id" class="card">
        <div class="shot">
          <img v-if="b.shots[shown(b.id)]" :src="withBase(b.shots[shown(b.id)]!)" :alt="`${b.name}, ${shown(b.id)} view`" loading="lazy" width="600" height="605" />
          <div v-else class="none">no shot yet</div>
          <div class="views" role="group" :aria-label="`${b.name} view`">
            <button v-for="v in (['3d', '2d', 'sch'] as const)" :key="v" :class="{ on: shown(b.id) === v }" :disabled="!b.shots[v]" @click="view[b.id] = v">{{ LABEL[v] }}</button>
          </div>
        </div>
        <div class="body">
          <h3><a :href="b.source" target="_blank" rel="noreferrer">{{ b.name }}</a> <code>{{ b.entry }}</code></h3>
          <p v-if="b.summary" class="summary">{{ b.summary }}</p>
          <ul class="numbers">
            <li>{{ plural(b.stats.footprints, 'part') }}</li>
            <li>{{ plural(b.stats.pads, 'pad') }}</li>
            <li>{{ plural(b.stats.tracks, 'track') }}</li>
            <li>{{ plural(b.stats.vias, 'via') }}</li>
            <li>{{ plural(b.stats.nets, 'net') }}</li>
            <li v-if="b.routing?.legs">{{ b.routing.routed }} of {{ plural(b.routing.legs, 'autorouted leg') }}</li>
            <li v-if="b.models?.missing">{{ b.models.missing }} with no 3D model</li>
          </ul>
          <p class="status" :class="b.counts.drcErrors + b.counts.ercErrors + b.counts.unconnected ? 'bad' : b.counts.drcWarnings + b.counts.ercWarnings ? 'warn' : 'ok'">
            DRC {{ plural(b.counts.drcErrors, 'error') }}, {{ plural(b.counts.drcWarnings, 'warning') }} · ERC {{ plural(b.counts.ercErrors, 'error') }}, {{ plural(b.counts.ercWarnings, 'warning') }} · compiled in {{ seconds(b.ms) }}
          </p>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.project { margin-top: 40px; }
.project h2 { border-top: 0; margin-top: 0; padding-top: 0; }
.about { color: var(--vp-c-text-1); }
.known { font-size: 14px; color: var(--vp-c-text-2); }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; margin-top: 16px; }
.card { border: 1px solid var(--vp-c-divider); border-radius: 10px; overflow: hidden; background: var(--vp-c-bg-soft); display: flex; flex-direction: column; }
.shot { position: relative; background: #111214; aspect-ratio: 600 / 605; }
.shot img { display: block; width: 100%; height: 100%; object-fit: cover; }
.none { display: grid; place-items: center; height: 100%; color: #888; font-size: 14px; }
.views { position: absolute; top: 8px; right: 8px; display: flex; border-radius: 6px; overflow: hidden; border: 1px solid #3a3d44; }
.views button { padding: 2px 10px; font-size: 12px; color: #c8ccd2; background: #1b1d21; }
.views button.on { background: var(--vp-c-brand-3); color: #fff; }
.views button:disabled { opacity: 0.4; }
.body { padding: 12px 16px 14px; }
.body h3 { margin: 0; font-size: 17px; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.summary { margin: 8px 0 0; font-size: 14px; line-height: 1.5; color: var(--vp-c-text-2); }
.numbers { display: flex; flex-wrap: wrap; gap: 4px 12px; list-style: none; padding: 0; margin: 10px 0 0; font-size: 13px; }
.numbers li { margin: 0; }
.status { margin: 8px 0 0; font-size: 13px; }
.status.ok { color: var(--vp-c-green-1, #2aa366); }
.status.warn { color: var(--vp-c-yellow-1); }
.status.bad { color: var(--vp-c-red-1); }
</style>
