// The facets of a board between stages, each a content hash, and the delta a stage made, stored as its output; see docs/design.md
import type { Board, Item } from '@pcbjs/core/model'
import type { Facet } from '@pcbjs/core/internal/plugin'
import { partOf } from '@pcbjs/core/internal/part'
import { isCopper } from './layers.js'
import { sha1 } from './cache.js'
import { immutable } from './items.js'
import { pulse } from './cancel.js'

/** Board fields by facet; a field none names is in `rest`. */
const FIELDS: Record<string, string[]> = {
  meta: ['name', 'title', 'rev', 'copper', 'thickness', 'sourcingTags', 'cpl', 'fabNotes', 'outlineFonts', 'variant'],
  rules: ['rules', 'classes', 'via'],
  stackup: ['stackup', 'layers'],
  outline: ['outline', 'bbox'],
  keepouts: ['keepouts'],
  parts: ['footprints', 'references'],
  nets: ['nets'],
  routes: ['routes', 'pairs', 'routing', 'loopNets'],
  findings: ['drc', 'erc', 'ratsnest', 'unconnected'],
  edit: ['edit'],
  plugins: ['plugins'],
  stats: ['stats'],
}
const NAMED = new Set([...Object.values(FIELDS).flat(), 'items', 'schematic'])

/** Every facet a stage or a plugin may read, as `Facet` in core names them: the board's own and what flatten collected for later stages. */
export const FACET_NAMES = [
  'meta',
  'rules',
  'stackup',
  'outline',
  'keepouts',
  'parts',
  'pads',
  'copper',
  'drawings',
  'frame',
  'nets',
  'netlist',
  'routes',
  'findings',
  'edit',
  'plugins',
  'stats',
  'sch',
  'rest',
  'jobs',
  'jobs.finish',
  'jobs.sch',
  'models',
] as const satisfies readonly Facet[]
export type FacetName = (typeof FACET_NAMES)[number]
// the list names every facet core types
const named: Record<Exclude<Facet, FacetName>, never> = {}
void named

/** The facets a board holds, as opposed to the jobs and model files a cached compile adds. */
const ITEM_FACETS = new Set<string>(['pads', 'copper', 'drawings', 'frame'])

/** The board fields that hold a facet: `items` for the item facets, `schematic` for the netlist and the drawing, the unnamed fields for `rest`. */
export function fieldsOf(board: Board, f: FacetName): string[] {
  if (ITEM_FACETS.has(f)) return ['items']
  if (f === 'netlist' || f === 'sch') return ['schematic']
  if (f === 'rest') return Object.keys(board).filter(k => !NAMED.has(k))
  return FIELDS[f] ?? []
}
// a run's own counts, which a warm run tells apart from a cold one
const RUN_COUNTS = new Set(['cached', 'ripped', 'rounds'])

/** The board between two stages: each field's and item's JSON, and the facet hashes over them. */
export interface Snapshot {
  fields: Map<string, string>
  items: Map<number, string>
  facets: Record<string, string>
}

const itemFacet = (it: Item): 'pads' | 'copper' | 'drawings' =>
  it.kind === 'pad' ? 'pads' : it.kind === 'graphic' || it.kind === 'text' ? (isCopper(it.layer) ? 'copper' : 'drawings') : 'copper'

// items are values, replaced and never written, so an item's text holds for as long as the item does
const TEXT = new WeakMap<Item, string>()
const textOf = (it: Item): string => {
  let j = TEXT.get(it)
  if (j === undefined) TEXT.set(it, (j = JSON.stringify(it)))
  return j
}

/** `extra`: facets the board does not hold, such as jobs and the target's own state. */
export function snapshot(board: Board, extra: Record<string, string> = {}): Snapshot {
  const fields = new Map<string, string>()
  for (const k of Object.keys(board)) {
    pulse()
    if (k !== 'items' && (board as any)[k] !== undefined) fields.set(k, JSON.stringify((board as any)[k]))
  }
  const items = new Map<number, string>()
  const groups: Record<string, string[]> = { pads: [], copper: [], drawings: [] }
  const frame: string[] = []
  let n = 0
  for (const it of board.items) {
    if ((n++ & 127) === 0) pulse()
    const j = textOf(it)
    items.set(it.id, j)
    groups[itemFacet(it)].push(j)
    frame.push(`${it.id}${it.kind[0]}`)
  }
  const facets: Record<string, string> = { ...extra, frame: sha1(frame.join()) }
  for (const [g, list] of Object.entries(groups)) facets[g] = sha1(list.join('\n'))
  for (const [f, names] of Object.entries(FIELDS)) facets[f] = sha1(names.map(n => (f === 'routes' && n === 'routing' ? canonRouting(board) : (fields.get(n) ?? '-'))).join('\n'))
  const { drawing, ...netlist } = board.schematic ?? ({} as Board['schematic'])
  facets.netlist = sha1(JSON.stringify(netlist))
  facets.sch = sha1(JSON.stringify(drawing ?? null))
  facets.rest = sha1(
    [...fields]
      .filter(([k]) => !NAMED.has(k))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
  )
  return { fields, items, facets }
}

const canonRouting = (b: Board) => JSON.stringify(b.routing, (k, v) => (RUN_COUNTS.has(k) && typeof v === 'number' ? undefined : v)) ?? '-'

/** What a stage changed: the items that differ, with the new order and the frame it was made from when items came or went, and the board fields that differ. */
export interface Delta {
  order?: number[]
  /** the frame facet before the stage, which the board must have for the order to apply */
  from?: string
  set: Item[]
  fields: Record<string, unknown>
  gone: string[]
}

export function delta(before: Snapshot, board: Board, after: Snapshot): Delta {
  const set = board.items.filter(it => before.items.get(it.id) !== after.items.get(it.id))
  const fields: Record<string, unknown> = {}
  for (const [k, v] of after.fields) if (before.fields.get(k) !== v) fields[k] = (board as any)[k]
  const gone = [...before.fields.keys()].filter(k => !after.fields.has(k))
  const same = before.facets.frame === after.facets.frame
  return { ...(same ? {} : { order: board.items.map(it => it.id), from: before.facets.frame }), set, fields, gone }
}

/** A stored delta applied to a board whose facets are `frame`; false, and the board untouched, when its items came or went otherwise than the delta's did or an item it changes is missing. */
export function applyDelta(board: Board, d: Delta, frame: string): boolean {
  const set = new Map(d.set.map(it => [it.id, it]))
  const cur = new Map(board.items.map(it => [it.id, it]))
  if (d.order && d.from !== frame) return false
  if (!d.order && d.set.some(it => !cur.has(it.id))) return false
  const items: Item[] = []
  for (const id of d.order ?? board.items.map(it => it.id)) {
    const it = set.get(id) ?? cur.get(id)
    if (!it) return false
    items.push(set.has(id) ? immutable(it) : it)
  }
  board.items = items
  for (const [k, v] of Object.entries(d.fields)) (board as any)[k] = v
  for (const k of d.gone) delete (board as any)[k]
  return true
}

/**
 * A stable text of a design value for a key: parts by their ref, nets by name, pins by part and pin, functions by the sha1 of their source.
 * `fns` is set when a function was met, whose closure only the evaluate key covers.
 */
export function canon(v: unknown, refOf: (part: object) => string | undefined): { text: string; fns: boolean } {
  let fns = false
  const done = new WeakMap<object, string>()
  const open = new WeakSet<object>()
  const walk = (x: unknown): string => {
    if (x === null) return 'null'
    switch (typeof x) {
      case 'undefined':
        return 'u'
      case 'number':
        return Number.isFinite(x) ? String(x === 0 ? 0 : x) : `"${x}"`
      case 'string':
        return JSON.stringify(x)
      case 'boolean':
        return String(x)
      case 'bigint':
        return `${x}n`
      case 'symbol':
        return 'sym'
      case 'function': {
        const st = partOf(x)
        if (st) return `["part",${JSON.stringify(refOf(st) ?? st.label)}]`
        fns = true
        return `["fn","${sha1(Function.prototype.toString.call(x))}"]`
      }
    }
    const o = x as Record<string, unknown>
    const hit = done.get(o)
    if (hit !== undefined) return hit
    if (open.has(o)) return '"~cycle"'
    open.add(o)
    const out = object(o)
    open.delete(o)
    done.set(o, out)
    return out
  }
  const read = (o: Record<string, unknown>, k: string): string => {
    try {
      return walk(o[k])
    } catch {
      return '"~throws"'
    }
  }
  const object = (o: Record<string, unknown>): string => {
    const brand = o.$$
    if (brand === 'net') return `["net",${JSON.stringify(o.name)}]`
    if (brand === 'nc') return '"nc"'
    if (brand === 'pin') return `["pin",${read(o, 'part')},${JSON.stringify(o.pin)},${JSON.stringify(o.pad ?? null)}]`
    if (brand === 'pcb') return `["pcb",${JSON.stringify(o.type)},${read(o, 'props')},${read(o, 'children')}]`
    if (Array.isArray(o) || ArrayBuffer.isView(o)) return `[${Array.from(o as ArrayLike<unknown>, walk).join(',')}]`
    if (o instanceof Map) return `{"~map":[${[...o].map(([k, v]) => `[${walk(k)},${walk(v)}]`).join(',')}]}`
    if (o instanceof Set) return `{"~set":[${[...o].map(walk).join(',')}]}`
    const keys = Object.keys(o).sort()
    return `{${keys.map(k => `${JSON.stringify(k)}:${read(o, k)}`).join(',')}}`
  }
  const text = walk(v)
  return { text, fns }
}
