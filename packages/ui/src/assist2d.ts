// The assist mode of the 2D view: while the editor cursor waits for a chain call's argument or an `at`, the dot field, the start marker,
// a preview of the trace a hovered dot or the typed value gives with its findings, and a pick that writes it; DOM only in handlers.
import { computed, shallowRef, watch } from 'vue'
import type { SiteData } from '@pcbjs/core/site-data'
import { dragTxn, type DragTxn } from './edit-client'
import { dotField, dotGrid, dotPaths, light, litGrid, nearest, pickText, typedPoint, LIT, type Dot } from './dots'
import { MAGNET_PX } from './snap'
import { endMarks2d, endsOf, litEnd, nearestEnd, pickEnd } from './ends'
import type { AssistContext, EditPlan, EndCandidate } from '@pcbjs/core/protocol'
import type { BoardStore } from './board-store'
import type { SnapGrid } from './snap'

type Pt = [number, number]
/** brightness steps of the field, each one path */
export const STEPS = 6

export interface Assist2d {
  board: () => SiteData
  px: () => number
  /** the view is mirrored, so labels are drawn mirrored back */
  mirror?: () => boolean
  store: BoardStore
  grid?: () => SnapGrid | null
  visualGrid?: () => SnapGrid
}

export function useAssist2d(d: Assist2d) {
  const t = d.store.edit
  const ctx = computed<AssistContext | null>(() => {
    const a = t.assist
    if (!a || t.assistOff || a.board !== d.board().name || !d.board().dev || t.mode?.mode !== 'rw' || (d.board().variant && d.board().variant!.index !== 0)) return null
    return (d.visualGrid?.() ?? d.grid?.()) ? { ...a, grid: '__editing' } : a
  })
  const board = computed(() => {
    const grid = d.visualGrid?.() ?? d.grid?.()
    return grid ? { ...d.board(), grids: [...(d.board().grids ?? []), { ...grid, name: '__editing', frame: null, used: [] }] } : d.board()
  })
  const on = computed(() => !!ctx.value)
  /** a route end slot: candidates to annotate and click, no dots */
  const ends = computed(() => endsOf(t, d.board(), d.store.sel.isolate))
  const shift = shallowRef(false)
  const pointer = shallowRef<Pt | null>(null)
  const dots = computed<Dot[]>(() => (ctx.value && !ends.value ? dotField(ctx.value, board.value, shift.value) : []))
  const grid = computed(() => (ctx.value && !ends.value ? dotGrid(ctx.value, board.value) : null))
  const marks = computed(() => (ends.value ? endMarks2d(ends.value, d.px(), d.mirror?.() ?? false, d.board()) : []))
  /** the candidate under the pointer, which a click picks */
  const endPointer = computed<EndCandidate | null>(() => (ends.value && pointer.value ? nearestEnd(ends.value, pointer.value, MAGNET_PX * 1.5 * d.px()) : null))
  /** what is lit as a hover: the pointer's candidate, else the editor's completion focus */
  const endHover = computed(() => (ends.value ? litEnd(t, ends.value, endPointer.value) : null))
  const hover = computed<Dot | null>(() => (pointer.value ? nearest(dots.value, pointer.value, MAGNET_PX * d.px()) : null))

  /** the field as one path per brightness step, faint dots in their own steps */
  const field = computed(() => {
    const g = grid.value
    if (!g) return { ok: [], off: [] }
    const anchor = ctx.value!.start
    const lit = (x: Dot) => ({ at: x.at, level: light(x.at, anchor, pointer.value, g.pitch * LIT) })
    const r = d.px() * 2.2
    return { ok: dotPaths(dots.value.filter(x => x.ok).map(lit), r, STEPS), off: dotPaths(dots.value.filter(x => !x.ok).map(lit), r, STEPS) }
  })
  /** the cursor-lit grid, unbounded, round the pointer */
  const litPaths = computed(() => (grid.value && pointer.value ? dotPaths(litGrid(grid.value, pointer.value), d.px() * 1.2, STEPS) : []))

  const preview = shallowRef<NonNullable<EditPlan['preview']> | null>(null)
  const note = shallowRef<string | null>(null)
  let txn: DragTxn | null = null
  const reset = () => {
    void txn?.cancel()
    txn = null
    preview.value = null
    note.value = null
  }
  const txnOf = (): DragTxn => {
    const isolate = d.store.sel.isolate?.ref ?? null
    txn ??= dragTxn(t.client!, { board: d.board().name, run: d.store.run, tool: 'assist', refs: [], anchor: 'assist', ...(isolate ? { isolate } : {}) }, (p: EditPlan) => {
      preview.value = p.preview ?? null
      note.value = p.notes.join('; ') || null
    })
    txn.started.catch(e => d.store.note(String((e as Error)?.message ?? e), true))
    return txn
  }
  // a new context, or the cursor leaving, ends the pick in progress
  watch(
    () => JSON.stringify(ctx.value),
    () => reset(),
  )
  /** The point previewed: the hovered dot, else what the editor typed. */
  const target = computed<Pt | null>(() => (ends.value ? null : ((d.grid && !d.grid() ? pointer.value : hover.value?.at) ?? (ctx.value ? typedPoint(ctx.value) : null))))
  watch([target, shift], ([p]) => {
    if (!p || !ctx.value || !t.client) {
      preview.value = null
      return
    }
    txnOf().update({ point: { at: p }, pick: shift.value || undefined })
  })

  /** What the hover chip says: the text the pick writes, then the findings, the reason a dot is faint or the router's error. */
  const chip = computed(() => {
    const c = ctx.value,
      p = target.value
    if (ends.value) return endHover.value ? [endHover.value.handle, endHover.value.label] : null
    if (!c || !p) return null
    const command = preview.value?.command ?? c.command
    const lines = [pickText(c, p, command)]
    if (hover.value && !hover.value.ok) lines.push(hover.value.why!)
    if (preview.value?.error) lines.push('route-failed')
    for (const f of preview.value?.findings ?? []) lines.push(f.split(/[:\s]/, 1)[0] || 'finding')
    if (preview.value && !preview.value.findings.length && !preview.value.error && c.command !== 'at') lines.push('DRC clean')
    return lines
  })

  const mods = (e: { shiftKey: boolean }) => {
    if (e.shiftKey !== shift.value) shift.value = e.shiftKey
  }
  function move(e: PointerEvent, at: Pt): void {
    if (!on.value) return
    mods(e)
    pointer.value = at
  }
  /** A press on a dot picks it: the argument written, the editor cursor moving on. */
  function down(e: PointerEvent): boolean {
    if (ends.value) return pickAt(e)
    const at = d.grid && !d.grid() ? pointer.value : hover.value?.at
    if (!on.value || !at || e.button !== 0) return false
    const x = txnOf()
    x.update({ point: { at }, pick: e.shiftKey || undefined })
    txn = null
    x.commit()
      .then(r => {
        if (r.error) d.store.note(r.error, true)
        else if (r.written[0]) t.last = r.written[0].file
      })
      .catch(err => d.store.note(String((err as Error)?.message ?? err), true))
    return true
  }
  /** A press on a candidate fills the route end slot with its handle. */
  function pickAt(e: PointerEvent): boolean {
    const c = endPointer.value
    if (!c || e.button !== 0 || !t.client) return false
    pickEnd(t.client, d.board().name, d.store.run, c.handle, d.store.sel.isolate?.ref ?? null)
      .then(r => {
        if (r.error) d.store.note(r.error, true)
        else if (r.written[0]) t.last = r.written[0].file
      })
      .catch(err => d.store.note(String((err as Error)?.message ?? err), true))
    return true
  }
  function leave(): void {
    pointer.value = null
  }
  /** Escape leaves assist mode until the editor gives a new context. */
  function leaveMode(): boolean {
    if (!on.value) return false
    t.assistOff = true
    reset()
    return true
  }
  return { on, ctx, ends, marks, endHover, dots, hover, field, litPaths, preview, chip, note, pointer, move, down, leave, leaveMode, mods }
}
