// One project's compile thread in a session: its own config, globals and Vite SSR, fed drafts and changed files by the session,
// cancelled through a shared flag the stage graph reads between units. worker-client.ts is the other side.
import { createHash } from 'node:crypto'
import { serialize } from 'node:v8'
import { parentPort, workerData } from 'node:worker_threads'
import { createServer, type ViteDevServer } from 'vite'
import { configFrom, loadUserConfig, type Entry, type ResolvedConfig } from '../project/config.js'
import { compileConfig } from '../project/vite-base.js'
import { quietLogger } from '../project/compile.js'
import { compileEntry, compileLayout, compilePreview, DATA_FORMATS, glbOf, schOf, sketchEntry, svgOf, type Compiled } from '../project/project.js'
import { evaluation, viteLoader } from '../project/loader.js'
import type { WorkerData, ToWorker, FromWorker, Edge, Crossed } from './worker-client.js'
import type { Artifact } from '../project/compiler.js'
import type { View } from '@pcbjs/core/internal/plugin'
import { FACET_NAMES, facetHash, splitSite, type FacetName } from '@pcbjs/core/site-facets'
import type { SiteData } from '@pcbjs/core/site-data'

const data = workerData as WorkerData
// one request at a time: the module load hook may read the evaluation's cancel and the keystroke tier's code
evaluation.serial = true
const flag = new Int32Array(data.flag)
// the session's drafts as this thread has them, the code each file evaluates as
const drafts = new Map<string, { code: string; limit: number | null }>()
const post = (m: FromWorker, transfer: ArrayBuffer[] = []) => parentPort!.postMessage(m, transfer)

/** As the dev server compiles, JSX with its source, without HTTP, HMR or a watcher: the session's watcher sends what changed. */
async function server(cfg: ResolvedConfig): Promise<ViteDevServer> {
  const vc = compileConfig(cfg, drafts)
  return createServer({
    ...vc,
    logLevel: 'silent',
    customLogger: quietLogger('silent'),
    esbuild: { ...vc.esbuild, jsxDev: true },
    server: { ...vc.server, middlewareMode: true, ws: false, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
    mode: 'development',
  })
}

const booted = (async () => {
  const cfg = configFrom(await loadUserConfig('serve', data.configFile || undefined, data.root), data.entries, () => {})
  return { cfg, vite: await server(cfg) }
})()

const invalidate = (vite: ViteDevServer, file: string) => {
  const g = vite.environments.ssr.moduleGraph
  for (const m of g.getModulesByFile(file) ?? []) g.invalidateModule(m)
}

function edges(vite: ViteDevServer): Edge[] {
  const out: Edge[] = []
  for (const [file, mods] of vite.environments.ssr.moduleGraph.fileToModulesMap) {
    const to = new Set<string>()
    for (const m of mods) for (const d of m.importedModules) if (d.file) to.add(d.file)
    out.push([file, [...to]])
  }
  return out
}

// the graph as last sent: an answer carries it only when it moved
let sentGraph = ''
function graphOf(vite: ViteDevServer | null): Edge[] | undefined {
  if (!vite) return undefined
  const g = edges(vite)
  const key = JSON.stringify(g)
  if (key === sentGraph) return undefined
  sentGraph = key
  return g
}

/** What survives postMessage of an error: the fields errorText reads. */
const errorOf = (e: any) => ({ name: e?.name, message: String(e?.message ?? e), stack: e?.stack, loc: e?.loc, frame: e?.frame, code: e?.code })

/** What a request answers: its value, the buffers it hands over, and what to note once it was sent. */
interface Reply {
  value: unknown
  transfer?: ArrayBuffer[]
  sent?: () => void
}

/** One request answered with its value or error and the module graph when it moved. */
async function answer(id: number, fn: (cfg: ResolvedConfig, vite: ViteDevServer) => Promise<Reply>): Promise<void> {
  let vite: ViteDevServer | null = null
  try {
    const b = await booted
    vite = b.vite
    const r = await fn(b.cfg, b.vite)
    if (done({ t: 'done', id, value: r.value, graph: graphOf(vite) }, r.transfer)) r.sent?.()
  } catch (e: any) {
    done({ t: 'done', id, error: errorOf(e), cancelled: e?.name === 'CancelledError', graph: graphOf(vite) })
  }
}

const reply = async (v: Promise<unknown>): Promise<Reply> => ({ value: await v })

/** The buffer of its own a transfer needs: a serialized value may be a view into a larger one. */
const owned = (b: Uint8Array): Uint8Array => (b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b : b.slice())

const hashesOf = (site: SiteData): Partial<Record<FacetName, string>> => Object.fromEntries(Object.entries(splitSite(site)).map(([f, d]) => [f, facetHash(d)]))

// the last runs of each entry, newest last: their GLB, fab set and drawings are made from them as `artifact` asks
const KEPT = 2
const runs = new Map<string, number[]>()
const kept = new Map<number, Map<string, Compiled>>()
const targetKey = (board: string, target: string | null) => `${board}|${target ?? ''}`

function keep(run: number, entry: string, out: Compiled[]): void {
  kept.set(run, new Map(out.map(c => [targetKey(c.board.name, c.board.variant?.name ?? null), c])))
  const list = [...(runs.get(entry) ?? []), run]
  while (list.length > KEPT) kept.delete(list.shift()!)
  runs.set(entry, list)
}

// what the last answer for each entry and target carried: the digest of its board and its facet hashes
const sent = new Map<string, { board: string; hashes: Partial<Record<FacetName, string>> }>()

/** A finished compile as it crosses: the board serialized, and the board and site left out when the last answer for the target carried the same. */
function cross(entry: Entry, out: Compiled[]): Reply {
  const notes: [string, { board: string; hashes: Partial<Record<FacetName, string>> }][] = []
  const value = out.map(({ glb: _g, fab: _f, svg: _s, sch: _c, board, site, ...rest }): Crossed => {
    const target = board.variant?.name ?? null
    const key = `${entry.file}|${targetKey(board.name, target)}`
    const bytes = owned(serialize({ board, deps: board.deps }))
    const digest = createHash('sha1').update(bytes).digest('hex')
    const hashes = hashesOf(site)
    const was = sent.get(key)
    notes.push([key, { board: digest, hashes }])
    const same = !!was && FACET_NAMES.every(f => was.hashes[f] === hashes[f])
    return { ...rest, name: board.name, target, board: was?.board === digest ? null : bytes, site: same ? null : site, hashes }
  })
  return {
    value,
    transfer: value.flatMap(c => (c.board ? [c.board.buffer as ArrayBuffer] : [])),
    sent: () => notes.forEach(([k, n]) => sent.set(k, n)),
  }
}

// every request up to the flag's value is cancelled: the first for compiles, the second for keystroke tiers
const signalOf = (id: number, at = 0) => ({
  get aborted() {
    return Atomics.load(flag, at) >= id
  },
})

function compile(id: number, entry: Entry, draft: boolean, dev: boolean, formats?: readonly string[], want?: View[]): Promise<void> {
  const signal = signalOf(id)
  return answer(id, async (cfg, vite) => {
    const out = await compileEntry(viteLoader(vite), cfg, entry, {
      dev,
      // the session builds the fab set and the site data; the rest is made when `artifact` asks
      formats: formats ?? DATA_FORMATS,
      draft,
      signal,
      want,
      progress: p => post({ t: 'progress', id, p }),
      facet: f => post({ t: 'facet', id, f }),
      stage: s => post({ t: 'stage', id, s }),
    })
    // the dependency graph is not enumerable, so a message would drop it
    if (out[0]?.partial) return { value: out.map(c => ({ ...c, deps: c.board.deps })) }
    keep(id, entry.file, out)
    return cross(entry, out)
  })
}

/** A result that cannot be cloned is a failed compile, never a dead thread; false then. */
function done(m: FromWorker, transfer?: ArrayBuffer[]): boolean {
  try {
    post(m, transfer)
    return true
  } catch (e: any) {
    post({ t: 'done', id: (m as { id: number }).id, error: errorOf(e) })
    return false
  }
}

// a session compiles the fab set and the site data only, see DATA_FORMATS
function madeOf<K extends Artifact>(c: Compiled, kind: K, root: string): Compiled[K] {
  if (kind === 'glb') return glbOf(c, root) as Compiled[K]
  if (kind === 'svg') return svgOf(c) as Compiled[K]
  if (kind === 'sch') return schOf(c) as Compiled[K]
  return c[kind]
}

/** An artifact of a run still kept, made on first ask when its compile did not build it; a GLB goes as a copy in the transfer list, so the thread keeps its own. */
async function artifact(m: Extract<ToWorker, { t: 'artifact' }>): Promise<void> {
  const c = kept.get(m.run)?.get(targetKey(m.board, m.target))
  if (!c) return void done({ t: 'done', id: m.id, error: { message: `no ${m.kind} of ${m.board} in run ${m.run}: a later compile replaced it` } })
  const { cfg } = await booted
  const v = madeOf(c, m.kind, cfg.root)
  const glb = v instanceof Uint8Array ? v.slice() : null
  done({ t: 'done', id: m.id, value: glb ?? v }, glb ? [glb.buffer] : [])
}

async function handle(m: ToWorker): Promise<void> {
  if (m.t === 'compile') return compile(m.id, m.entry, m.draft, m.dev ?? true, m.formats, m.want)
  if (m.t === 'layout') return answer(m.id, (cfg, vite) => reply(compileLayout(viteLoader(vite), cfg, m.entry, m.board, m.target, m.ref).then(v => ({ site: v.site, board: serialize(v.board) }))))
  if (m.t === 'preview') return answer(m.id, (cfg, vite) => reply(compilePreview(viteLoader(vite), cfg, m.file, m.rel)))
  if (m.t === 'sketch') {
    const { t: _t, id, entry, ...job } = m
    return answer(id, (cfg, vite) => reply(sketchEntry(viteLoader(vite, { file: job.file, code: job.code }), cfg, entry, { ...job, signal: signalOf(id, 1) })))
  }
  const { vite } = await booted
  if (m.t === 'draft') {
    if (m.code === null) drafts.delete(m.file)
    else drafts.set(m.file, { code: m.code, limit: m.limit })
    invalidate(vite, m.file)
  } else if (m.t === 'changed') for (const f of m.files) invalidate(vite, f)
}

// one at a time, so a compile sees the drafts and files as they were when it started
let queue: Promise<void> = Promise.resolve()
parentPort!.on('message', (m: ToWorker) => {
  // an artifact is read from what is kept, never behind a compile
  if (m.t === 'artifact') return artifact(m)
  queue = queue.then(() => handle(m)).catch(e => post({ t: 'log', line: `compile thread: ${String(e?.message ?? e)}` }))
})
booted.then(
  () => post({ t: 'ready' }),
  e => post({ t: 'failed', error: errorOf(e) }),
)
