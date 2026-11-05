import { computed, ref, watch } from 'vue'
import type { PaneContext } from '../context'
import type { Result } from '@pcbjs/core/protocol'
import { anchorPart } from '../selection'

export function usePlacementLock(ctx: PaneContext) {
  const store = ctx.board
  const site = computed(() => store.layoutSite)
  const view = computed(() => (ctx.pane.mode === 'sch' ? ('sch' as const) : ('pcb' as const)))
  const part = computed(() => (site.value ? anchorPart(site.value, store.sel) : null))
  const visible = computed(() => !!site.value?.dev && !!store.edit.client && !!part.value)
  const state = ref<Result<'session/edit/lock'> | null>(null)
  const pending = ref(false)
  const failure = ref<string | null>(null)
  const isolate = computed(() => (store.sel.isolate?.mode === 'library' ? store.sel.isolate.ref : null))
  const request = computed(() => (part.value ? { board: store.name, ref: part.value, view: view.value, isolate: isolate.value } : null))
  watch(
    [request, () => store.run, site, () => store.edit.client],
    async (_, __, cleanup) => {
      state.value = null
      failure.value = null
      let active = true
      cleanup(() => {
        active = false
      })
      if (!visible.value || !request.value) return
      try {
        const result = await store.edit.client!.lockState(request.value)
        if (active) state.value = result
      } catch (error) {
        if (active) failure.value = String(error)
      }
    },
    { immediate: true },
  )
  const locked = computed(
    () =>
      state.value?.locked ??
      (view.value === 'sch' ? !!site.value?.schematic.drawing?.symbols.find(s => s.ref === part.value)?.locked : !!site.value?.footprints.find(f => f.ref === part.value)?.locked),
  )
  const reason = computed(
    () =>
      state.value?.reason ??
      (store.edit.mode?.mode !== 'rw' || !!store.site?.variant?.index
        ? 'This view is read-only.'
        : Object.keys(store.invalid).length
          ? 'Waiting for the current board.'
          : pending.value
            ? 'Updating placement lock.'
            : (failure.value ?? (!state.value ? 'Checking placement source.' : null))),
  )
  async function toggle() {
    const client = store.edit.client,
      target = request.value
    if (!client || !target || reason.value || pending.value) return
    const next = !locked.value
    pending.value = true
    let txn: string | undefined
    try {
      txn = (await client.begin({ ...target, tool: 'lock', anchor: target.ref, refs: [target.ref], run: store.run })).txn
      await client.update(txn, { locked: next })
      const result = await client.commit(txn)
      txn = undefined
      if (result.error) store.note(result.error, true)
      const fresh = await client.lockState(target)
      if (request.value === target) state.value = fresh
    } catch (error) {
      if (txn) await client.cancel(txn).catch(() => {})
      store.note(String(error), true)
    } finally {
      pending.value = false
    }
  }
  return { visible, locked, reason, toggle }
}
