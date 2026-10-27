<script setup lang="ts">
// a workspace dev server with several projects lists the projects instead
import { computed } from 'vue'
import type { SiteData } from '@pcbjs/core/site-data'
import { checkSummary, useStore } from './state'
import { targetName, worstTarget } from './variants'
import { unsourcedCount, type BomRow } from './sourcing'
import Menu from './Menu.vue'

const { asset, boardHref, cards, workspaceHome, scopeCards } = useStore()
const scopePill = (s: { status: string; stale: boolean }) => (s.status === 'unloaded' ? { cls: 'dim', text: 'not loaded' } : s.status === 'error' ? { cls: 'err', text: 'error' } : s.status === 'incomplete' ? { cls: 'warn', text: 'DRC errors' } : { cls: 'ok', text: 'ok' })
const boardLink = (route: string, name: string) => `${route}board/${encodeURIComponent(name)}`
const THUMB_LAYERS = ['F.Cu', 'F.SilkS', 'Edge.Cuts']
const thumbLayers = (b: SiteData) => THUMB_LAYERS.map(id => b.layers.find(l => l.id === id)).filter(l => !!l && l.svg)
const substrate = (b: SiteData) => b.outline.map(r => 'M' + r.map(p => p.join(' ')).join('L') + 'Z').join('')
const mm = (v: number) => +v.toFixed(2)
// the first error line, joined with the next when it only introduces it; absolute paths shrink to the file name
function firstLine(e: string) {
  const ls = e.split('\n').map(l => l.trim()).filter(Boolean)
  const line = ls[0]?.endsWith(':') && ls[1] ? `${ls[0]} ${ls[1]}` : ls[0] ?? e
  return line.replace(/(?:\/[^\s/:]+)+\/([^\s/:]+(?::\d+)+)/g, '$1')
}
// a board with several targets shows the worst target's DRC in its pill and every target as a chip
const list = computed(() => cards.value.map(c => {
  const multi = c.targets.length > 1
  const shown = multi ? worstTarget(c.targets) : c.board
  const targets = multi ? c.targets.map(t => ({ name: targetName(t) ?? t.name, board: t, drc: checkSummary(t) })) : []
  const drc = shown ? checkSummary(shown) : null
  const title = multi ? targets.map(t => `${t.name}: ${t.drc.text}`).join('\n') : drc?.title ?? ''
  // old data without sourcing falls back to the MPN field
  const unsourced = shown ? unsourcedCount(shown.bom as BomRow[]) : 0
  return { ...c, drc, targets, title, unsourced }
}))
</script>

<template>
  <main v-if="workspaceHome" class="home">
    <div v-if="!scopeCards.length" class="empty">No projects: no pcb.config.* under the workspace folders</div>
    <ul class="cards">
      <li v-for="s in scopeCards" :key="s.slug" class="card" :class="{ err: s.status === 'error' }">
        <div class="card-body">
          <div class="card-head">
            <a class="title" :href="s.route">{{ s.name }}</a>
            <span v-if="s.stale" class="pill sm dim" title="a file changed; it recompiles when shown">stale</span>
            <span class="pill sm" :class="scopePill(s).cls">{{ scopePill(s).text }}</span>
          </div>
          <div class="card-meta"><span>{{ s.dir }}</span><span v-if="s.displayed">shown</span></div>
          <div v-if="s.boards.length" class="card-targets" aria-label="Boards">
            <a v-for="b in s.boards" :key="b.name" class="chip target" :href="boardLink(s.route, b.name)"><span class="dot" :class="b.status === 'ok' ? 'ok' : 'err'"></span>{{ b.title || b.name }}</a>
          </div>
          <div v-if="s.error" class="card-error" :title="s.error">{{ firstLine(s.error) }}</div>
          <div class="card-foot"><code class="entry">{{ s.route }}</code></div>
        </div>
      </li>
    </ul>
  </main>
  <main v-else class="home">
    <div v-if="!list.length" class="empty">No boards</div>
    <ul class="cards">
      <li v-for="c in list" :key="c.entry || c.board?.name" class="card" :class="{ err: c.error }">
        <div class="thumb" :class="{ none: !c.board }">
          <svg v-if="c.board" :viewBox="c.board.viewBox.join(' ')" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path class="substrate" fill-rule="evenodd" :d="substrate(c.board)" />
            <g v-for="l in thumbLayers(c.board)" :key="l!.id" class="layer" :data-kind="l!.kind" :style="{ color: l!.color }" v-html="l!.svg"></g>
            <g class="holes" v-html="c.board.holes"></g>
          </svg>
          <span v-else>no board</span>
        </div>
        <div class="card-body">
          <div class="card-head">
            <a v-if="c.board" class="title stretch" :href="boardHref(c.board.name)">{{ c.board.title || c.board.name }}</a>
            <span v-else class="title">{{ c.entry }}</span>
            <span v-if="c.error" class="pill sm err">compile error</span>
            <span v-else-if="c.drc" class="pill sm" :class="c.drc.state" :title="c.title">{{ c.drc.erc ? c.drc.label : c.drc.state === 'ok' ? 'DRC ok' : c.drc.text }}</span>
          </div>
          <div v-if="c.board" class="card-meta">
            <span v-if="c.board.title && c.board.title !== c.board.name">{{ c.board.name }}</span>
            <span v-if="c.board.revision">rev {{ c.board.revision }}</span>
            <span>{{ mm(c.board.bbox.w) }} × {{ mm(c.board.bbox.h) }} mm</span>
            <span>{{ c.board.copper }} copper</span>
            <span>{{ c.board.stats.footprints }} parts</span>
            <span v-if="c.unsourced" class="unsourced" title="BOM rows without a part number">{{ c.unsourced }} unsourced</span>
          </div>
          <div v-if="c.targets.length" class="card-targets" aria-label="Fab targets">
            <a v-for="t in c.targets" :key="t.name" class="chip target" :href="boardHref(c.board!.name, t.name)" :title="`${t.name}: ${t.drc.text}`"><span class="dot" :class="t.drc.state"></span>{{ t.name }}</a>
          </div>
          <div v-if="c.error" class="card-error" :title="c.error">{{ firstLine(c.error) }}</div>
          <div class="card-foot">
            <code class="entry" :title="c.entry">{{ c.entry }}</code>
            <Menu v-if="c.targets.length" class="fab-menu" align="right" label="Fab zips">
              <template #button><span class="btn primary"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13h10" /></svg>Fab zips<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6.5L8 10l3.5-3.5" /></svg></span></template>
              <a v-for="t in c.targets" :key="t.name" role="menuitem" :href="asset(t.board.fab.url)" :title="t.board.fab.files.join('\n')" download><span class="dot" :class="t.drc.state"></span><span class="name">{{ t.name }}</span><span class="dim">{{ t.board.fab.name }}</span></a>
            </Menu>
            <a v-else-if="c.board" class="btn primary" :href="asset(c.board.fab.url)" :title="c.board.fab.files.join('\n')" download>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13h10" /></svg>Fab zip
            </a>
          </div>
        </div>
      </li>
    </ul>
  </main>
</template>
