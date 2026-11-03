<script setup lang="ts">
// A board page as the children of its grid: the left rail, the stage with the views it is given and the chip, the right rail of tabs
// and the drawer scrim. `empty` shows on the stage while there is no board, `overlay` over it, under the toast and the error.
import { computed, onErrorCaptured, provide, type Component } from 'vue'
import { useShell } from './shell'
import { PANE } from './context'
import { createPane, mountedViews, type Mode } from './pane'
import { useStatus } from './use/status'
import ClientOnly from './ClientOnly.vue'
import PathChip from './PathChip.vue'
import Palette from './Palette.vue'
import DevToolsOverlay from './DevToolsOverlay.vue'
import PreviewLayout from './PreviewLayout.vue'

const props = defineProps<{
  /** the views it can show, by mode */
  views: Partial<Record<Mode, Component>>
  /** what fills the rails, each loaded when its rail can be seen */
  rails: { left: Component; right: Component }
  /** the compile status the IDE pane's toolbar shows */
  status?: string
}>()
// the board the page shows when it mounts: the page around remounts this one for another board
const shell = useShell()
const { ide, embed, resolvedTheme, toggleTheme, state, page, edit } = shell
const store = shell.shown.value
const ctx = store ? shell.context(store.name) : null
if (ctx) provide(PANE, ctx)
// with no board yet a pane of its own, so the stage reads the same fields
const view = ctx?.pane ?? createPane('2d')
const board = computed(() => store?.site ?? null)
const drawing = computed(() => board.value?.schematic.drawing ?? null)
const error = computed(() => shell.currentError.value)
const { staleText, errorHead, errorBody, outlinePath } = useStatus(
  () => board.value,
  () => error.value,
)
// only the views shown are mounted; the 2D frame survives a switch in the pane's viewport
const mounted = computed(() => mountedViews(view))

// a failure inside the 3D view stays there: it is shown in place and never stalls the rest of the viewer
onErrorCaptured((err, inst) => {
  const name = inst?.$options.__name
  if (name !== 'Canvas3D' && name !== 'Board3D' && !inst?.$el?.closest?.('.view3d-host')) return
  console.error(err)
  view.failed3d = String((err as Error)?.message ?? err)
  return false
})
const reload = () => location.reload()
</script>

<template>
  <aside v-if="!embed.on && view.mode !== 'checks'" class="rail left">
    <component :is="rails.left" v-if="board && (!ide.on || view.drawer === 'layers')" />
  </aside>

  <main class="stage" data-ui="BoardFrame" data-ui-source="packages/ui/src/BoardFrame.vue" :class="{ checks: view.mode === 'checks', split: view.mode === 'sch' && view.split && drawing }">
    <ClientOnly><PreviewLayout /><DevToolsOverlay v-if="board?.dev && view.devtools" /></ClientOnly>
    <ClientOnly v-if="!embed.on"><Palette /></ClientOnly>
    <template v-if="board">
      <!-- the board views measure the page and draw with pointer events and WebGL: the prerendered page holds a box of the board's shape until hydration -->
      <ClientOnly>
        <component :is="views['2d']" v-if="views['2d'] && mounted.includes('2d')" :key="board.name" :beside="view.mode === 'sch'" />
        <component :is="views.sch" v-if="views.sch && view.mode === 'sch' && drawing" :key="board.name" />
        <div v-else-if="view.mode === 'sch'" class="empty">No schematic drawing in this build</div>
        <component :is="views.checks" v-if="views.checks && view.mode === 'checks'" :key="board.name" />
        <div v-if="views['3d'] && view.mode === '3d'" class="view3d-host">
          <div v-if="view.failed3d" class="empty">3D view failed: {{ view.failed3d }}</div>
          <component :is="views['3d']" v-else :key="board.name" />
        </div>
        <template #placeholder>
          <div class="board-placeholder" aria-hidden="true">
            <svg :viewBox="board.viewBox.join(' ')" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" :d="outlinePath" /></svg>
          </div>
        </template>
      </ClientOnly>
      <div v-if="ide.on" class="bv-tools ide-tools" role="toolbar" aria-label="Pane">
        <button v-if="board.dev" class="icon" aria-label="Toggle preview dev tools" title="Inspect preview UI" :aria-pressed="view.devtools" @click="view.devtools = !view.devtools">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M14 10v4h-4M6 14H2v-4M6 6l6 2-3 1-1 3z" /></svg>
        </button>
        <span v-if="status" class="load-status" role="status"><i class="status-spin" aria-hidden="true"></i>{{ status }}</span>
        <button
          v-if="view.mode !== 'checks'"
          class="icon"
          :class="{ on: view.drawer === 'layers' }"
          aria-label="Layers"
          title="Layers, board, rules and stackup"
          @click="view.drawer = view.drawer === 'layers' ? null : 'layers'"
        >
          <svg viewBox="0 0 16 16"><path d="M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3" /></svg>
        </button>
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
        <button class="icon" aria-label="Reload" title="Reload the pane" @click="reload">
          <svg viewBox="0 0 16 16"><path d="M13 8a5 5 0 11-1.5-3.5M13 2.5v3h-3" /></svg>
        </button>
        <button v-if="ide.panel && view.mode !== 'checks'" class="icon only-narrow" aria-label="Details" title="DRC, BOM, nets and part" @click="view.drawer = view.drawer === 'panel' ? null : 'panel'">
          <svg viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h10" /></svg>
        </button>
      </div>
      <div v-else-if="!embed.on" class="seg mode" role="group" aria-label="View">
        <button :class="{ on: view.mode === '2d' }" :aria-pressed="view.mode === '2d'" @click="view.mode = '2d'">2D</button>
        <button :class="{ on: view.mode === '3d' }" :aria-pressed="view.mode === '3d'" @click="view.mode = '3d'">3D</button>
        <button v-if="drawing" :class="{ on: view.mode === 'sch' }" :aria-pressed="view.mode === 'sch'" @click="view.mode = 'sch'">Schematic</button>
        <button v-if="views.checks" :class="{ on: view.mode === 'checks' }" :aria-pressed="view.mode === 'checks'" @click="view.mode = 'checks'">DRC / ERC</button>
      </div>
      <PathChip v-if="!embed.on && view.mode !== 'checks'" />
    </template>
    <slot v-else name="empty">
      <div v-if="!error" class="empty">{{ state.loading ? 'Loading…' : 'Compiling…' }}</div>
    </slot>
    <slot name="overlay"></slot>
    <div v-if="edit.mismatch" class="stale-banner mismatch" role="alert">
      <div class="stale-title">
        <span class="pill warn">session</span><span>{{ edit.mismatch }}</span>
      </div>
    </div>
    <div v-if="page.toast" :key="page.toast.n" class="toast" :class="{ err: page.toast.err }" role="status">{{ page.toast.text }}</div>
    <div v-if="error && !board" class="error-box" role="alert">
      <div class="error-title"><span class="pill err">compile error</span><span class="dim">no board yet</span></div>
      <div class="error-head">{{ errorHead }}</div>
      <pre v-if="errorBody">{{ errorBody }}</pre>
    </div>
    <div v-else-if="staleText" class="stale-banner" role="alert">
      <div class="stale-title"><span class="pill warn">stale</span><span>the last compile failed; this is the board from the compile before</span></div>
      <div class="stale-head">{{ errorHead }}</div>
      <details v-if="errorBody">
        <summary>details</summary>
        <pre>{{ errorBody }}</pre>
      </details>
    </div>
  </main>

  <aside v-if="!embed.on && view.mode !== 'checks'" class="rail right">
    <component :is="rails.right" v-if="board && (!ide.on || ide.panel)" />
  </aside>
  <div class="scrim" :class="{ 'only-narrow': !ide.on || view.drawer === 'panel' }" v-if="view.drawer && !embed.on" @click="view.drawer = null"></div>
</template>
