// the browser side of the hover and focus relay, see sync.ts
import { watch } from 'vue'
import { createSync, remoteHover, type Hot, type FocusMsg, type FocusTarget, type HoverMsg } from './sync'
import type { BoardViewState, Store } from './state'

const focusOf = (v: BoardViewState): FocusTarget => ({ net: v.pinnedNet, ref: v.activeRef, refs: [...v.selectedRefs], circuit: v.activeCircuit })

/** Share this page's hover and focus with the other viewers of its board, and show theirs; `own` keeps the first board's focus, as ?select= sets it. */
export function startSync(store: Store, hot: Hot, own = false) {
  const sync = createSync(
    (e, d) => hot.send(e, d),
    cb => requestAnimationFrame(cb),
  )
  const { ui } = store
  const name = () => store.current.value?.name ?? null
  watch(
    name,
    n => {
      ui.remote = null
      sync.hello(n, !own)
      own = false
    },
    { immediate: true },
  )
  hot.on('vite:ws:connect', () => sync.hello(name()))
  // a board switch shows that board's own focus, which is not news to the others
  watch(
    () => {
      const n = name()
      return n ? [n, JSON.stringify(focusOf(store.boardView(n)))] : null
    },
    (now, was) => {
      if (now && was && now[0] === was[0]) sync.focus(now[0], JSON.parse(now[1]))
    },
  )
  watch(
    () => ui.hoverItem,
    h => {
      const n = name()
      if (n) sync.hover(n, h)
    },
  )
  hot.on('pcbjs:sync:focus', (m: FocusMsg) => {
    if (m.board !== name()) return
    const f = sync.receiveFocus(m)
    Object.assign(store.boardView(m.board), { pinnedNet: f.net, activeRef: f.ref, selectedRefs: f.refs, activeCircuit: f.circuit })
  })
  hot.on('pcbjs:sync:hover', (m: HoverMsg) => {
    if (m.board === name()) ui.remote = remoteHover(ui.remote, m)
  })
}
