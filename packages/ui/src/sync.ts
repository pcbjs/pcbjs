// hover and the selection shared by every viewer of one session; free of Vue and the DOM so Node imports it in the tests
import { emptySelection, sameSelection, type Selection } from '@pcbjs/core/internal/selection'
import type { HoverMsg, HoverWire, SelectMsg, ViewName } from '@pcbjs/core/protocol'

/** What the pointer is on: board item ids of this snapshot, the parts of a body, symbol or sheet, and its net; each viewer finds the net's pair group itself. */
export interface HoverTarget {
  ids: number[]
  refs: string[]
  net: string | null
}
/** Another viewer's hover as this page draws it. */
export interface RemoteHover {
  board: string
  hover: HoverTarget | null
  from?: string
}
/** A local selection as `session/select` offers it: based on the seq it changed, made in a view. */
export interface SelectOffer {
  board: string
  selection: Selection
  base: number
  view?: ViewName
}
/** Where the relay's changes go: the session in dev, the page around an embed. */
export interface SyncOut {
  select?(m: SelectOffer): void
  hover(m: HoverMsg): void
}

const keyOf = (board: string, v: unknown) => JSON.stringify([board, v])

/**
 * The client side of the relay. `out` takes the changes, `frame` runs a callback before the next paint.
 * A local change is sent once with the seq it was based on, a hover at most once a frame; a selection from the session is never sent back.
 */
export function createSync(out: SyncOut, frame: (cb: () => void) => void) {
  let last: Selection | null = null
  let accepted: Selection | null = null
  let seq = 0
  const offers = new Set<Selection>()
  let hoverKey = keyOf('', null)
  let pending: HoverMsg | null = null
  return {
    /** The local selection changed, by a click in `view` or by applying one from the session. */
    select(board: string, selection: Selection, view?: ViewName) {
      if (last && sameSelection(last, selection)) return
      last = selection
      if (out.select) offers.add(selection)
      out.select?.({ board, selection, base: seq, ...(view ? { view } : {}) })
    },
    /** A selection from the session: returned to apply, its seq kept as the base of the next change, and remembered so it is not sent back. */
    receive(m: SelectMsg): Selection {
      if (m.selection.seq >= seq) {
        accepted = m.selection
        seq = m.selection.seq
      }
      if (offers.size && last) return last
      return (last = accepted!)
    },
    /** Keep the newest local intent visible until its requests settle, then apply the latest canonical state. */
    accept(m: SelectOffer, selection: Selection | null): Selection | null {
      if (!offers.delete(m.selection)) return null
      if (selection) this.receive({ board: m.board, selection })
      if (offers.size) return null
      return (last = accepted ?? last ?? emptySelection(m.board))
    },
    /** Roll back only the rejected intent, never a newer local or server selection. */
    reject(m: SelectOffer): Selection | null {
      if (!offers.delete(m.selection)) return null
      if (last !== m.selection) return null
      return (last = accepted ?? emptySelection(m.board))
    },
    /** The local hover changed, as it travels; null when the pointer left. */
    hover(board: string, hover: HoverWire | null) {
      const first = !pending
      pending = { board, hover }
      if (!first) return
      frame(() => {
        const m = pending!
        pending = null
        const k = keyOf(m.board, m.hover)
        if (k === hoverKey) return
        hoverKey = k
        out.hover(m)
      })
    },
    /** The page switched board: whatever it selects there is news to the session. */
    reset() {
      accepted = last = null
      offers.clear()
      seq = 0
    },
  }
}

/** A remote hover replaces the one from the same sender and leaves when that sender's pointer does. */
export function remoteHover(current: RemoteHover | null, m: RemoteHover): RemoteHover | null {
  if (m.hover) return m
  return current && current.from !== m.from ? current : null
}
