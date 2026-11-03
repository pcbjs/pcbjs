<script setup lang="ts">
// the shell around the board page of @pcbjs/ui: the top bar, the home and missing pages, the load line and screens, the sync notice
import { computed } from 'vue'
import { BoardPage, checkSummary, drcPill, mm, targetName, useShell, useStatus } from '@pcbjs/ui'
import Menu from './Menu.vue'
import Home from './Home.vue'
import LoadScreen from './LoadScreen.vue'
import Notices from './Notices.vue'
import { useCompileLine } from './compile-line'

const shell = useShell()
const {
  workspace,
  workspaceHome,
  scopeCards,
  asset,
  boardHref,
  boardTarget,
  chooseBoard,
  homeHref,
  cards,
  ide,
  embed,
  siteGroups,
  resolvedTheme,
  route,
  state,
  toggleTheme,
  live,
} = shell
const board = shell.current
const error = shell.currentError
const store = computed(() => shell.shown.value)
const pane = computed(() => (store.value ? shell.pane(store.value.name) : null))
const drawer = computed(() => pane.value?.drawer ?? null)
const pill = computed(() => (board.value ? drcPill(board.value) : null))
const drc = computed(() => pill.value?.summary ?? null)
const drcText = computed(() => drc.value?.label ?? '')
const targets = computed(() => store.value?.targets ?? [])
const targetRows = computed(() => targets.value.map(t => ({ name: targetName(t) ?? t.name, board: t, drc: checkSummary(t), on: t === board.value })))
const multi = computed(() => targets.value.length > 1)
const failing = computed(() => targetRows.value.filter(t => t.drc.state === 'err').length)
const othersFail = computed(() => targetRows.value.some(t => !t.on && t.drc.state === 'err'))
const failingNames = computed(() =>
  targetRows.value
    .filter(t => t.drc.state === 'err')
    .map(t => `${t.name}: ${t.drc.text}`)
    .join('\n'),
)
const fabTitle = computed(() => (board.value ? (board.value.variant ? `${board.value.variant.name}\n` : '') + board.value.fab.files.join('\n') : ''))
const { draftText } = useStatus(
  () => board.value,
  () => error.value,
)
// target links are real links for middle-click and copy link; a plain click switches in place
function onTargetLink(e: MouseEvent, t: string) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !board.value) return
  e.preventDefault()
  shell.selectTarget(board.value.name, t)
}
function openTab(t: 'drc' | 'erc') {
  if (!pane.value) return
  pane.value.tab = t
  if (matchMedia('(max-width: 900px)').matches) pane.value.drawer = 'panel'
}
const setDrawer = (d: 'layers' | 'panel') => pane.value && (pane.value.drawer = pane.value.drawer === d ? null : d)
// the page remounts for each board shown
const pageKey = computed(() => store.value?.name ?? '')
const home = computed(() => route.value.page === 'home')
// a board route whose name matches nothing; with one entry and no board yet the viewer shows the compile state instead
const missing = computed(() => !ide.on && route.value.page === 'board' && !board.value && !state.loading && (!state.single || shell.groups.value.length > 0))
const routeName = computed(() => (route.value.page === 'board' ? route.value.name : null))
function onSwitch(e: Event) {
  chooseBoard((e.target as HTMLSelectElement).value)
}
// dev: the compile's line, status and cover
const line = useCompileLine(shell)
const { load, loadStatus, holdText, covering, idleHint } = line
</script>

<template>
  <div
    class="app pcbjs-ui"
    :class="{
      page: home || missing,
      'drawer-layers': drawer === 'layers',
      'drawer-panel': drawer === 'panel',
      ide: ide.on,
      bare: ide.on && !ide.panel,
      embed: embed.on,
      'no-tools': embed.on && !embed.tools,
    }"
  >
    <Notices :shell="shell" :line="line" />
    <header v-if="!ide.on && !embed.on" class="topbar">
      <button v-if="!home && !missing" class="icon only-narrow" aria-label="Layers" title="Layers" @click="setDrawer('layers')">
        <svg viewBox="0 0 16 16"><path d="M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3" /></svg>
      </button>
      <template v-if="workspace.info && !workspace.info.single">
        <a class="crumb" :class="{ on: workspaceHome }" href="/" :aria-current="workspaceHome ? 'page' : undefined">Projects</a>
        <span v-if="!workspaceHome" class="sep" aria-hidden="true">/</span>
      </template>
      <template v-if="!state.single && !workspaceHome">
        <a class="crumb" :class="{ on: home }" :href="homeHref" :aria-current="home ? 'page' : undefined">{{ workspace.scope ?? 'Boards' }}</a>
        <span v-if="!home" class="sep" aria-hidden="true">/</span>
      </template>
      <template v-if="home">
        <h1 class="sr-only">pcbjs</h1>
        <div class="meta">
          <span>{{ workspaceHome ? `${scopeCards.length} projects` : `${cards.length} boards` }}</span>
        </div>
      </template>
      <h1 v-else-if="!state.single" class="switch">
        <select aria-label="Board" @change="onSwitch">
          <option v-if="!board" value="" disabled selected>{{ routeName ?? 'board' }}</option>
          <option v-for="g in siteGroups" :key="g.name" :value="g.name" :selected="g.name === board?.name">{{ boardTarget(g)?.title || g.name }}</option>
        </select>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6.5L8 10l3.5-3.5" /></svg>
      </h1>
      <h1 v-else>{{ board?.title || board?.name || 'pcbjs' }}</h1>
      <Menu v-if="multi && board && !home" class="target-menu" label="Fab target">
        <template #button
          ><span class="dot" :class="drc!.state"></span><span class="name">{{ targetName(board) }}</span
          ><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6.5L8 10l3.5-3.5" /></svg
        ></template>
        <a
          v-for="t in targetRows"
          :key="t.name"
          role="menuitemradio"
          :aria-checked="t.on"
          :class="{ on: t.on }"
          :href="boardHref(board.name, t.name)"
          @click="onTargetLink($event, t.name)"
        >
          <span class="dot" :class="t.drc.state"></span><span class="name">{{ t.name }}</span
          ><span class="dim">{{ t.drc.text }}</span>
        </a>
      </Menu>
      <div class="meta" v-if="board">
        <span v-if="board.title && board.title !== board.name">{{ board.name }}</span>
        <span v-if="board.rev">rev {{ board.rev }}</span>
        <span>{{ mm(board.bbox.w) }} × {{ mm(board.bbox.h) }} mm</span>
        <span class="wide">{{ board.copper }} layers · {{ board.thickness }} mm</span>
        <span v-for="r in board.references ?? []" :key="r.name" class="wide" :title="r.anchor"
          >references <a v-if="r.page" :href="boardHref(r.page)">{{ r.title || r.name }}</a
          ><template v-else>{{ r.title || r.name }}</template></span
        >
      </div>
      <span class="spacer"></span>
      <span v-if="loadStatus" class="load-status" role="status"><i class="status-spin" aria-hidden="true"></i>{{ loadStatus }}</span>
      <template v-if="board">
        <span v-if="error" class="pill err" title="the board shown is the last one that compiled">compile error</span>
        <button v-else class="pill" :class="drc!.state" :title="drc!.title" @click="openTab(pill!.tab)">{{ drcText }}</button>
        <button v-if="othersFail" class="pill dim wide" :title="failingNames" @click="openTab('drc')">{{ failing }} of {{ targets.length }} targets fail</button>
        <span v-if="board.dev" class="pill dim wide" title="updates without reload when the source changes">dev</span>
        <span v-if="holdText" class="pill warn wide" role="status" title="the edit compiles once its block is clean, the cursor leaves it or the file is saved">{{
          holdText
        }}</span>
        <span v-if="draftText" class="pill dim" title="compiled from the editor's unsaved text; a save compiles the file">{{ draftText }}</span>
        <a class="btn wide" :href="asset(board.svgUrl)" target="_blank" rel="noopener">{{ board.name }}.pcb.svg</a>
        <a class="btn primary" :href="asset(board.fab.url)" :title="fabTitle" download>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13h10" /></svg>{{ board.fab.name }}
        </a>
      </template>
      <span v-else-if="error && !home && !missing" class="pill err">compile error</span>
      <button
        class="icon"
        :title="resolvedTheme() === 'dark' ? 'Light theme' : 'Dark theme'"
        :aria-label="resolvedTheme() === 'dark' ? 'Light theme' : 'Dark theme'"
        @click="toggleTheme"
      >
        <svg v-if="resolvedTheme() === 'dark'" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
        </svg>
        <svg v-else viewBox="0 0 16 16"><path d="M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z" /></svg>
      </button>
      <button v-if="!home && !missing" class="icon only-narrow" aria-label="Details" title="DRC, BOM, nets and part" @click="setDrawer('panel')">
        <svg viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h10" /></svg>
      </button>
    </header>

    <Home v-if="home" />
    <main v-else-if="missing" class="missing">
      <p>
        No such board<template v-if="routeName"
          >: <code>{{ routeName }}</code></template
        >.
      </p>
      <p><a :href="homeHref">All boards</a></p>
    </main>
    <BoardPage v-else :key="pageKey" :status="loadStatus || holdText">
      <template #empty>
        <LoadScreen v-if="!error && load" :hint="idleHint" />
        <div v-else-if="!error" class="empty">{{ state.loading ? 'Loading…' : 'Compiling…' }}</div>
      </template>
      <template #overlay>
        <LoadScreen v-if="covering" class="cover" />
      </template>
    </BoardPage>
  </div>
</template>
