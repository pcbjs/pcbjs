// The session's compile of one project in a worker thread, worker.ts: an edit cancels it within one unit through shared memory, the
// session answers queries while it runs, and a crashed thread is restarted once with its compiles sent again.
import { deserialize } from 'node:v8'
import { Worker } from 'node:worker_threads'
import type { RouteProgress } from '@pcbjs/compile'
import type { Entry } from '../project/config.js'
import type { ModuleLookup } from '../project/boards.js'
import type { BoardOut, Compiled, Library, Preview, Sketch, SketchJob } from '../project/project.js'
import type { Artifact, CompileJob, Compiler, DraftCode, Held } from '../project/compiler.js'
import type { View } from '@pcbjs/core/internal/plugin'
import type { FacetName } from '@pcbjs/core/site-facets'
import type { SiteData } from '@pcbjs/core/site-data'
import type { Board } from '@pcbjs/core/model'
import type { FacetOut, StageStatus } from '../project/facets.js'

export interface WorkerData {
  root: string
  configFile: string
  /** the command line's entries, which win over the config's */
  entries: string[]
  /** an Int32Array's buffer: every compile id up to its first value is cancelled, every keystroke tier id up to its second */
  flag: SharedArrayBuffer
}

/** A file and the files it imports. */
export type Edge = [string, string[]]

/** One target of a finished compile as it crosses: `board` serialized with its dependency graph, null like `site` when the last answer for the target carried the same. */
export interface Crossed extends Omit<BoardOut, 'board' | 'site'> {
  name: string
  target: string | null
  board: Uint8Array | null
  site: SiteData | null
  hashes: Partial<Record<FacetName, string>>
}

export type ToWorker =
  | { t: 'compile'; id: number; entry: Entry; draft: boolean; dev?: boolean; formats?: readonly string[]; want?: View[] }
  | { t: 'layout'; id: number; entry: Entry; board: string; target: string | null; ref: string }
  | { t: 'preview'; id: number; file: string; rel: string }
  | ({ t: 'sketch'; id: number; entry: Entry } & Omit<SketchJob, 'signal'>)
  | { t: 'draft'; file: string; code: string | null; limit: number | null }
  | { t: 'changed'; files: string[] }
  | { t: 'artifact'; id: number; run: number; board: string; target: string | null; kind: Artifact }

export type FromWorker =
  | { t: 'ready' }
  | { t: 'failed'; error: WorkerError }
  | { t: 'log'; line: string }
  | { t: 'progress'; id: number; p: RouteProgress }
  | { t: 'facet'; id: number; f: FacetOut }
  | { t: 'stage'; id: number; s: StageStatus }
  | { t: 'done'; id: number; value?: unknown; error?: WorkerError; cancelled?: boolean; graph?: Edge[] }

export interface WorkerError {
  name?: string
  message: string
  stack?: string
  loc?: unknown
  frame?: unknown
  code?: unknown
}

interface Job {
  msg: Extract<ToWorker, { id: number }>
  ok(v: unknown): void
  fail(e: unknown): void
  progress?: (p: RouteProgress) => void
  facet?: (f: FacetOut) => void
  stage?: (s: StageStatus) => void
}

interface Node {
  file: string
  importers: Set<Node>
  imports: Set<Node>
}

/** The worker's module graph as the dev plugin reads Vite's: nodes by file with their importers. */
export function mirrorGraph(edges: Edge[]): ModuleLookup & { imported(file: string): Set<string> } {
  const nodes = new Map<string, Node>()
  const node = (file: string) => {
    let n = nodes.get(file)
    if (!n) nodes.set(file, (n = { file, importers: new Set(), imports: new Set() }))
    return n
  }
  for (const [file, to] of edges) {
    const n = node(file)
    for (const t of to) {
      const d = node(t)
      n.imports.add(d)
      d.importers.add(n)
    }
  }
  return {
    getModulesByFile: file => (nodes.has(file) ? [nodes.get(file)!] : undefined),
    imported(file) {
      const seen = new Set<string>([file])
      const stack = nodes.has(file) ? [nodes.get(file)!] : []
      while (stack.length)
        for (const d of stack.pop()!.imports)
          if (!seen.has(d.file)) {
            seen.add(d.file)
            stack.push(d)
          }
      return seen
    },
  }
}

/** The dependency graph put back on the board, as the thread had it. */
function withDeps(board: Board, deps: unknown): Board {
  if (deps) Object.defineProperty(board, 'deps', { value: deps, enumerable: false, writable: true, configurable: true })
  return board
}

/** A compile of some views only, which crosses whole and is never the base of a later answer. */
const partialOf = (run: number, { deps, board, ...rest }: BoardOut & { deps?: unknown }): Held => ({ ...rest, board: withDeps(board, deps), run, hashes: {} })

/** The last board and site that crossed per entry and target, which an answer leaves out when they are the same. */
function crossings() {
  const last = new Map<string, { board: Board; site: SiteData }>()
  return (run: number, entry: Entry, c: Crossed): Held => {
    const { name, target, board: bytes, site: sent, hashes, ...rest } = c
    const key = `${entry.file}|${name}|${target ?? ''}`
    const was = last.get(key)
    const board = bytes ? thaw(bytes) : was?.board
    const site = sent ?? was?.site
    if (!board || !site) throw new Error(`the compile thread left out the ${!board ? 'board' : 'site'} of ${name}, which it never sent`)
    last.set(key, { board, site })
    // a copy, so a draft or stale mark on it stays out of the next answer
    return { ...rest, entry, board, site: { ...site }, run, hashes: { ...hashes } }
  }
}

const thaw = (bytes: Uint8Array): Board => {
  const { board, deps } = deserialize(bytes) as { board: Board; deps: unknown }
  return withDeps(board, deps)
}

/** Artifacts fetched lately, so a second shot of one GLB reads the scene it already parsed. */
const ARTIFACTS = 8

/** An error from the thread as the plugin reports one, a CancelledError named as such. */
const asError = (e: WorkerError): Error => Object.assign(new Error(e.message), e)

export interface WorkerOptions {
  root: string
  configFile: string
  entries?: string[]
  log(line: string): void
}

export function workerCompiler(o: WorkerOptions): Compiler {
  const flag = new SharedArrayBuffer(8)
  const cancelled = new Int32Array(flag)
  const jobs = new Map<number, Job>()
  const drafts = new Map<string, ToWorker>()
  let graph = mirrorGraph([])
  const crossed = crossings()
  const artifacts = new Map<string, Promise<unknown>>()
  let seq = 0
  let worker: Worker | null = null
  let closing = false
  // set by a crash, cleared by the next answer: a second crash in a row fails the compiles
  let restarted = false

  const spawn = () => {
    const w = new Worker(new URL('./worker.js', import.meta.url), { workerData: { root: o.root, configFile: o.configFile, entries: o.entries ?? [], flag } satisfies WorkerData })
    w.unref()
    w.on('message', (m: FromWorker) => receive(m))
    w.on('error', e => o.log(`the compile thread of ${o.root} failed: ${String(e?.message ?? e).split('\n')[0]}`))
    w.on('exit', code => exited(w, code))
    for (const d of drafts.values()) w.postMessage(d)
    worker = w
    return w
  }
  const thread = () => worker ?? spawn()

  const receive = (m: FromWorker) => {
    if (m.t === 'log') return o.log(m.line)
    if (m.t === 'failed') return o.log(`the compile thread of ${o.root} could not load its config: ${m.error.message.split('\n')[0]}`)
    if (m.t === 'progress') return jobs.get(m.id)?.progress?.(m.p)
    // a cancelled compile's facets stop here, whatever the thread sent before it saw the flag
    if (m.t === 'facet') return m.id > Atomics.load(cancelled, 0) ? jobs.get(m.id)?.facet?.(m.f) : undefined
    if (m.t === 'stage') return jobs.get(m.id)?.stage?.(m.s)
    if (m.t !== 'done') return
    const job = jobs.get(m.id)
    if (!job) return
    jobs.delete(m.id)
    restarted = false
    if (m.graph) graph = mirrorGraph(m.graph)
    if (m.error) job.fail(asError(m.error))
    else job.ok(m.value)
  }

  const exited = (w: Worker, code: number) => {
    if (worker === w) worker = null
    if (closing || !jobs.size) return
    if (restarted) {
      for (const j of jobs.values()) j.fail(new Error(`the compile thread of ${o.root} exited with code ${code} twice in a row`))
      jobs.clear()
      restarted = false
      return
    }
    restarted = true
    o.log(`the compile thread of ${o.root} exited with code ${code}; restarting it and compiling again`)
    const next = spawn()
    for (const j of [...jobs.values()].sort((a, b) => a.msg.id - b.msg.id)) next.postMessage(j.msg)
  }

  const ask = <T>(msg: Job['msg'], on: Pick<Job, 'progress' | 'facet' | 'stage'> = {}) =>
    new Promise<T>((ok, fail) => {
      jobs.set(msg.id, { msg, ok: ok as (v: unknown) => void, fail, ...on })
      thread().postMessage(msg)
    })

  return {
    compile(entry: Entry, job: CompileJob) {
      const run = ++seq
      return ask<(Crossed | (BoardOut & { deps?: unknown }))[]>(
        {
          t: 'compile',
          id: run,
          entry: { file: entry.file, rel: entry.rel },
          draft: job.draft,
          ...(job.dev === false ? { dev: false } : {}),
          ...(job.formats ? { formats: job.formats } : {}),
          ...(job.want ? { want: job.want } : {}),
        },
        { progress: job.progress, facet: job.facet, stage: job.stage },
      ).then(out => out.map(c => ('partial' in c && c.partial ? partialOf(run, c as BoardOut) : crossed(run, entry, c as Crossed))))
    },
    artifact<K extends Artifact>(run: number, board: string, target: string | null, kind: K): Promise<Compiled[K]> {
      const key = `${run}|${board}|${target ?? ''}|${kind}`
      let p = artifacts.get(key)
      if (!p) {
        p = ask({ t: 'artifact', id: ++seq, run, board, target, kind })
        p.catch(() => artifacts.delete(key))
        artifacts.set(key, p)
        for (const k of artifacts.keys()) if (artifacts.size > ARTIFACTS) artifacts.delete(k)
      }
      return p as Promise<Compiled[K]>
    },
    sketch: (entry, job) => ask<Sketch | null>({ t: 'sketch', id: ++seq, entry: { file: entry.file, rel: entry.rel }, ...job }),
    layout: (entry, board, target, ref) =>
      ask<{ site: SiteData; board: Uint8Array }>({ t: 'layout', id: ++seq, entry, board, target, ref }).then(v => ({ site: v.site, board: deserialize(v.board) as Board })),
    preview: (file, rel) => ask<Preview | null>({ t: 'preview', id: ++seq, file, rel }),
    graph: () => graph,
    imported: file => graph.imported(file),
    changed(files) {
      if (files.length) worker?.postMessage({ t: 'changed', files } satisfies ToWorker)
    },
    draft(file, d: DraftCode | null) {
      const msg: ToWorker = { t: 'draft', file, code: d?.code ?? null, limit: d?.limit ?? null }
      if (d) drafts.set(file, msg)
      else drafts.delete(file)
      worker?.postMessage(msg)
    },
    cancel() {
      Atomics.store(cancelled, 0, seq)
    },
    cancelSketch() {
      Atomics.store(cancelled, 1, seq)
    },
    async close() {
      closing = true
      for (const j of jobs.values()) j.fail(new Error('the session is closing'))
      jobs.clear()
      await worker?.terminate()
      worker = null
    },
  }
}
