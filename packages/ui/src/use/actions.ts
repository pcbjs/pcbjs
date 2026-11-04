// What a view and a panel do to the board and its pane: select from a panel, pin a net, pick in a view, pan to a point, and the hovers
// every view lights.
import { computed } from 'vue'
import type { SiteFinding } from '@pcbjs/core/site-data'
import type { PaneContext } from '../context'
import { focusAt, type Tab } from '../pane'
import { anchorGroup, anchorPart, click, clickTarget, partRefOf, selectRefs, toggle, type Hit, type Mods } from '../selection'
import { markAt } from '../finding-marks'
import { refSource } from '../defs'
import { symbolFrame } from '../schview'
import { siteTarget } from '../refs'
import type { HoverTarget } from '../sync'

/** Below 900 px the rails become drawers over the board. */
export const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 900px)').matches

export function useActions(ctx: PaneContext, view?: '2d' | '3d' | 'sch') {
  const { board: store, pane } = ctx
  const mode = () => view ?? pane.mode
  const site = computed(() => (mode() !== 'checks' ? store.layoutSite : store.site))
  const drawing = computed(() => site.value?.schematic.drawing ?? null)
  // the part ?select= frames in both views, until another part is selected; a net, finding, route or item frames its area in 2D
  const frameRef = computed(() => (site.value ? (store.frame?.ref ?? null) : null))
  const frameArea = computed(() => (site.value && store.frame && !store.frame.ref ? store.frame.box : null))
  // a net or the parts of an instance hovered in a panel light in every view, selection or not
  const contextNet = computed(() => store.drawn?.context ?? [...store.netMembers][0] ?? null)
  const activeNet = computed(() => store.hover.net ?? contextNet.value)
  // another viewer's hover marks the schematic as a board hover here does
  const remoteProbe = computed(() => (store.remote?.board === site.value?.name ? (store.remote?.hover ?? null) : null))
  const boardHoverRefs = computed(() => (pane.schHover?.refs.length ? pane.schHover.refs : store.hover.refs))

  function openTab(t: Tab) {
    pane.tab = t
    if (narrow()) pane.drawer = 'panel'
  }
  /** Select a part, a pad or any reference from a panel, replacing the selection; null clears. */
  function selectRef(ref: string | null, zoom = false, keepTab = false) {
    const b = site.value
    if (!b) return
    if (!ref) return store.setSel({ ...store.sel, refs: [], anchor: null })
    const m = b.footprints.some(f => f.ref === ref) ? partRefOf(b, ref) : ref
    store.setSel(selectRefs({ ...store.sel, level: null }, [m]))
    if (zoom && mode() !== 'sch' && siteTarget(b, m).kind === 'group') store.selectRef(m, true)
    if (!keepTab) pane.tab = 'part'
    if (zoom && mode() === 'sch' && drawing.value) {
      const f = symbolFrame(drawing.value, ref)
      if (f) pane.schFocus = focusAt([f[0] + f[2] / 2, f[1] + f[3] / 2], Math.max(f[2], f[3]) / 4, false)
      return
    }
    const fp = b.footprints.find(f => f.ref === ref)
    if (fp && zoom) {
      pane.mode = '2d'
      pane.focus = focusAt(fp.at, 4, false)
    }
  }
  /** A net from a panel: selected alone, or dropped when it is selected. */
  function pin(net: string | null) {
    const b = site.value
    if (!b || !net) return
    const ref = `net:${net}`
    store.setSel(store.sel.refs.includes(ref) ? toggle(store.sel, b, ref) : selectRefs({ ...store.sel, level: null }, [ref]))
  }
  function gotoDrc(at: [number, number]) {
    pane.mode = '2d'
    pane.focus = focusAt(at, 2, true)
    if (narrow()) pane.drawer = null
  }
  // a schematic finding: the sheet pans to its point and pulses there
  function gotoSch(at: [number, number]) {
    pane.mode = 'sch'
    pane.schFocus = focusAt(at, 2, true)
    if (narrow()) pane.drawer = null
  }
  // what a click in the schematic would select now: a net lights up as a hovered net does, parts as a hovered circuit does
  function onSchHover(h: HoverTarget | null) {
    pane.schHover = h
    const net = h?.net ?? null
    if (store.hover.net !== net) store.hover.net = net
  }
  /** A click in a view: the selection contract; a part or group selected from the board opens its tab. An alt-click opens the definition of what a plain click would select, the selection kept. */
  function onPick(hit: Hit | null, mods: Mods) {
    const b = site.value
    if (!b) return
    if (mods.alt) {
      const ref = clickTarget(store.sel, b, hit, false)
      if (ref) void ctx.open(refSource(b, ref, 'definition', mode() === 'sch'))
      return
    }
    if (mode() === 'sch') store.setSel({ ...click({ ...store.sel, isolate: null, level: null }, b, hit, mods), isolate: store.sel.isolate })
    else store.pick(hit, mods)
    if (anchorPart(b, store.sel) || anchorGroup(b, store.sel)) pane.tab = 'part'
  }
  /** A finding's dot or line clicked in a view: it takes the focus and its tab, becomes the selection, shift adding it, and the 2D view frames it; the 3D view frames its own dot. */
  function onFinding(id: string, mods: Mods) {
    const b = site.value
    const d: SiteFinding | undefined = b ? [...b.drc, ...b.erc].find(m => m.id === id) : undefined
    if (!b || !d) return
    const before = store.sel
    store.focusFinding(d)
    store.setSel({ ...(mods.shift ? toggle(before, b, id) : selectRefs({ ...before, level: null }, [id])), finding: id })
    const at = markAt(d)
    if (mode() === '2d' && !mods.shift && at) pane.focus = focusAt([at[0], at[1]], 2, true)
  }
  const onEnter = (hit: Hit | null) => (mode() === 'sch' ? onPick(hit, { deep: true, shift: false }) : store.enterAt(hit))
  return {
    site,
    drawing,
    frameRef,
    frameArea,
    contextNet,
    activeNet,
    remoteProbe,
    boardHoverRefs,
    openTab,
    selectRef,
    pin,
    gotoDrc,
    gotoSch,
    onSchHover,
    onPick,
    onFinding,
    onEnter,
  }
}
