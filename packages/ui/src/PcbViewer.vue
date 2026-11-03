<script setup lang="ts">
// A whole board viewer as a component: a page of its own around the boards it is given, with the views, their switch and chip, the
// layer rail and the panels; several boards add a picker.
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { EVERY, FACET_NAMES, type FacetName } from '@pcbjs/core/site-facets'
import { useBoard, type BoardInput } from './board'
import type { BoardStore } from './board-store'
import { VIEW_FACETS } from './pane'
import { createViewer, STORE } from './shell'
import { useTheme, type ThemeName } from './theme'
import BoardPage from './BoardPage.vue'
import type { Mode as View } from './pane'

const props = withDefaults(defineProps<{ board: BoardInput | BoardInput[]; view?: View; rails?: boolean; theme?: ThemeName }>(), { rails: true })
const emit = defineEmits<{ 'update:view': [View] }>()
const boards = (Array.isArray(props.board) ? props.board : [props.board]).map(useBoard)
const shell = createViewer({ single: true, embed: !props.rails })
boards.forEach(shell.adopt)
provide(STORE, shell)
onBeforeUnmount(() => shell.stop())
const at = ref(0)
const board = computed(() => boards[at.value])
const pane = computed(() => shell.pane(board.value.name))
const theme = useTheme(() => props.theme, shell.prefs)
// the page remounts for each board shown, the first time its data comes included
const shownKey = computed(() => `${at.value}:${shell.shown.value?.name ?? ''}`)
const title = (b: BoardStore) => b.ref?.summary.title || b.site?.title || b.name

watch(
  board,
  b => {
    shell.setPath(shell.boardHref(b.name))
    if (props.view) shell.pane(b.name).mode = props.view
  },
  { immediate: true },
)
watch(
  () => props.view,
  v => v && (pane.value.mode = v),
)
// fetched after mount only: a prerendered page shows what it was rendered with
const shown = (v: View): FacetName[] => [...new Set([...VIEW_FACETS[v], ...EVERY])]
const fetchShown = () => board.value.want(props.view ? shown(props.view) : [...FACET_NAMES])
onMounted(fetchShown)
watch(at, fetchShown)
// a view switched to later fetches what it shows, and the page around hears of it
watch(
  () => pane.value.mode as View,
  m => {
    board.value.want(shown(m))
    if (m !== props.view) emit('update:view', m)
  },
)
</script>

<template>
  <div
    class="app pcbjs-ui pcbjs-viewer"
    :class="{ embed: !rails, picker: boards.length > 1, 'drawer-layers': pane.drawer === 'layers', 'drawer-panel': pane.drawer === 'panel' }"
    v-bind="theme"
  >
    <header v-if="boards.length > 1" class="topbar">
      <h1 class="switch">
        <select aria-label="Board" @change="at = ($event.target as HTMLSelectElement).selectedIndex">
          <option v-for="(b, i) in boards" :key="i" :selected="i === at">{{ title(b) }}</option>
        </select>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6.5L8 10l3.5-3.5" /></svg>
      </h1>
    </header>
    <BoardPage :key="shownKey" />
  </div>
</template>
