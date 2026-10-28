// the browser side of the loading state: the dev server's events in, a reactive Load out
import { inject, reactive, type InjectionKey } from 'vue'
import { initialLoad, step, type Boot, type Load, type LoadEvent, type ServerStatus } from './loading'
import type { Hot } from './sync'

export interface LoadView {
  load: Load
  boot: Boot | null
}
export const LOAD = Symbol.for('pcbjs:load') as InjectionKey<LoadView>
/** null in a built site and on the server, which have no loading state */
export const useLoad = () => inject(LOAD, null)

/** ms between two tries to reach a server that went */
export const RETRY_MS = 2000

/** Follow the dev server: its status, the first drawn view, and its going away, after which it is tried every RETRY_MS until the page reloads. */
export function startLoad(hot: Hot, boot: Boot | null): LoadView {
  const v = reactive<LoadView>({ load: initialLoad(boot?.status), boot })
  const on = (e: LoadEvent) => {
    v.load = step(v.load, e)
  }
  let leaving = false
  addEventListener('pagehide', () => {
    leaving = true
  })
  hot.on('pcbjs:status', (st: ServerStatus) => on({ kind: 'status', status: st }))
  hot.on('vite:ws:connect', () => hot.send('pcbjs:viewer:status', {}))
  hot.send('pcbjs:viewer:status', {})
  hot.on('vite:ws:disconnect', () => {
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
