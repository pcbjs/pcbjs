// Item uids: `item:` and 12 hex over kind, the call that made the item and its ordinal in that call, so a move or a line above keeps them; see docs/refs.md.
import type { Board, Item } from '@pcbjs/core/model'
import type { Src } from '@pcbjs/core/internal/types'
import { digest } from './cache.js'
import { changed } from './items.js'
import { pulse } from './cancel.js'

/** A project file's call by its text without its `at` and `side`; a package's by its path from the package and position, which a version fixes. */
function srcKey(s: Src | undefined): unknown {
  if (!s) return null
  if (s.hash) return [s.file, s.hash]
  const k = s.file.lastIndexOf('/node_modules/')
  const p = s.file.lastIndexOf('/packages/')
  const file = k >= 0 ? s.file.slice(k + 14) : p >= 0 ? s.file.slice(p + 10) : s.file
  return [file, s.line, s.col]
}

const layersOf = (it: Item): readonly string[] => (it.kind === 'via' || it.kind === 'pad' ? it.layers : [it.layer])

/** Who made an item: the route that laid its copper, else its part, else its source call; an item of no call by its layers and net. */
function maker(it: Item): unknown {
  if ((it.kind === 'track' || it.kind === 'via') && it.route) return ['route', it.route]
  if (it.ref !== undefined) return ['part', it.ref]
  return it.src ? ['src', srcKey(it.src)] : ['none', layersOf(it), it.net ?? null]
}

/** Gives every item without a uid one, in its place on the board: kind, maker and ordinal, a pad's number or its place among its maker's items of its kind in item order; a twin of an earlier item takes `~2`, `~3`. */
export function mintUids(board: Board): void {
  if (board.items.every(it => it.uid)) return
  const placed = new Map<string, number>()
  const seen = new Map<string, number>()
  const count = (m: Map<string, number>, k: string) => {
    const n = (m.get(k) ?? 0) + 1
    m.set(k, n)
    return n
  }
  for (const it of board.items) if (it.uid) count(seen, it.uid.split('~')[0])
  board.items.forEach((it, i) => {
    if ((i & 127) === 0) pulse()
    const group = JSON.stringify([it.kind, maker(it)])
    const ordinal = it.kind === 'pad' && it.ref !== undefined ? it.num : count(placed, group) - 1
    if (it.uid) return
    const base = `item:${digest([it.kind, maker(it), ordinal]).slice(0, 12)}`
    const n = count(seen, base)
    board.items[i] = changed(it, { uid: n > 1 ? `${base}~${n}` : base })
  })
}
