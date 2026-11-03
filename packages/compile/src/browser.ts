// @pcbjs/compile/browser: the compile in a Web Worker, its protocol and compileInBrowser(), see docs/browser.md.
// The worker side runs on a memory platform with its own stage cache and route memos; it never exchanges a cache with Node.
import { memoryPlatform, platform, setPlatform, type MemoryFile } from '@pcbjs/core/platform'
import { facetHash, type FacetName, type FacetOut, type StageStatus } from '@pcbjs/core/site-facets'
import type { PcbPlugin } from '@pcbjs/core/internal/plugin'
import type { ReferencedBoard, ReferenceResolver } from '@pcbjs/core/internal/reference'
import { inRealm, newRealm, realm, type Realm } from '@pcbjs/core/internal/realm'
import { compileLoaded, stageStatus, type StageEvent } from './pipeline.js'
import { evaluateEntry, type ModuleLoader } from './entry.js'
import { patchesFile } from '@pcbjs/core/internal/patch'
import { fetchedRel } from './models.js'
import { seedRoutes } from './route-cache.js'
import { selfCheck, type SelfCheck } from './self-check.js'
import { sourceMapper, type Position, type SourceMapV3 } from './source-map.js'
import { installNodeMath, mathKind, setMathKind, type MathKind } from './fdlibm.js'

export { memoryPlatform as browserPlatform } from '@pcbjs/core/platform'
export { selfCheck, SELF_CHECK_HASH, type SelfCheck } from './self-check.js'
export { mathKind, type MathKind } from './fdlibm.js'

/** One entry ready for a browser compile: its modules as browser ESM and every file it reads, by virtual path under `root`. */
export interface BrowserModule {
  format: 1
  /** the virtual project root, `/project` */
  root: string
  /** names the project, whose registries one worker keeps apart from another's: every entry of a project shares it; default the config's URL, else the module's */
  project?: string
  /** the entry relative to the root, as the CLI names it */
  entry: string
  /** the config as browser ESM, evaluated first for its defaults, plugins and KiCad folders */
  config?: string
  /** the design as browser ESM, its default export the board; a source map names its sources by virtual path */
  module: string
  /** the entry's `.patches.ts` as browser ESM, when it has one */
  patches?: string
  /** every built module of the project's own sources the entry reaches, whose stack frames map back to them through their source maps */
  modules?: string[]
  /** the sha1 of each source module evaluated, by virtual path, which keys the stage cache */
  sources: Record<string, string>
  /** fonts, KiCad footprints and models by virtual path: a URL fetched before the compile, or null for a file that only has to exist */
  files?: Record<string, string | null>
  /** route memos by board name: URLs of `.pcbjs/cache/route/<board>.json` */
  routes?: Record<string, string>
  /** what reference() names, by absolute virtual entry: URLs of each ReferencedBoard as JSON */
  references?: Record<string, string>
  /** what the compile reads of the environment */
  env?: Record<string, string>
  /** the one timestamp of the compile's facets, so they hash as the Node compile's did; default now */
  generatedAt?: string
  /** the mesh hash of each model file of `files` the module carries no content of, by virtual path, as Node hashed it, so the 3D view finds the mesh beside the site */
  meshes?: Record<string, string>
  /** checkHash of each facet the Node compile gave, by facetKey */
  expect?: Record<string, string>
  /** how the Node that built the module rounds its Math, mathKind() there; default plain, as on x86-64 */
  math?: MathKind
}

export interface WorkerError {
  name?: string
  message: string
  stack?: string
  cancelled?: boolean
}

export type ToBrowserWorker =
  | { t: 'init'; flag: SharedArrayBuffer }
  /** `boards`: also the final board of each target as JSON, for tests and tools */
  | { t: 'compile'; id: number; module: BrowserModule; want?: FacetName[]; boards?: boolean }

export type FromBrowserWorker =
  | { t: 'ready'; check: SelfCheck }
  | { t: 'stage'; id: number; s: StageStatus }
  | { t: 'facet'; id: number; f: FacetOut }
  | { t: 'board'; id: number; board: string; target?: string; json: string }
  | { t: 'done'; id: number; ms: number; mismatch?: string[]; error?: WorkerError }

/** A Worker, the worker's own global, or a fake of either. */
export interface WorkerPort {
  postMessage(m: unknown): void
  /** a MessageEvent's handler; `any`, so a DOM Worker under strict types is one */
  onmessage: ((e: any) => unknown) | null
  terminate?(): void
}

/** The facets of each stage as they end, @pcbjs/export's facetStream. */
export type FacetStream = (root: string, rel: string, dev: boolean, generatedAt: string, out: (f: FacetOut) => void) => (e: StageEvent) => void

export interface ServeOptions {
  stream: FacetStream
  /** default fetch */
  fetch?: (url: string) => Promise<Uint8Array>
  /** default import() */
  load?: (url: string) => Promise<Record<string, unknown>>
}

/** A facet's hash for the check against Node's: the router's own counts left out, as a warm compile and a cold one differ only there. */
export function checkHash(data: Record<string, unknown>): string {
  const r = data.routing as Record<string, unknown> | undefined
  return facetHash(r ? { ...data, routing: { ...r, cached: undefined, ripped: undefined, rounds: undefined } } : data)
}

/** `board/target/facet`, the target empty for a board without variants. */
export const facetKey = (board: string, target: string | undefined, facet: string): string => `${board}/${target ?? ''}/${facet}`

const fetchBytes = async (url: string): Promise<Uint8Array> => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}
const text = (b: Uint8Array) => new TextDecoder().decode(b)

/** Answers compile requests on `port`, one at a time; the self-check runs first and logs a mismatch. */
export function serveCompile(port: WorkerPort, o: ServeOptions): void {
  const get = o.fetch ?? fetchBytes
  const load = o.load ?? ((url: string) => import(/* @vite-ignore */ url))
  let flag: Int32Array | null = null
  setPlatform(memoryPlatform())
  // a realm whose Math is Node's already, a fake worker in Node, keeps it
  const native = mathKind()
  if (!native) installNodeMath('plain')
  const check = selfCheck(native ?? 'plain')
  if (!check.ok) console.warn(`pcbjs: the browser compile's self-check hashes ${check.hash}, Node's ${check.want}; this engine's results may differ from Node's`)
  port.postMessage({ t: 'ready', check } satisfies FromBrowserWorker)
  let queue = Promise.resolve()
  const projects = new Map<string, Realm>()
  port.onmessage = e => {
    const m = e.data as ToBrowserWorker
    if (m.t === 'init') flag = new Int32Array(m.flag)
    else if (m.t === 'compile')
      queue = queue.then(() => {
        if (!native) setMathKind(m.module.math ?? 'plain')
        return inRealm(realmOf(projects, m.module), () => compileOne(m, { get, load, stream: o.stream, port, flag: () => flag }))
      })
  }
}

/** The realm of a module's project: modules are evaluated once per worker, so their parts and bound routes must survive another project's compile. */
function realmOf(projects: Map<string, Realm>, mod: BrowserModule): Realm {
  const key = mod.project ?? mod.config ?? mod.module
  let r = projects.get(key)
  if (!r) projects.set(key, (r = newRealm()))
  return r
}

interface Ctx {
  get: (url: string) => Promise<Uint8Array>
  load: (url: string) => Promise<Record<string, unknown>>
  stream: FacetStream
  port: WorkerPort
  flag: () => Int32Array | null
}

async function compileOne(m: Extract<ToBrowserWorker, { t: 'compile' }>, c: Ctx): Promise<void> {
  const t0 = performance.now()
  const post = (msg: FromBrowserWorker) => c.port.postMessage(msg)
  const { id, module: mod } = m
  try {
    const [files, frame] = await Promise.all([loadFiles(mod, c.get), framesOf([...new Set([mod.config, mod.module, mod.patches, ...(mod.modules ?? [])])], c.get)])
    setPlatform(memoryPlatform({ files, cwd: mod.root, env: mod.env, frame }))
    seedMeshKeys(mod.meshes ?? {})
    // a fetched model is the file the cli fetched it to, when the module names it
    realm().remoteModel = (source: string) => {
      const file = `${mod.root}/.pcbjs/models/fetched/${fetchedRel(source)}`
      return platform().stat(file)?.file ? file : null
    }
    for (const [board, url] of Object.entries(mod.routes ?? {})) seedRoutes(board, text(await c.get(url)))
    const references = await resolverOf(mod, c.get)
    const user = ((mod.config ? (await c.load(mod.config)).default : undefined) ?? {}) as { plugins?: PcbPlugin[]; kicad?: unknown }
    realm().kicad = { root: mod.root, config: user.kicad ?? {} }
    const loader: ModuleLoader = { load: url => c.load(url), imported: () => new Set(Object.keys(mod.sources)) }
    const hashes: Record<string, string> = {}
    const stream = c.stream(mod.root, mod.entry, false, mod.generatedAt ?? new Date().toISOString(), f => {
      hashes[facetKey(f.board, f.target, f.facet)] = checkHash(f.data)
      post({ t: 'facet', id, f })
    })
    const flag = c.flag()
    // the evaluate stage: the module and its patches through the loader, the defaults it set read after
    const load = async () => {
      const { root, patches } = await evaluateEntry(loader, { file: mod.module, rel: mod.entry }, mod.patches ? { file: mod.patches, rel: patchesFile(mod.entry) } : null)
      return { root, options: { defaults: realm().defaults, ...(patches ? { patches } : {}) } }
    }
    const results = await compileLoaded(load, {
      files: loader.imported(mod.module),
      cache: { dir: null, entry: mod.entry, files: { ...mod.sources }, env: '' },
      references,
      plugins: user.plugins ?? [],
      ...(m.want ? { want: m.want } : {}),
      ...(flag
        ? {
            signal: {
              get aborted() {
                return Atomics.load(flag, 0) >= id
              },
            },
          }
        : {}),
      stage: e => {
        post({ t: 'stage', id, s: stageStatus(e) })
        stream(e)
      },
    })
    if (m.boards)
      for (const r of results) post({ t: 'board', id, board: r.board.name, ...(r.board.variant ? { target: r.board.variant.name } : {}), json: JSON.stringify(r.board) })
    const mismatch = Object.keys(mod.expect ?? {}).filter(k => k in hashes && hashes[k] !== mod.expect![k])
    if (mismatch.length) console.warn(`pcbjs: the browser compile of ${mod.entry} differs from Node's in ${mismatch.join(', ')}; showing the browser's`)
    post({ t: 'done', id, ms: Math.round(performance.now() - t0), ...(mismatch.length ? { mismatch } : {}) })
  } catch (e: any) {
    post({
      t: 'done',
      id,
      ms: Math.round(performance.now() - t0),
      error: { name: e?.name, message: String(e?.message ?? e), stack: e?.stack, ...(e?.name === 'CancelledError' ? { cancelled: true } : {}) },
    })
  }
}

async function loadFiles(mod: BrowserModule, get: Ctx['get']): Promise<Record<string, MemoryFile>> {
  const entries = await Promise.all(Object.entries(mod.files ?? {}).map(async ([f, url]) => [f, url === null ? null : await get(url)] as const))
  return Object.fromEntries(entries)
}

/** reference() resolved from the boards the module carries; any other entry is not available here. */
async function resolverOf(mod: BrowserModule, get: Ctx['get']): Promise<ReferenceResolver> {
  const boards = new Map<string, ReferencedBoard>()
  for (const [entry, url] of Object.entries(mod.references ?? {})) boards.set(entry, JSON.parse(text(await get(url))))
  return {
    resolve(file) {
      const b = boards.get(file)
      if (!b) throw new Error(`not available in the browser compile: ${file}`)
      return b
    },
  }
}

/** The mesh hashes of model files known by name only, put where the site data's export looks a hash up before it reads the file: its memo by path, size and mtime as the memory platform states them. */
function seedMeshKeys(meshes: Record<string, string>): void {
  const memo: Map<string, { size: number; mtime: number; key: string }> = ((globalThis as any)[Symbol.for('pcbjs.export.meshKeys')] ??= new Map())
  for (const [path, key] of Object.entries(meshes)) {
    const st = platform().stat(path)
    if (st?.file) memo.set(path, { size: st.size, mtime: st.mtime, key })
  }
}

/** Maps a stack frame of the given modules to its source through their source maps; null for any other frame. */
async function framesOf(urls: (string | undefined)[], get: Ctx['get']): Promise<(at: Position) => Position | null> {
  const maps = new Map<string, (line: number, col: number) => Position | null>()
  for (const url of urls) {
    if (!url) continue
    const code = text(await get(url))
    const ref = /\/\/# sourceMappingURL=(\S+)\s*$/.exec(code)?.[1]
    if (!ref) continue
    const at = new URL(ref, new URL(url, (globalThis as any).location?.href))
    const map: SourceMapV3 = JSON.parse(at.protocol === 'data:' ? atob(at.href.slice(at.href.indexOf(',') + 1)) : text(await get(at.href)))
    maps.set(new URL(url, (globalThis as any).location?.href).href, sourceMapper(map))
  }
  return at => maps.get(at.file)?.(at.line, at.col) ?? null
}

/** What a browser compile gave: every facet in the order it came, the final boards when asked, and the facets that differ from `expect`. */
export interface BrowserResult {
  ms: number
  facets: FacetOut[]
  boards: { board: string; target?: string; json: string }[]
  mismatch?: string[]
  check: SelfCheck
}

export interface BrowserCompileOptions {
  /** makes the page's compile worker, such as `() => new Worker(url, { type: 'module' })`; one lives per function */
  worker: () => WorkerPort
  want?: FacetName[]
  boards?: boolean
  facet?: (f: FacetOut) => void
  stage?: (s: StageStatus) => void
  /** a cancel ends the worker, or under crossOriginIsolated raises its shared flag; the next compile starts another */
  signal?: AbortSignal
}

interface Live {
  port: WorkerPort
  ready: Promise<SelfCheck>
  flag: Int32Array | null
  next: number
  jobs: Map<number, (m: FromBrowserWorker) => void>
}
const LIVE = new WeakMap<() => WorkerPort, Live>()

function live(make: () => WorkerPort): Live {
  const hit = LIVE.get(make)
  if (hit) return hit
  const port = make()
  const shared = (globalThis as any).crossOriginIsolated ? new SharedArrayBuffer(4) : null
  let ready!: (c: SelfCheck) => void
  const w: Live = { port, ready: new Promise(r => (ready = r)), flag: shared ? new Int32Array(shared) : null, next: 1, jobs: new Map() }
  port.onmessage = e => {
    const m = e.data as FromBrowserWorker
    if (m.t === 'ready') ready(m.check)
    else w.jobs.get(m.id)?.(m)
  }
  if (shared) port.postMessage({ t: 'init', flag: shared } satisfies ToBrowserWorker)
  LIVE.set(make, w)
  return w
}

/** Compiles a module in the page's compile worker, streaming facets and stages as they come. */
export async function compileInBrowser(module: BrowserModule, o: BrowserCompileOptions): Promise<BrowserResult> {
  const w = live(o.worker)
  const check = await w.ready
  const id = w.next++
  const out: BrowserResult = { ms: 0, facets: [], boards: [], check }
  return new Promise((resolve, reject) => {
    const cancel = () => {
      if (w.flag) return Atomics.store(w.flag, 0, id)
      w.port.terminate?.()
      LIVE.delete(o.worker)
      for (const done of w.jobs.values()) done({ t: 'done', id, ms: 0, error: { name: 'CancelledError', message: 'compile cancelled', cancelled: true } })
    }
    if (o.signal?.aborted) return reject(cancelled())
    o.signal?.addEventListener('abort', cancel, { once: true })
    w.jobs.set(id, m => {
      if (m.t === 'facet') {
        out.facets.push(m.f)
        o.facet?.(m.f)
      } else if (m.t === 'stage') o.stage?.(m.s)
      else if (m.t === 'board') out.boards.push({ board: m.board, ...(m.target !== undefined ? { target: m.target } : {}), json: m.json })
      else if (m.t === 'done') {
        w.jobs.delete(id)
        o.signal?.removeEventListener('abort', cancel)
        if (m.error) return reject(m.error.cancelled ? cancelled() : Object.assign(new Error(m.error.message), m.error))
        resolve({ ...out, ms: m.ms, ...(m.mismatch ? { mismatch: m.mismatch } : {}) })
      }
    })
    w.port.postMessage({ t: 'compile', id, module, ...(o.want ? { want: o.want } : {}), ...(o.boards ? { boards: true } : {}) } satisfies ToBrowserWorker)
  })
}

const cancelled = () => Object.assign(new Error('compile cancelled'), { name: 'CancelledError' })
