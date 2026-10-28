// hover and focus shared by every viewer of one dev server; free of Vue and the DOM so Node imports it in the tests

/** What the pointer is on: board item ids, the parts of a body, symbol or sheet, and its net; each viewer finds the net's pair group itself. */
export interface HoverTarget {
  ids: number[]
  refs: string[]
  net: string | null
}
/** The pinned net and the selection: a part, or a group's parts with its circuit key. */
export interface FocusTarget {
  net: string | null
  ref: string | null
  refs: string[]
  circuit: string | null
}

/** `pcbjs:sync:hover` and `pcbjs:sync:focus` as they travel; the server adds `from` to what it relays. */
export interface HoverMsg {
  board: string
  hover: HoverTarget | null
  from?: number
}
export interface FocusMsg {
  board: string
  focus: FocusTarget
  from?: number
}

/** The part of Vite's `import.meta.hot` the viewer uses. */
export interface Hot {
  send(event: string, data?: unknown): void
  on(event: string, cb: (data: any) => void): void
}

export const NO_FOCUS: FocusTarget = { net: null, ref: null, refs: [], circuit: null }

const keyOf = (board: string, v: unknown) => JSON.stringify([board, v])

/**
 * The client side of the relay. `send` posts to the server, `frame` runs a callback before the next paint.
 * A local change is sent once, a hover at most once a frame; a remote focus applied here is never sent back.
 */
export function createSync(send: (event: string, data: unknown) => void, frame: (cb: () => void) => void) {
  let focusKey = ''
  let hoverKey = keyOf('', null)
  let pending: HoverMsg | null = null
  return {
    /** The local focus changed, by a click or by applying a remote one. */
    focus(board: string, focus: FocusTarget) {
      const k = keyOf(board, focus)
      if (k === focusKey) return
      focusKey = k
      send('pcbjs:sync:focus', { board, focus } satisfies FocusMsg)
    },
    /** A remote focus: returned to apply, and remembered so the change it causes is not sent back. */
    receiveFocus(m: FocusMsg): FocusTarget {
      focusKey = keyOf(m.board, m.focus)
      return m.focus
    },
    /** The local hover changed; null when the pointer left. */
    hover(board: string, hover: HoverTarget | null) {
      const first = !pending
      pending = { board, hover }
      if (!first) return
      frame(() => {
        const m = pending!
        pending = null
        const k = keyOf(m.board, m.hover)
        if (k === hoverKey) return
        hoverKey = k
        send('pcbjs:sync:hover', m)
      })
    },
    /** Tell the server which board this page shows, so it relays that board's messages here and sends its last focus unless `focus` is false. */
    hello(board: string | null, focus = true) {
      focusKey = ''
      send('pcbjs:sync:hello', focus ? { board } : { board, focus })
    },
  }
}

/** A remote hover replaces the one from the same sender and leaves when that sender's pointer does. */
export function remoteHover(current: HoverMsg | null, m: HoverMsg): HoverMsg | null {
  if (m.hover) return m
  return current && current.from !== m.from ? current : null
}
