export type FocusKind = 'frame' | 'finding'
export interface FocusSlot {
  frames: { kind: FocusKind; value: unknown }[]
  pending?: unknown
  current?: unknown
}

function cancel(slot: FocusSlot, active: readonly FocusKind[]): void {
  const index = slot.frames.findIndex(frame => !active.includes(frame.kind))
  if (index < 0) return
  slot.pending = slot.frames[index].value
  slot.frames.splice(index)
}

/** An offscreen view consumes its queued rollback when it mounts again. */
export function cancelFocus(slots: Map<string, FocusSlot>, active: readonly FocusKind[]): void {
  for (const slot of slots.values()) cancel(slot, active)
}

/** Snapshots belong to a pane, target and view; changing details does not replace a checkpoint. */
export function focusTransaction<T>(slots: Map<string, FocusSlot>, scope: string, view: '2d' | '3d' | 'sch') {
  const key = `${scope}:${view}`
  let slot = slots.get(key)
  if (!slot) slots.set(key, (slot = { frames: [] }))
  const state = slot
  return {
    begin(kind: FocusKind, snapshot: T): void {
      if (!state.frames.some(frame => frame.kind === kind)) state.frames.push({ kind, value: snapshot })
    },
    cancel(active: readonly FocusKind[]): void {
      cancel(state, active)
    },
    takeRestore(): T | undefined {
      const value = state.pending as T | undefined
      delete state.pending
      if (value !== undefined) state.current = value
      return value
    },
    save(snapshot: T): void {
      state.current = snapshot
    },
    current(): T | undefined {
      return state.current as T | undefined
    },
  }
}
