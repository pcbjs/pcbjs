// `.pcbjs/cache`: meta.json, vite/, index/<board>[~<slug>].json, objects/<hh>/<hash>.json.gz and .bin, route/<board>.json, references/; see docs/design.md
// An object is a stage output as JSON, named by the sha1 of that JSON; an index names the stage keys and objects of a board's last two compiles.
// On a platform without a store, a browser's, every stage output stays in this realm's memory.
import { platform, type Platform } from '@pcbjs/core/platform'
import { BuildGraph } from './build-graph.js'

/** Bumped when the layout or the meaning of an index or object changes; another format makes every index unread. */
export const CACHE_FORMAT = 1

/** sha1 as 40 hex, by the platform. */
export const sha1 = (s: string | Uint8Array): string => platform().sha1(s)

/** A key over its parts: `hash([stage, compileId, ...facet hashes, ...own inputs])`. */
export const digest = (parts: readonly unknown[]): string => sha1(JSON.stringify(parts))

const CONFIGS = ['pcb.config.ts', 'pcb.config.mts', 'pcb.config.js', 'pcb.config.mjs']

/** `dir`, else `<cwd>/.pcbjs/cache` in a project with a pcb.config file, else null for a cache in memory only. */
export function cacheDir(dir?: string | null): string | null {
  if (dir === null) return null
  const p = platform()
  if (!p.store) return null
  if (dir) return dir
  const cwd = p.cwd()
  return CONFIGS.some(f => p.exists(p.path.join(cwd, f))) ? p.path.join(cwd, '.pcbjs', 'cache') : null
}

const ids = new Map<string, string>()
/** A package's version, plus the hash of its dist when it is a workspace link, whose version does not move between commits. */
export function packageId(dir: string): string {
  const hit = ids.get(dir)
  if (hit) return hit
  const p = platform()
  if (p.name !== 'node') return 'browser'
  let version = '0.0.0'
  try {
    version = JSON.parse(p.text(p.path.join(dir, 'package.json'))!).version
  } catch {
    /* no package.json: the dist hash alone */
  }
  let id = version
  const real = p.realpath(dir)
  if (!real.split(p.path.sep).includes('node_modules')) {
    const parts = distParts(p, real, p.path.join(real, 'dist'))
    if (parts) id = `${version}+${p.sha1(concat(parts)).slice(0, 16)}`
  }
  ids.set(dir, id)
  return id
}

/** Each file under `d` by name, as `<path from real>\0` and its bytes; null when `d` is no folder. */
function distParts(p: Platform, real: string, d: string): Uint8Array[] | null {
  const names = p.list(d)
  if (!names) return null
  const out: Uint8Array[] = []
  for (const name of names.sort((a, b) => (a < b ? -1 : 1))) {
    const f = p.path.join(d, name)
    if (p.stat(f)?.dir) out.push(...(distParts(p, real, f) ?? []))
    else if (!name.endsWith('.tsbuildinfo')) out.push(new TextEncoder().encode(`${p.path.relative(real, f)}\0`), p.read(f) ?? new Uint8Array())
  }
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0))
  let at = 0
  for (const b of parts) {
    out.set(b, at)
    at += b.length
  }
  return out
}

/** The packages whose code the stages run: their ids together are `compileId`. */
type Part = 'compile' | 'core'
let forced: Partial<Record<Part, string>> = {}
/** For tests: compile as another version of `@pcbjs/compile` or `@pcbjs/core` would; null restores both. */
export function setCompileId(ids: Partial<Record<Part, string>> | null): void {
  forced = ids ?? {}
}

/** Each part's package.json, as this module resolves it. */
const manifests: Record<Part, () => string> = {
  compile: () => new URL('../package.json', import.meta.url).href,
  core: () => import.meta.resolve('@pcbjs/core/package.json'),
}

function partId(part: Part): string {
  const p = platform()
  try {
    return forced[part] ?? packageId(p.path.dirname(p.fromUrl(manifests[part]())))
  } catch {
    return 'unknown'
  }
}

/** A digest over the package ids of `@pcbjs/compile` and `@pcbjs/core`, the code every stage runs. */
export function compileId(): string {
  if (platform().name !== 'node') return 'browser'
  return digest([partId('compile'), partId('core')])
}

/** One stage of a compile as an index lists it: its key, the object of its output when it has one, and what it took. */
export interface StageEntry {
  name: string
  key: string
  out?: string
  ms?: number
  /** the facet hashes of the board after the stage, for a stage whose output is restored only with a later one's */
  facets?: Record<string, string>
  /** the binary objects its output names, such as an export's GLB */
  blobs?: string[]
}
/** What a compile of one board or target recorded; `files` and `evaluate` let the next start serve it without evaluating. */
export interface IndexRecord {
  compileId: string
  board: string
  target?: string
  /** the target's place among the entry's targets, from 0 */
  order: number
  targets: number
  entry?: string
  evaluate?: string
  env?: string
  /** the default layer the compile took, as defaultsKey gives it */
  defaults?: string
  exports?: string
  files?: Record<string, string>
  /** every stage ran or hit, and startup reuse needs no plugin evaluation */
  complete: boolean
  stages: StageEntry[]
}
interface IndexFile extends IndexRecord {
  format: number
  previous?: IndexRecord
}

const MEMORY = Symbol.for('pcbjs.stageCache')
interface Memory {
  /** object JSON by hash, the newest last */
  objects: Map<string, string>
  /** binary objects by hash, the newest last */
  blobs: Map<string, Uint8Array>
  /** every entry this process recorded or read, by key */
  entries: Map<string, StageEntry>
  graphs?: Map<string, BuildGraph>
}
const memory = (): Memory => ((globalThis as any)[MEMORY] ??= { objects: new Map(), blobs: new Map(), entries: new Map() })
const KEEP_OBJECTS = 96
const KEEP_BLOBS = 16
const KEEP_ENTRIES = 4096

function remember<K, V>(m: Map<K, V>, k: K, v: V, cap: number): void {
  m.delete(k)
  m.set(k, v)
  if (m.size > cap) m.delete(m.keys().next().value as K)
}

/** Drop what this process remembers of stage outputs, for tests. The files stay. */
export function clearStageCache(): void {
  const m = memory()
  m.objects.clear()
  m.blobs.clear()
  m.entries.clear()
  m.graphs?.clear()
}

/** In-memory products of one entry and target; no identity means a fresh graph. */
export function buildGraph(identity: string | null): BuildGraph {
  if (identity === null) return new BuildGraph()
  const graphs = (memory().graphs ??= new Map())
  const graph = graphs.get(identity) ?? new BuildGraph()
  remember(graphs, identity, graph, 32)
  return graph
}

export const indexName = (board: string, slug?: string): string => `${(slug ? `${board}~${slug}` : board).replace(/[^A-Za-z0-9._~-]+/g, '_')}.json`

/** The stage outputs of one board or target: found by key in this process or in the board's index, read from memory or from objects. */
export class StageStore {
  private file: IndexFile | null
  private now: StageEntry[] = []

  /** `draft`: a compile of unsaved text, which reads the cache and writes memory only */
  constructor(
    readonly dir: string | null,
    readonly board: string,
    readonly slug: string,
    readonly draft = false,
  ) {
    this.file = dir ? readIndex(dir, indexName(board, slug)) : null
  }

  /** The entry a key names, from this process or the last two compiles of this board. */
  find(key: string): StageEntry | undefined {
    const m = memory().entries.get(key)
    if (m) return m
    for (const r of [this.file, this.file?.previous]) {
      const e = r?.stages.find(s => s.key === key)
      if (e) return e
    }
    return undefined
  }

  /** The output an entry names, or undefined when it has none or its object is missing or unreadable. */
  read(e: StageEntry): unknown {
    if (!e.out) return undefined
    const text = readObject(this.dir, e.out)
    if (text === null) return undefined
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }

  /** Whether the object an entry names is in memory or on disk, without reading it. */
  has(e: StageEntry): boolean {
    if (!e.out) return false
    if (memory().objects.has(e.out)) return true
    const p = platform()
    return !!p.store && !!this.dir && p.exists(objectPath(p, this.dir, e.out))
  }

  /** A stage that hit: listed again by this compile. */
  hit(e: StageEntry): void {
    this.now.push(e)
    remember(memory().entries, e.key, e, KEEP_ENTRIES)
  }

  /** A stage that ran: its output stored by content, in memory and, unless a draft, in objects. */
  put(name: string, key: string, value: unknown, ms: number, facets?: Record<string, string>): StageEntry {
    const e: StageEntry = { name, key, ms: Math.round(ms * 10) / 10, ...(facets ? { facets } : {}) }
    if (value !== undefined) e.out = writeObject(this.draft ? null : this.dir, JSON.stringify(value))
    this.hit(e)
    return e
  }

  /** Bytes stored by content, in memory and, unless a draft, beside the objects; their hash names them. */
  putBlob(bytes: Uint8Array): string {
    return writeBlob(this.draft ? null : this.dir, bytes)
  }

  get stages(): readonly StageEntry[] {
    return this.now
  }

  /** The index written for this compile, the last one kept as `previous`; a draft writes none. */
  commit(rec: Omit<IndexRecord, 'stages' | 'compileId' | 'board'>): void {
    const p = platform()
    if (this.draft || !this.dir || !p.store) return
    const { previous: _, format: __, ...last } = this.file ?? ({} as IndexFile)
    const file: IndexFile = {
      format: CACHE_FORMAT,
      compileId: compileId(),
      board: this.board,
      ...(this.slug ? { target: this.slug } : {}),
      ...rec,
      stages: this.now,
      ...(this.file ? { previous: last as IndexRecord } : {}),
    }
    p.store.write(p.path.join(this.dir, 'index', indexName(this.board, this.slug)), JSON.stringify(file))
    this.file = file
  }
}

function readIndex(dir: string, name: string): IndexFile | null {
  const p = platform()
  if (!p.store) return null
  try {
    const f = JSON.parse(p.text(p.path.join(dir, 'index', name))!) as IndexFile
    return f && f.format === CACHE_FORMAT && Array.isArray(f.stages) ? f : null
  } catch {
    return null
  }
}

/** Remove the indexes of an entry for boards or targets it no longer makes, such as a board renamed. */
export function dropIndexes(dir: string, entry: string, keep: ReadonlySet<string>): void {
  const p = platform()
  if (!p.store) return
  for (const [name, f] of readIndexes(dir)) if (f.entry === entry && !keep.has(name)) p.store.remove(p.path.join(dir, 'index', name))
}

/** Every index of the cache, by file name. */
export function readIndexes(dir: string): Map<string, IndexFile> {
  const p = platform()
  const out = new Map<string, IndexFile>()
  if (!p.store) return out
  for (const f of p.list(p.path.join(dir, 'index'))?.filter(f => f.endsWith('.json')) ?? []) {
    const r = readIndex(dir, f)
    if (r) out.set(f, r)
  }
  return out
}

const objectPath = (p: Platform, dir: string, h: string) => p.path.join(dir, 'objects', h.slice(0, 2), `${h}.json.gz`)

/** The JSON of an object, from memory or disk; null when missing, unreadable or not what its name says. */
function readObject(dir: string | null, h: string): string | null {
  const m = memory().objects.get(h)
  if (m !== undefined) return m
  const p = platform()
  if (!p.store || !dir) return null
  const file = objectPath(p, dir, h)
  try {
    const text = p.store.gunzip(p.read(file)!)
    if (sha1(text) !== h) throw new Error('not its content')
    remember(memory().objects, h, text, KEEP_OBJECTS)
    return text
  } catch {
    // gone so the next write of this content puts it back
    p.store.remove(file)
    return null
  }
}

const blobPath = (p: Platform, dir: string, h: string) => p.path.join(dir, 'objects', h.slice(0, 2), `${h}.bin`)

/** A binary object from memory or disk; null when missing or not what its name says. */
export function readBlob(dir: string | null, h: string): Uint8Array | null {
  const m = memory().blobs.get(h)
  if (m) return m
  const p = platform()
  if (!p.store || !dir) return null
  const file = blobPath(p, dir, h)
  const bytes = p.read(file)
  if (bytes && sha1(bytes) === h) {
    remember(memory().blobs, h, bytes, KEEP_BLOBS)
    return bytes
  }
  p.store.remove(file)
  return null
}

function writeBlob(dir: string | null, bytes: Uint8Array): string {
  const h = sha1(bytes)
  remember(memory().blobs, h, bytes, KEEP_BLOBS)
  const p = platform()
  if (!p.store || !dir) return h
  const file = blobPath(p, dir, h)
  if (!p.exists(file)) p.store.write(file, bytes)
  return h
}

function writeObject(dir: string | null, text: string): string {
  const h = sha1(text)
  remember(memory().objects, h, text, KEEP_OBJECTS)
  const p = platform()
  if (!p.store || !dir) return h
  const file = objectPath(p, dir, h)
  if (!p.exists(file)) p.store.write(file, p.store.gzip(text))
  return h
}

/** meta.json, rewritten when the format or compileId changed. */
export function writeMeta(dir: string): void {
  const p = platform()
  if (!p.store) return
  const file = p.path.join(dir, 'meta.json')
  const text = JSON.stringify({ format: CACHE_FORMAT, compileId: compileId() })
  if (p.text(file) !== text) p.store.write(file, text)
}

/** Remove every object that neither the current nor the previous index of any board names. */
export function prune(dir: string): number {
  const p = platform()
  const store = p.store
  if (!store) return 0
  const keep = new Set<string>()
  for (const f of readIndexes(dir).values())
    for (const r of [f, f.previous])
      for (const s of r?.stages ?? []) {
        if (s.out) keep.add(s.out)
        for (const b of s.blobs ?? []) keep.add(b)
      }
  let removed = 0
  const root = p.path.join(dir, 'objects')
  for (const sub of p.list(root) ?? [])
    for (const name of p.list(p.path.join(root, sub)) ?? []) {
      if (keep.has(name.replace(/\.(json\.gz|bin)$/, ''))) continue
      try {
        store.remove(p.path.join(root, sub, name))
        removed++
      } catch {
        /* another process */
      }
    }
  return removed
}

/** The index records of an entry that the current files, env, default layer and exporters still match, one per target in order; null when none does. */
export function servable(dir: string, entry: string, current: { env: string; exports: string; defaults: string; hashOf: (file: string) => string }): IndexRecord[] | null {
  const records = [...readIndexes(dir).values()].flatMap(f => [f, ...(f.previous ? [f.previous] : [])]).filter(r => r.entry === entry && r.complete)
  const cid = compileId()
  const groups = new Map<string, IndexRecord[]>()
  for (const r of records) {
    if (r.compileId !== cid || r.env !== current.env || r.defaults !== current.defaults || r.exports !== current.exports || !r.evaluate || !r.files) continue
    groups.set(r.evaluate, [...(groups.get(r.evaluate) ?? []), r])
  }
  const seen = new Map<string, string>()
  const hashOf = (f: string) => {
    let h = seen.get(f)
    if (h === undefined) seen.set(f, (h = current.hashOf(f)))
    return h
  }
  for (const list of groups.values()) {
    const byOrder = new Map(list.map(r => [r.order, r]))
    const targets = list[0].targets
    if (byOrder.size !== targets || [...byOrder.keys()].some(o => o >= targets)) continue
    if (Object.entries(list[0].files!).every(([f, h]) => hashOf(f) === h)) return [...byOrder.values()].sort((a, b) => a.order - b.order)
  }
  return null
}

/** An object by hash, parsed; undefined when missing or unreadable. */
export function readStored(dir: string, h: string): unknown {
  const text = readObject(dir, h)
  if (text === null) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** `--fresh`: the index and objects deleted, and with `all` the route memos; the folders of older layouts go too. */
export function freshCache(project: string, all = false): void {
  const p = platform()
  const store = p.store
  if (!store) return
  const pc = p.path.join(project, '.pcbjs')
  const dir = p.path.join(pc, 'cache')
  const keep = new Set(['vite', 'references', 'meta.json', ...(all ? [] : ['route'])])
  for (const f of p.list(dir) ?? []) if (!keep.has(f)) store.remove(p.path.join(dir, f))
  for (const old of ['routes', 'references']) store.remove(p.path.join(pc, old))
  clearStageCache()
}
