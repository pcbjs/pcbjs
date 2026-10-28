import type { Board, Item, Ring } from '@pcbjs/core/model'
import { circleRing } from './path.js'
import { bbox, offset, polysToRings, strokeClosed, strokeOpen } from './geom.js'
import { isCopper } from './layers.js'
import { RingIndex, type Box } from './spatial.js'

const cache = new WeakMap<Item, Map<string, Ring[]>>()
/** Everything derived from an item's copper rings, keyed by kind, layer and distance; cleared with the rings. */
const derived = new WeakMap<Item, Map<string, unknown>>()

function memo<T>(it: Item, key: string, make: () => T): T {
  let m = derived.get(it)
  if (!m) {
    m = new Map()
    derived.set(it, m)
  }
  if (m.has(key)) return m.get(key) as T
  const v = make()
  m.set(key, v)
  return v
}

export function copperLayersOf(it: Item, copper: string[]): string[] {
  switch (it.kind) {
    case 'pad':
      return it.layers.filter(isCopper)
    case 'via': {
      const a = copper.indexOf(it.layers[0]),
        b = copper.indexOf(it.layers[1])
      const [lo, hi] = a < b ? [a, b] : [b, a]
      return copper.slice(lo, hi + 1)
    }
    case 'track':
    case 'zone':
      return [it.layer]
    case 'graphic':
    case 'text':
      return isCopper(it.layer) ? [it.layer] : []
    default:
      return []
  }
}

/** Polygon rings of an item's copper on one layer (empty when it has none there). */
export function copperRings(it: Item, layer: string): Ring[] {
  let m = cache.get(it)
  if (!m) {
    m = new Map()
    cache.set(it, m)
  }
  const hit = m.get(layer)
  if (hit) return hit
  let rings: Ring[] = []
  switch (it.kind) {
    case 'pad':
      if (it.layers.includes(layer)) rings = [it.poly]
      break
    case 'via':
      rings = [circleRing(it.at[0], it.at[1], it.size / 2)]
      break
    case 'track':
      if (it.layer === layer) rings = polysToRings(strokeOpen(it.pts, it.width))
      break
    case 'zone':
      if (it.layer === layer) rings = polysToRings(it.fill)
      break
    case 'graphic':
      if (it.layer === layer)
        rings = it.fill ? it.paths.filter(r => r.length >= 3) : it.paths.flatMap((r, i) => polysToRings(it.closed[i] ? strokeClosed(r, it.width) : strokeOpen(r, it.width)))
      break
    case 'text':
      if (it.layer === layer) rings = it.polys ? polysToRings(it.polys) : it.strokes.flatMap(r => polysToRings(strokeOpen(r, it.thickness)))
      break
  }
  m.set(layer, rings)
  return rings
}

export function invalidate(it: Item) {
  cache.delete(it)
  derived.delete(it)
}

/** The bounding box of an item's copper on one layer. */
export function copperBox(it: Item, layer: string): Box {
  return memo(it, `box:${layer}`, () => bbox(copperRings(it, layer)))
}

/** An item's copper on one layer with a grid over its rings, so large pours are clipped only near the other shape. */
export function copperIndex(it: Item, layer: string): RingIndex {
  return memo(it, `index:${layer}`, () => new RingIndex(copperRings(it, layer)))
}

/** An item's copper on one layer offset by `delta` mm, round joins, as rings. */
export function grownRings(it: Item, layer: string, delta: number): Ring[] {
  return memo(it, `grow:${layer}:${delta}`, () => polysToRings(offset(copperRings(it, layer), delta)))
}

/** The grown copper of an item with a grid over its rings. */
export function grownIndex(it: Item, layer: string, delta: number): RingIndex {
  return memo(it, `growindex:${layer}:${delta}`, () => new RingIndex(grownRings(it, layer, delta)))
}

/** A round hole of radius `r` at the item's centre, offset by `delta` mm, as rings. */
export function grownHole(it: Item & { at: [number, number] }, r: number, delta: number): Ring[] {
  return memo(it, `hole:${r}:${delta}`, () => polysToRings(offset([circleRing(it.at[0], it.at[1], r)], delta)))
}

export function copperItemsOn(board: Pick<Board, 'items' | 'copper'>, layer: string, copper: string[]): Item[] {
  return board.items.filter(it => copperLayersOf(it, copper).includes(layer))
}
