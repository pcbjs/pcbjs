// the browser side of the loading state: the session's events in, a reactive Load out
import { inject, reactive, type InjectionKey } from 'vue'
import type { LoadStatus } from '@pcbjs/core/protocol'
import { initialLoad, step, type Boot, type Load, type LoadEvent } from './loading'
import type { Transport } from '@pcbjs/ui'

export interface LoadView {
  load: Load
  boot: Boot | null
}
export const LOAD = Symbol.for('pcbjs:load') as InjectionKey<LoadView>
/** null in a built site and on the server, which have no loading state */
export const useLoad = () => inject(LOAD, null)

/** ms between two tries to reach a server that went */
export const RETRY_MS = 2000

/** Follow the session: its status, the first drawn view, and its going away, after which the server is tried every RETRY_MS until the page reloads. */
export function startLoad(t: Transport, boot: Boot | null): LoadView {
  const v = reactive<LoadView>({ load: initialLoad(boot?.status), boot })
  const on = (e: LoadEvent) => {
    v.load = step(v.load, e)
  }
  let leaving = false
  addEventListener('pagehide', () => {
    leaving = true
  })
  // the session's first frames after the hello: the status, and the first compile when nothing started it
  t.on('pcbjs:status', (st: LoadStatus) => on({ kind: 'status', status: st }))
  t.closed(() => {
    if (leaving || v.load.phase === 'gone') return
    on({ kind: 'lost' })
    setInterval(() => {
      fetch(location.href, { method: 'HEAD', cache: 'no-store' }).then(
        () => location.reload(),
        () => on({ kind: 'retry' }),
      )
    }, RETRY_MS)
  })
  const root = document.documentElement
  const drawn = () => {
    if (root.dataset.ready) on({ kind: 'drawn' })
  }
  new MutationObserver(drawn).observe(root, { attributes: true, attributeFilter: ['data-ready'] })
  return v
}
