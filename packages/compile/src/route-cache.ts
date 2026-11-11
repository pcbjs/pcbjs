// `.pcbjs/cache/route/<board>.json` v2: { version, board, groups: { <"" or variant slug>: { legs, tunes? } } }
// Leg: reads records the original hard search inputs; legacy result-box entries are not reused.
// Tune: obs hashes the copper, holes, courtyards and silk around the meanders when the step ran.
// Only the entries a compile used are written back.
import type { RouteResult } from '@pcbjs/core/internal/types'
import type { Prim } from '@pcbjs/core/model'
import type { RoutingReads } from './routing-reads.js'
import { platform } from '@pcbjs/core/platform'

/** A raw built-in maze result at its original search inputs; joining state is recomputed. */
export interface LegEntry {
  reads: RoutingReads
  /** Exact result encoding guards accidental memo corruption at the file boundary. */
  value: string
  result: RouteResult
}
/** A pair as the tuner leaves it: its centre line and its layout. */
export interface PairState {
  centre: [number, number][]
  vias: number[]
  layers: string[]
  auto?: boolean[]
  radii?: number[]
  tracks: { layer: string; role: 'P' | 'N'; pts: [number, number][]; width: number; prims?: Prim[] }[]
  pvias: { role: 'P' | 'N'; at: [number, number]; layers: [string, string] }[]
  uncoupled: number
  lengthP: number
  lengthN: number
}
/** One step of length tuning: each track's tuned polyline by ascending id, or the pair, what it added and why it stopped. */
export interface TuneEntry {
  obs: string
  box: [number, number, number, number]
  tracks: [number, number][][]
  prims?: (Prim[] | null)[]
  added: number
  note?: string
  uncoupled?: number
  pair?: PairState
}
interface Group {
  legs: Record<string, LegEntry>
  tunes?: Record<string, TuneEntry>
}
interface CacheFile {
  version: 2
  board: string
  groups: Record<string, Group>
}

/** Bumped whenever the router changes what it produces, so old entries are not reused. */
export const ROUTER_VERSION = 'maze-8'

const KEY = Symbol.for('pcbjs.routeCache')
function store(): Map<string, CacheFile> {
  const g = globalThis as any
  return (g[KEY] ??= new Map())
}

/** The route memos of a cache dir, `<dir>/route`, in Node; null for memos in memory only. The cli always names the project's cache. */
export function routesDir(dir?: string | null): string | null {
  const p = platform()
  return dir && p.store ? p.path.join(dir, 'route') : null
}

const fileName = (board: string) => `${board.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`

/** One board's cache for one compile: reads what is stored, records what this compile uses, and writes that back on commit. */
export class RouteCache {
  private file: CacheFile
  private used: Group = { legs: {} }
  hits = 0

  /** `draft`: a compile of unsaved text, whose entries stay in memory and never reach the file */
  constructor(
    private board: string,
    private group: string,
    private dir: string | null,
    private draft = false,
  ) {
    const key = `${dir ?? ''}\u0000${board}`
    let f = store().get(key)
    if (!f || f.version !== 2) {
      f = this.read() ?? { version: 2, board, groups: {} }
      store().set(key, f)
    }
    this.file = f
  }

  private read(): CacheFile | null {
    const p = platform()
    return p.store && this.dir ? parseMemo(p.text(p.path.join(this.dir, fileName(this.board)))) : null
  }

  private get stored(): Group {
    return this.file.groups[this.group] ?? { legs: {} }
  }

  leg(key: string): LegEntry | undefined {
    const entry = this.used.legs[key] ?? this.stored.legs[key]
    return validLeg(entry) ? entry : undefined
  }
  putLeg(key: string, e: LegEntry) {
    this.used.legs[key] = e
  }
  tune(key: string): TuneEntry | undefined {
    return this.used.tunes?.[key] ?? this.stored.tunes?.[key]
  }
  putTune(key: string, e: TuneEntry) {
    ;(this.used.tunes ??= {})[key] = e
  }

  /** The stored legs kept, for a compile that took the routing from the stage cache. */
  keepLegs() {
    this.used.legs = { ...this.stored.legs }
  }
  /** The stored tunes kept, for a compile that took the tuning from the stage cache. */
  keepTunes() {
    if (this.stored.tunes) this.used.tunes = { ...this.stored.tunes }
  }

  /** Keep what this compile used, in memory and on disk; a draft adds its entries in memory only. */
  commit() {
    if (this.draft) {
      const s = this.stored
      this.file.groups[this.group] = {
        legs: { ...s.legs, ...this.used.legs },
        ...(s.tunes || this.used.tunes ? { tunes: { ...s.tunes, ...this.used.tunes } } : {}),
      }
      return
    }
    const before = this.file.groups[this.group]
    this.file.groups[this.group] = this.used
    const p = platform()
    if (!p.store || !this.dir || (before && sameEntries(before.legs, this.used.legs) && sameEntries(before.tunes, this.used.tunes))) return
    p.store.write(p.path.join(this.dir, fileName(this.board)), format(this.file))
  }
}

const sameEntries = (a: Record<string, unknown> = {}, b: Record<string, unknown> = {}): boolean => {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(k => a[k] === b[k])
}

/** Persist each identical exact topology once; references are dictionary indices,
 * not digests standing in for equality. Runtime entries retain the exact string. */
function format(f: CacheFile): string {
  const topologies: string[] = []
  const indices = new Map<string, number>()
  const intern = (value: string) => {
    let index = indices.get(value)
    if (index === undefined) {
      index = topologies.length
      indices.set(value, index)
      topologies.push(value)
    }
    return index
  }
  const groups = Object.fromEntries(
    Object.entries(f.groups).map(([name, group]) => [
      name,
      {
        ...group,
        legs: Object.fromEntries(
          Object.entries(group.legs)
            .filter(([, leg]) => validLeg(leg))
            .map(([key, leg]) => [key, { ...leg, reads: { ...leg.reads, topology: intern(leg.reads.topology) } }]),
        ),
      },
    ]),
  )
  return JSON.stringify({ version: f.version, board: f.board, topologies, groups }, null, 1) + '\n'
}

/** The persisted boundary rejects incomplete or malformed read certificates. */
function validLeg(value: unknown): value is LegEntry {
  if (!value || typeof value !== 'object') return false
  const e = value as Partial<LegEntry>,
    r = e.reads
  if (!r || r.version !== 2 || typeof r.globals !== 'string' || typeof r.topology !== 'string' || typeof r.requests !== 'string' || typeof e.value !== 'string') return false
  if (!e.result || !Array.isArray(e.result.tracks) || !Array.isArray(e.result.vias)) return false
  const m = r.maze
  return (
    !!m &&
    typeof m.global === 'string' &&
    Array.isArray(m.fields) &&
    m.fields.every(
      f =>
        f &&
        typeof f.name === 'string' &&
        Number.isSafeInteger(f.size) &&
        f.size >= 0 &&
        Array.isArray(f.runs) &&
        f.runs.every(run => Array.isArray(run) && run.length === 2 && Number.isSafeInteger(run[0]) && run[0] >= 0 && typeof run[1] === 'string'),
    ) &&
    Array.isArray(m.queries) &&
    m.queries.every(q => q && (q.kind === 'point' || q.kind === 'segment') && Array.isArray(q.args) && typeof q.value === 'boolean')
  )
}

function parseMemo(text: string | null): CacheFile | null {
  try {
    const data = text === null ? null : JSON.parse(text)
    if (!data || data.version !== 2 || !data.groups || typeof data.groups !== 'object') return null
    for (const group of Object.values(data.groups) as Group[]) {
      if (!group || typeof group !== 'object' || !group.legs || typeof group.legs !== 'object') return null
      for (const [key, raw] of Object.entries(group.legs)) {
        const token: unknown = raw?.reads?.topology
        if (typeof token === 'number' && Number.isSafeInteger(token) && token >= 0 && typeof data.topologies?.[token] === 'string') raw.reads.topology = data.topologies[token]
        if (!validLeg(raw)) delete group.legs[key]
      }
    }
    return { version: 2, board: data.board, groups: data.groups }
  } catch {
    return null
  }
}

/** A route memo file's text taken into memory for a compile without a cache dir, a browser's; a memo already in memory is kept. */
export function seedRoutes(board: string, text: string): void {
  const key = `\u0000${board}`
  const f = store().has(key) ? null : parseMemo(text)
  if (f) store().set(key, f)
}

/** Drop every cached route in memory, for tests. The files stay. */
export function clearRouteCache(): void {
  store().clear()
}

/** A 53-bit string hash as 14 hex digits (cyrb53). */
export function hash(s: string): string {
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

/** Release one retired cache directory from this process without touching its files. */
export function forgetRouteCache(dir: string): void {
  for (const key of store().keys()) if (key.startsWith(`${dir}\u0000`)) store().delete(key)
}
