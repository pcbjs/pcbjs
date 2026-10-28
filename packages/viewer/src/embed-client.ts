// the browser side of embed mode: what the frame posts to the page around it, see ide.ts
import { nextTick, watch } from 'vue'
import { createSync, type HoverMsg } from './sync'
import { embedGate, embedHover, embedViews, type EmbedMessage } from './ide'
import { lastPainted, onPainted } from './ready'
import type { Store } from './state'

/** Post ready once the first view has painted the board, a view each time a switch has painted, and every hover and click selection; nothing outside a frame. */
export function startEmbed(store: Store) {
  if (!store.embed.on || window.parent === window) return
  const post = (m: EmbedMessage) => window.parent.postMessage(m, '*')
  let started = false
  watch(
    () => store.current.value,
    b => {
      if (!b || started) return
      started = true
      // after the view query has applied, so the view it opens is the one ready waits for
      void nextTick(() => gate(store, b.name, embedViews(!!b.schematic?.drawing), post))
    },
    { immediate: true },
  )
}

function gate(store: Store, board: string, views: ReturnType<typeof embedViews>, post: (m: EmbedMessage) => void) {
  const g = embedGate(board, views)
  let following = false
  const send = (m: EmbedMessage | null) => {
    if (!m) return
    post(m)
    if (!following) follow(store, post)
    following = true
  }
  onPainted(v => send(g.painted(v)))
  watch(
    () => store.boardView(board).mode,
    mode => {
      g.shown(mode)
      const p = lastPainted()
      if (p) send(g.painted(p))
    },
    { immediate: true },
  )
}

function follow(store: Store, post: (m: EmbedMessage) => void) {
  const { embed, ui } = store
  const sync = createSync(
    (_, d) => post(embedHover((d as HoverMsg).hover)),
    cb => requestAnimationFrame(cb),
  )
  watch(
    () => ui.hoverItem,
    h => {
      const b = store.current.value
      if (b) sync.hover(b.name, h)
    },
  )
  watch(
    () => (store.current.value ? store.boardView(store.current.value.name).activeRef : null),
    ref => {
      const asked = embed.asked.ref === ref
      embed.asked.ref = undefined
      if (!asked) post({ type: 'pcbjs:select', ref })
    },
  )
}
