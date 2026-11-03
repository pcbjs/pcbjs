// What one pane of a board shows: its view, side, mirror, hidden layers, 3D look, tab and open rows, and its transient focus. A page keeps
// one pane per board, an editor pane one; the board's own state, selection included, is its BoardStore's. Free of the DOM.
import { markRaw, reactive, watch } from 'vue'
import type { View } from '@pcbjs/core/internal/plugin'
import { facetsOf, type ViewName } from '@pcbjs/core/site-facets'
import type { Side } from './sides'
import type { HoverTarget } from './sync'
import type { BoardStore } from './board-store'
import { clearReady } from './ready'
import { schematicFinding } from './schematic-findings'
import { markAt } from './finding-marks'
import { cancelFocus, type FocusSlot } from './focus-transaction'

type Box = [number, number, number, number]
export type Mode = ViewName
export type Tab = 'drc' | 'erc' | 'schematic' | 'bom' | 'nets' | 'part'
export type Focus = { at: [number, number]; r: number; n: number; pulse: boolean }

/** The facets each view draws from, as the dev server's demand counts them; see FACETS. */
export const VIEW_FACETS: Record<Mode, View[]> = { '2d': facetsOf('2d'), '3d': facetsOf('3d'), sch: facetsOf('sch'), checks: facetsOf('checks') }

export interface PaneState {
  /** Local UI inspector; never part of shared board selection. */
  devtools: boolean
  mode: Mode
  /** the side on top in 2D, B also opening the 3D view on the bottom */
  side: Side
  /** the 2D view mirrored horizontally, to read the back as seen from behind */
  mirror: boolean
  hidden: Set<string>
  /** the schematic's hidden rail rows, see SCH_LAYERS */
  schHidden: Set<string>
  /** the 2D board shown beside the schematic */
  split: boolean
  /** the 3D view's focus fade, exploded view and layer separation in mm, kept while 2D is shown */
  fade: boolean
  explode: boolean
  separation: number
  tab: Tab
  /** the circuit instances open in the Schematic tab's tree, by key */
  expanded: Set<string>
  /** each view's last frame in mm, plain: it changes on every pan step and nothing renders from it */
  viewport: Partial<Record<'2d' | 'sch', Box>>
  focusViews: Map<string, FocusSlot>
  /** where a panel asked the 2D view or the sheet to pan */
  focus: Focus | null
  schFocus: Focus | null
  /** what a click in the schematic would select now */
  schHover: HoverTarget | null
  /** below 900 px, and in an editor's pane, the rail open over the board */
  drawer: 'layers' | 'panel' | null
  /** why the 3D view failed, shown in its place */
  failed3d: string | null
}

/** The views a pane mounts: the one shown, and the 2D view beside a split schematic. */
export const mountedViews = (p: Pick<PaneState, 'mode' | 'split'>): Mode[] => (p.mode === 'sch' && p.split ? ['sch', '2d'] : [p.mode])

/** A pane starting in `mode`; `fixed` pins the view, as an editor pane opened on one keeps it whatever a finding or a selection asks. */
export function createPane(mode: Mode, fixed: Mode | null = null): PaneState {
  const p = {
    devtools: false,
    mode,
    side: 'F' as Side,
    mirror: false,
    hidden: new Set<string>(),
    schHidden: new Set<string>(),
    split: false,
    fade: true,
    explode: false,
    separation: 4,
    tab: 'drc' as Tab,
    expanded: new Set<string>(),
    viewport: markRaw({}),
    focusViews: markRaw(new Map<string, FocusSlot>()),
    focus: null,
    schFocus: null,
    schHover: null,
    drawer: null,
    failed3d: null,
  }
  if (fixed) Object.defineProperty(p, 'mode', { enumerable: true, get: () => fixed, set: () => {} })
  return reactive(p) as PaneState
}

/** The panning focus a panel asks for, numbered so a repeat still pans. */
let focusN = 0
export const focusAt = (at: [number, number], r: number, pulse: boolean): Focus => ({ at, r, n: ++focusN, pulse })

/** Pane effects run in its scope; hidden views keep focus checkpoints until canonical focus ends. */
export function paneEffects(board: BoardStore, pane: PaneState): void {
  watch(
    () => [board.sel.finding, board.sel.anchor, board.sel.isolate, board.frame, pane.focus, pane.schFocus, board.sel] as const,
    ([finding, anchor], previous) => {
      if (!finding && (anchor !== previous?.[1] || (!anchor && board.sel !== previous?.[6]))) {
        if (pane.focus === previous?.[4]) pane.focus = null
        if (pane.schFocus === previous?.[5]) pane.schFocus = null
      }
      const frame = !!board.frame || !!board.sel.isolate || (!finding && !!(pane.focus || pane.schFocus))
      cancelFocus(pane.focusViews, [...(frame ? ['frame' as const] : []), ...(finding ? ['finding' as const] : [])])
    },
  )
  watch(
    () => [pane.mode, board.site?.variant?.name, pane.explode, pane.separation],
    () => clearReady(),
  )
  watch(
    () => pane.mode,
    m => {
      if (m === 'checks') pane.drawer = null
      if (m === 'sch') return
      pane.schHover = null
      board.hover.net = null
    },
  )
  watch(
    () => [pane.mode, board.site],
    () => {
      pane.failed3d = null
    },
  )
  watch(
    () => [board.findingN, board.site] as const,
    ([n], previous) => {
      const id = board.finding?.id
      let focus: Focus | null = null, schFocus: Focus | null = null
      const atFocus = (old: Focus | null, at: [number, number], r: number): Focus =>
        n === previous?.[0] && old?.r === r && old.at[0] === at[0] && old.at[1] === at[1] ? old : focusAt(at, r, true)
      if (id && board.site) {
        pane.tab = board.site.erc.some(m => m.id === id) ? 'erc' : 'drc'
        const m = [...board.site.drc, ...board.site.erc].find(m => m.id === id)
        const at = m && markAt(m)
        if (at && m?.layer !== 'sch') focus = atFocus(pane.focus, [at[0], at[1]], 2)
        const sch = board.site.erc.find(m => m.id === id && schematicFinding(m))
        if (sch?.at) schFocus = atFocus(pane.schFocus, sch.at, 2)
      }
      if (id || n !== previous?.[0]) { pane.focus = focus; pane.schFocus = schFocus }
    },
  )
}

/** What a pane forgets when the page shows another board: the transient focus, hovers and drawers. */
export function leavePane(pane: PaneState): void {
  cancelFocus(pane.focusViews, [])
  pane.focus = null
  pane.schFocus = null
  pane.schHover = null
  pane.drawer = null
}
