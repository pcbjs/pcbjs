// `.pcbjs/cache/route/<board>.json` v1: { version, board, groups: { <"" or variant slug>: { legs, tunes? } } }
// Leg: obs hashes the pass's final copper in box without the leg's own route; a failed leg has result null and the board as box.
// Tune: obs hashes the copper, holes, courtyards and silk around the meanders when the step ran.
// Only the entries a compile used are written back.
import type { RouteResult } from '@pcbjs/core/internal/types'
import type { Prim } from '@pcbjs/core/model'
import { platform } from '@pcbjs/core/platform'

/** `narrow`: the end of a joining leg kept off a trunk too narrow for it, see autorouter.md */
export interface LegEntry {
  obs: string
  box: [number, number, number, number]
  result: RouteResult | null
  fail?: { reason: string; layers: string[]; ripup: number }
  narrow?: { side: 0 | 1; kept: boolean }
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
  version: 1
  board: string
  groups: Record<string, Group>
}

/** Bumped whenever the router changes what it produces, so old entries are not reused. */
export const ROUTER_VERSION = 'maze-7'

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
    if (!f) {
      f = this.read() ?? { version: 1, board, groups: {} }
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
    return this.used.legs[key] ?? this.stored.legs[key]
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
    const before = JSON.stringify(this.file.groups[this.group] ?? null)
    this.file.groups[this.group] = this.used
    const p = platform()
    if (!p.store || !this.dir || JSON.stringify(this.used) === before) return
    p.store.write(p.path.join(this.dir, fileName(this.board)), format(this.file))
  }
}

/** The file as JSON with one leg or tune per line, so a diff of it shows which routes changed. */
function format(f: CacheFile): string {
  const J = JSON.stringify
  const entries = (o: Record<string, unknown>) =>
    Object.entries(o)
      .map(([k, v]) => `    ${J(k)}: ${J(v)}`)
      .join(',\n')
  const groups = Object.entries(f.groups)
    .map(([name, g]) => `  ${J(name)}: {\n   "legs": {\n${entries(g.legs)}\n   }${g.tunes ? `,\n   "tunes": {\n${entries(g.tunes)}\n   }` : ''}\n  }`)
    .join(',\n')
  return `{\n "version": 1,\n "board": ${J(f.board)},\n "groups": {\n${groups}\n }\n}\n`
}

function parseMemo(text: string | null): CacheFile | null {
  try {
    const data = text === null ? null : JSON.parse(text)
    return data && data.version === 1 && data.groups && typeof data.groups === 'object' ? data : null
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
