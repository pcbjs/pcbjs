// The layer rail of a board view and the schematic's rows: what a pane hides, with presets and solo.
import { computed } from 'vue'
import type { PaneContext } from '../context'
import { withForeign } from '../variants'
import { SCH_LAYERS, layerCounts } from '../schview'

const PRESETS = {
  front: (l: { side: string; kind: string }) => l.side === 'back',
  back: (l: { side: string; kind: string }) => l.side === 'front',
  all: () => false,
  copper: (l: { side: string; kind: string }) => l.kind !== 'copper' && l.kind !== 'edge',
}
type Preset = keyof typeof PRESETS
export const PRESET_NAMES: [Preset, string][] = [
  ['front', 'Front'],
  ['back', 'Back'],
  ['all', 'All'],
  ['copper', 'Copper only'],
]

export function useLayers(ctx: PaneContext) {
  const { board: store, pane } = ctx
  const layerList = computed(() => [...(store.site?.layers ?? [])].reverse())
  // ids of layers this target lacks stay hidden for the targets that have them
  function setHidden(ids: Iterable<string>) {
    pane.hidden = withForeign(pane.hidden, store.site?.layers.map(l => l.id) ?? [], ids)
  }
  function toggleLayer(id: string) {
    const s = new Set(pane.hidden)
    s.has(id) ? s.delete(id) : s.add(id)
    pane.hidden = s
  }
  function solo(id: string) {
    const all = store.site!.layers.map(l => l.id)
    const hiddenHere = all.filter(l => pane.hidden.has(l)).length
    setHidden(hiddenHere === all.length - 1 && !pane.hidden.has(id) ? [] : all.filter(l => l !== id))
  }
  function applyPreset(p: Preset) {
    setHidden(store.site!.layers.filter(PRESETS[p]).map(l => l.id))
  }
  const activePreset = computed(() => {
    const ls = store.site?.layers ?? []
    return PRESET_NAMES.find(([p]) => ls.every(l => PRESETS[p](l) === pane.hidden.has(l.id)))?.[0] ?? null
  })
  return { layerList, toggleLayer, solo, presetNames: PRESET_NAMES, applyPreset, activePreset }
}

export function useSheet(ctx: PaneContext) {
  const { board: store, pane } = ctx
  const drawing = computed(() => store.site?.schematic.drawing ?? null)
  const schRows = computed(() => {
    const d = drawing.value
    if (!d) return []
    const counts = layerCounts(d, (store.site?.erc ?? []).filter(f => f.layer === 'sch').length)
    const colors = store.site?.schematic.svg?.themes?.[ctx.theme()]
    return SCH_LAYERS.map(l => ({ ...l, n: counts[l.id] ?? 0, swatch: (l.color && colors?.[l.color]) || 'var(--drc-warn)' }))
  })
  function toggleSch(id: string) {
    const s = new Set(pane.schHidden)
    s.has(id) ? s.delete(id) : s.add(id)
    pane.schHidden = s
  }
  function soloSch(id: string) {
    const others = SCH_LAYERS.map(l => l.id).filter(l => l !== id)
    pane.schHidden = others.every(l => pane.schHidden.has(l)) && !pane.schHidden.has(id) ? new Set() : new Set(others)
  }
  return { drawing, schRows, toggleSch, soloSch }
}
