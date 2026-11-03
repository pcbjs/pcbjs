// The findings panel: the rows of the DRC and ERC, the board's targets with theirs, a row's focus and what a failed route was blocked by.
import { computed } from 'vue'
import type { SiteFinding } from '@pcbjs/core/site-data'
import { refNet } from '@pcbjs/core/ref'
import type { PaneContext } from '../context'
import { useActions } from './actions'
import { markAt } from '../finding-marks'
import { ercTarget, knownRefs } from '../schematic'
import { schFindingAt } from '../schview'
import { refsOfUids } from '../source'
import { checkSummary, drcSummary, ercSummary, targetName } from '../variants'

/** What a failed route was blocked by: a part to select or a point to zoom to. */
export interface Blocker {
  key: string
  label: string
  ref: string | null
  at: [number, number]
}

export const pillOf = (severity: string) => (severity === 'error' ? 'err' : severity === 'info' ? 'info' : 'warn')
/** A finding row's hover names its rule; the row retains its full details. */
export const findingTitle = (d: SiteFinding) => d.rule

/** A failed leg as its row shows it: the net, which leg of how many, and its ends with their layers, from the finding's witness and args. */
export function failedLeg(d: SiteFinding): { net: string | null; leg: string; ends: { at: [number, number]; layer: string }[] } | null {
  const seg = d.witness?.segments?.[0]
  if (d.rule !== 'route-failed' || !seg) return null
  const arg = (k: string) => (typeof d.args?.[k] === 'string' ? (d.args[k] as string) : '')
  return {
    net: d.refs.map(refNet).find(n => n !== null) ?? null,
    leg: arg('leg').replace(/ of $/, ''),
    ends: [
      { at: [seg[0][0], seg[0][1]], layer: arg('fromLayer') },
      { at: [seg[1][0], seg[1][1]], layer: arg('toLayer') },
    ],
  }
}

/** The targets of a board, with each one's check summary, for the menus and the strip that switch them. */
export function useTargets(ctx: PaneContext) {
  const { board: store, pane } = ctx
  const targets = computed(() => store.targets)
  const multi = computed(() => targets.value.length > 1)
  const targetRows = computed(() => targets.value.map(t => ({ name: targetName(t) ?? t.name, board: t, drc: checkSummary(t), on: t === store.site })))
  const stripRows = computed(() =>
    targetRows.value.map(t => {
      const s = pane.tab === 'erc' ? ercSummary(t.board) : drcSummary(t.board)
      return { ...t, state: s?.state ?? null, text: s?.text ?? 'no ERC data' }
    }),
  )
  const targetHref = (t: string) => ctx.shell?.boardHref(store.name, t) ?? '#'
  // target links are real links for middle-click and copy link; a plain click switches in place
  function onTargetLink(e: MouseEvent, t: string) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    if (ctx.shell) ctx.shell.selectTarget(store.name, t)
    else store.target = t
  }
  return { targets, multi, targetRows, stripRows, targetHref, onTargetLink }
}

export function useFindings(ctx: PaneContext) {
  const { board: store, pane } = ctx
  const { selectRef, gotoDrc, gotoSch } = useActions(ctx)
  const erc = computed(() => store.site?.erc ?? null)
  /** A finding row: the finding in focus by its id, and the view pans to it. */
  function gotoFinding(d: SiteFinding) {
    store.focusFinding(d)
    pane.tab = store.site?.erc.includes(d) ? 'erc' : 'drc'
    if (pane.tab === 'erc') gotoErc(d)
    else {
      const at = markAt(d)
      if (at) gotoDrc(at)
    }
  }
  // an ERC row: the point when it has one, else the part its refs or items name, staying on the ERC tab
  function gotoErc(d: SiteFinding) {
    const b = store.site
    if (!b) return
    const sch = schFindingAt(d)
    if (sch) return gotoSch(sch)
    const t = ercTarget(d, knownRefs(b), d.items?.length ? refsOfUids(b, d.items) : undefined)
    if (t?.kind === 'at') gotoDrc(t.at)
    else if (t) selectRef(t.ref, true, true)
  }
  const itemByUid = computed(() => new Map((store.site?.items ?? []).flatMap(it => (it.uid ? [[it.uid, it] as const] : []))))
  function blockersOf(d: { items?: string[] }): Blocker[] {
    const out: Blocker[] = []
    for (const uid of d.items ?? []) {
      const it = itemByUid.value.get(uid)
      if (!it) continue
      let label = it.kind === 'pad' && it.ref && it.pad ? `${it.ref}/${it.pad}` : it.ref ? `${it.kind} of ${it.ref}` : it.kind
      if (it.net) label += ` ${it.net}`
      const at: [number, number] = it.box ? [(it.box[0] + it.box[2]) / 2, (it.box[1] + it.box[3]) / 2] : [0, 0]
      out.push({ key: uid, label, ref: it.ref ?? null, at })
    }
    return out
  }
  function gotoBlocker(b: Blocker) {
    if (b.ref) selectRef(b.ref, true, true)
    else gotoDrc(b.at)
  }
  return { erc, gotoFinding, gotoErc, gotoDrc, blockersOf, gotoBlocker }
}
