// Items are values: a stage that changes one puts a new one in its place on the board, with its id and uid, so every memo keyed by an
// item, the copper rings, the obstacle records, the router's signatures, holds for as long as the item does.
import type { Board, Item } from '@pcbjs/core/model'
import { platform } from '@pcbjs/core/platform'

/** Under PCBJS_FREEZE an item is deep-frozen as it joins a board, so a write to it throws where it is made. */
export function immutable<T extends Item>(it: T): T {
  return platform().env('PCBJS_FREEZE') === '1' ? deepFreeze(it) : it
}

/** `it` with `change` on the board in its place; a key set to undefined is dropped. */
export function replaced<T extends Item>(board: Board, it: T, change: Partial<T>): T {
  const i = board.items.indexOf(it)
  if (i < 0) throw new Error(`${it.kind} ${it.id} is not on the board it is replaced on`)
  return (board.items[i] = changed(it, change))
}

/** `it` with `change`, a key set to undefined dropped, frozen as it joins the board. */
export function changed<T extends Item>(it: T, change: Partial<T>): T {
  const next = { ...it, ...change }
  for (const k of Object.keys(change) as (keyof T)[]) if (change[k] === undefined) delete next[k]
  return immutable(next)
}

export function deepFreeze<T>(v: T): T {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v) || ArrayBuffer.isView(v)) return v
  Object.freeze(v)
  for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k])
  return v
}
