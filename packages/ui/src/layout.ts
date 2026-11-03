import { watch } from 'vue'
import type { BoardStore } from './board-store'
import type { Transport } from './transport'

export function connectLibrary(t: Transport, shown: () => BoardStore | null) {
  let generation = 0
  watch(() => {
    const b = shown()
    return b && b.sel.isolate?.mode === 'library' ? [b, b.sel.isolate.ref, b.target, b.run, b.libraryN] as const : null
  }, async (current, _was, cleanup) => {
    const n = ++generation
    cleanup(() => { generation++ })
    if (!current) return
    const [b, ref, target, run] = current
    if (b.library?.ref === ref && b.library.target === target && b.library.run === run) { b.libraryState = 'ready'; b.libraryError = null; return }
    b.libraryState = 'loading'
    b.libraryError = null
    try {
      const site = await t.request('session/layout', { board: b.name, target, ref })
      if (n === generation && b.sel.isolate?.mode === 'library' && b.sel.isolate.ref === ref && b.target === target && b.run === run) { b.library = { ref, target, run, site }; b.libraryState = 'ready' }
    } catch (e) {
      if (n === generation) {
        b.libraryState = 'error'
        b.libraryError = e instanceof Error ? e.message : String(e)
      }
    }
  }, { immediate: true })
}

