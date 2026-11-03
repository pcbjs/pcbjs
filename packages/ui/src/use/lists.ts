// The nets and BOM panels: nets with their routed length and a filter, the BOM with its sourcing and a copy as TSV.
import { computed, ref } from 'vue'
import type { PaneContext } from '../context'
import { orderNets } from '../schematic'
import { netLengths } from '../routes'
import { bomTsv, sourcingLine, unsourcedCount, unsourcedText, type BomRow } from '../sourcing'

export function useNets(ctx: PaneContext) {
  const { board: store } = ctx
  // empty until the router reports routes
  const lengths = computed(() => (store.site ? netLengths(store.site) : null))
  const padCount = computed(() => {
    const m = new Map<string, number>()
    for (const fp of store.site?.footprints ?? []) for (const p of fp.pads) if (p.net) m.set(p.net, (m.get(p.net) ?? 0) + 1)
    return m
  })
  const netFilter = ref('')
  // declaration order when the schematic has nets, else the board's alphabetical list
  const nets = computed(() => {
    const q = netFilter.value.trim().toLowerCase()
    return orderNets(store.site?.nets, store.site?.schematic ?? null)
      .filter(n => !q || n.name.toLowerCase().includes(q) || !!n.class?.toLowerCase().includes(q))
      .map(n => ({ ...n, len: lengths.value?.get(n.name) ?? null }))
  })
  return { padCount, netFilter, nets }
}

export function useBom(ctx: PaneContext) {
  const { board: store } = ctx
  const bom = computed<BomRow[]>(() => store.site?.bom ?? [])
  const bomLine = computed(() => (store.site ? sourcingLine(store.site.sourcingTags) : null))
  const bomMissing = computed(() => unsourcedText(unsourcedCount(bom.value)))
  const copied = ref<'' | 'ok' | 'fail'>('')
  let copiedTimer: ReturnType<typeof setTimeout> | undefined
  async function copyBom() {
    let ok = false
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(bomTsv(bom.value))
        ok = true
      }
    } catch {
      ok = false
    }
    copied.value = ok ? 'ok' : 'fail'
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = ''), 1500)
  }
  return { bom, bomLine, bomMissing, copied, copyBom }
}
