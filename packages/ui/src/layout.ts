import { ref, watch } from 'vue'
import type { BoardStore } from './board-store'
import type { Transport } from './transport'

export function connectLibrary(t: Transport, shown: () => BoardStore | null) {
  let generation = 0
  const supported = ref<boolean | null>(null)
  t.on('pcbjs:ide:ready', ready => {
    supported.value = ready.capabilities.includes('layout')
  })
  watch(
    () => {
      const b = shown()
      return b && b.sel.isolate?.mode === 'library' ? ([b, b.sel.isolate.ref, b.target, b.run, b.libraryN, supported.value] as const) : null
    },
    async (current, _was, cleanup) => {
      const n = ++generation
      cleanup(() => {
        generation++
      })
      if (!current) return
      const [b, ref, target, run] = current
      if (supported.value === null) {
        b.libraryState = 'loading'
        b.libraryError = null
        return
      }
      if (supported.value === false) {
        b.libraryState = 'unsupported'
        b.libraryError = 'This server does not support library previews. Update pcbjs and restart the server.'
        return
      }
      if (b.library?.ref === ref && b.library.target === target && b.library.run === run) {
        b.libraryState = 'ready'
        b.libraryError = null
        return
      }
      b.libraryState = 'loading'
      b.libraryError = null
      try {
        const site = await t.request('session/layout', { board: b.name, target, ref })
        if (n === generation && b.sel.isolate?.mode === 'library' && b.sel.isolate.ref === ref && b.target === target && b.run === run) {
          b.library = { ref, target, run, site }
          b.libraryState = 'ready'
        }
      } catch (e) {
        if (n === generation) {
          b.libraryState = 'error'
          b.libraryError = e instanceof Error ? e.message : String(e)
        }
      }
    },
    { immediate: true },
  )
}
