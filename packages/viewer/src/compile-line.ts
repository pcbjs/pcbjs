// What a page says of the dev server's compile: the line on top while a recompile runs, its status, a held draft, the cover over a
// first board until it has drawn, and the sync notice's actions.
import { computed, watch } from 'vue'
import type { Shell } from '@pcbjs/ui'
import { useLoad } from './load'
import { loadProgress, loadText, stageSegments, step } from './loading'

export function useCompileLine(shell: Shell) {
  const { ide, state, live } = shell
  const loadView = useLoad()
  const load = computed(() => loadView?.load ?? null)
  // the page mounts once the server answered, so no board and no error here means nothing to show until one is chosen
  const shownCount = computed(() => shell.groups.value.reduce((n, g) => n + g.targets.length, 0) + Object.values(state.errors).filter(Boolean).length)
  watch(
    shownCount,
    count => {
      if (loadView) loadView.load = step(loadView.load, { kind: 'boards', count })
    },
    { immediate: true },
  )
  const pane = computed(() => (shell.shown.value ? shell.pane(shell.shown.value.name) : null))
  const recompiling = computed(() => !!load.value?.shown && load.value.phase === 'compiling')
  // dev: a recompile keeps the board on show with a line on top and the status in the header, or in IDE mode the pane's button row
  const loadStatus = computed(() => (recompiling.value ? loadText(load.value!) : ''))
  const holdText = computed(() => (live.hold ? `holding, ${live.hold.file}:${live.hold.line} has an error` : ''))
  const loadLine = computed(() => (recompiling.value ? loadProgress(load.value!) : null))
  // the stages of the compile, one segment each; a hit fills at once
  const segments = computed(() => (recompiling.value ? stageSegments(live.status) : []))
  // the first board is covered until it has drawn
  const covering = computed(() => {
    const b = shell.current.value,
      l = load.value,
      p = pane.value
    return !!b && !!l && !l.shown && l.phase !== 'gone' && !p?.failed3d && !(p?.mode === 'sch' && !b.schematic.drawing)
  })
  const idleHint = computed(() => (ide.on ? 'or choose one in the Boards view of the pcbjs sidebar' : ''))
  const report = () => {
    if (live.notice?.url) window.open(live.notice.url, '_blank', 'noopener')
  }
  return { load, recompiling, loadStatus, holdText, loadLine, segments, covering, idleHint, report }
}
export type CompileLine = ReturnType<typeof useCompileLine>
