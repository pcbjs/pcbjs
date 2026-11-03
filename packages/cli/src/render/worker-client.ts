// The session's renderer worker: one thread holding the loaded WASM and the current scene, uploaded once per snapshot and board.
// A shot for a newer snapshot of a project terminates one for an older; a trap or an exit kills only the thread, which is
// restarted with the cached scene and the shot tried once more; the thread is recycled as its memory grows.
import { Worker } from 'node:worker_threads'
import type { ErrorRecord, RenderOptions, SelectionGeometry } from '@pcbjs/renderer'
import type { FrameRequest } from './scene3d.js'
import { parseSnapshot } from '@pcbjs/core/protocol'

type Message =
  { method: 'load'; key: string; glb: Uint8Array; selection: SelectionGeometry[] } | { method: 'shot'; key: string; frame: FrameRequest | null; options: RenderOptions }
export type ToRuntime = Message & { id: number }

export interface Scene {
  /** snapshot, board and target */
  key: string
  project: string
  snapshot: string
  glb: Uint8Array
  selection: SelectionGeometry[]
}

export interface Image {
  rgba: Uint8Array
  width: number
  height: number
}

export interface Limits {
  /** shots waiting or running before another is refused */
  queue: number
  /** ms one shot may take, its scene's upload included */
  timeout: number
  /** scenes a thread uploads before it is replaced: WASM memory never shrinks and a replace holds two scenes at its peak */
  scenes: number
  /** bytes the process may grow past its size when the thread started before the thread is replaced */
  growth: number
}

/** Measured on usb3-hub, the largest example: about 200 MB per scene at the peak of a replace, 1 to 3 s per shot at quality 4. */
export const LIMITS: Limits = { queue: 8, timeout: 60_000, scenes: 16, growth: 1.5 * 2 ** 30 }

/** Why a shot failed besides the renderer's own codes. */
export type Reason = 'CANCELLED' | 'TIMEOUT' | 'QUEUE_FULL' | 'WORKER_EXIT' | 'CLOSED'

export class RenderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recoverable = true,
  ) {
    super(message)
  }
}

const fromRecord = (e: ErrorRecord): RenderError => Object.assign(new RenderError(e.code, e.message, e.recoverable), e.path ? { path: e.path } : {})

/** One worker thread and its pending calls; a kill rejects them with its reason. */
class Thread {
  readonly worker: Worker
  readonly born = process.memoryUsage().rss
  key: string | null = null
  loads = 0
  private pending = new Map<number, { ok(v: unknown): void; fail(e: unknown): void }>()
  private seq = 0
  private dead: RenderError | null = null

  constructor(url: URL) {
    this.worker = new Worker(url)
    this.worker.on('message', (m: { id: number; result?: unknown; error?: ErrorRecord }) => {
      const p = this.pending.get(m.id)
      if (!p) return
      this.pending.delete(m.id)
      if (m.error) p.fail(fromRecord(m.error))
      else p.ok(m.result)
    })
    this.worker.on('error', e => this.end(new RenderError('WORKER_EXIT', `the renderer worker failed: ${String(e?.message ?? e).split('\n')[0]}`)))
    this.worker.on('exit', code => this.end(new RenderError('WORKER_EXIT', `the renderer worker exited with code ${code}`)))
  }

  call<T>(m: Message): Promise<T> {
    if (this.dead) return Promise.reject(this.dead)
    const id = ++this.seq
    return new Promise<T>((ok, fail) => {
      this.pending.set(id, { ok: ok as (v: unknown) => void, fail })
      this.worker.postMessage({ ...m, id })
    })
  }

  get alive(): boolean {
    return !this.dead
  }

  private end(e: RenderError): void {
    this.dead ??= e
    for (const p of this.pending.values()) p.fail(this.dead)
    this.pending.clear()
  }

  kill(code: Reason, message: string): Promise<number> {
    this.end(new RenderError(code, message))
    return this.worker.terminate()
  }
}

interface Job {
  scene: Scene
  frame: FrameRequest | null
  options: RenderOptions
  ok(v: Image): void
  fail(e: unknown): void
}

const retried = (e: unknown) => e instanceof RenderError && (e.code === 'WASM_TRAP' || e.code === 'WORKER_EXIT')

/** A shot of `b` supersedes one of `a`: the same project, a later snapshot. */
function newer(a: Scene, b: Scene): boolean {
  if (a.project !== b.project || a.snapshot === b.snapshot) return false
  const na = parseSnapshot(a.snapshot)?.run ?? -1,
    nb = parseSnapshot(b.snapshot)?.run ?? -1
  return na < 0 || nb < 0 || nb > na
}

export interface WorkerOptions {
  /** the runtime, worker.js by default; tests give one that traps or exits */
  url?: URL
  limits?: Partial<Limits>
  log?(line: string): void
}

export class RenderWorker {
  readonly limits: Limits
  /** for the tests and the session log */
  readonly stats = { spawned: 0, retried: 0, cancelled: 0, recycled: 0 }
  private thread: Thread | null = null
  private queue: Job[] = []
  private running: Job | null = null
  private closed = false
  private url: URL
  private log: (line: string) => void

  constructor(o: WorkerOptions = {}) {
    this.url = o.url ?? new URL('./worker.js', import.meta.url)
    this.limits = { ...LIMITS, ...o.limits }
    this.log = o.log ?? (() => {})
  }

  /** The image of one shot of a scene; rejects with a RenderError whose code says why. */
  shot(scene: Scene, frame: FrameRequest | null, options: RenderOptions): Promise<Image> {
    if (this.closed) return Promise.reject(new RenderError('CLOSED', 'the renderer worker is closed'))
    this.supersede(scene)
    if (this.queue.length + (this.running ? 1 : 0) >= this.limits.queue)
      return Promise.reject(new RenderError('QUEUE_FULL', `${this.limits.queue} shots are already waiting; try again when one is done`))
    return new Promise<Image>((ok, fail) => {
      this.queue.push({ scene, frame, options, ok, fail })
      void this.pump()
    })
  }

  /** Every queued shot of an older snapshot of the project fails as cancelled, and a running one is terminated. */
  private supersede(scene: Scene): void {
    const old = this.queue.filter(j => newer(j.scene, scene))
    this.queue = this.queue.filter(j => !old.includes(j))
    for (const j of old) j.fail(new RenderError('CANCELLED', `snapshot ${scene.snapshot} superseded ${j.scene.snapshot}`))
    this.stats.cancelled += old.length
    if (this.running && newer(this.running.scene, scene) && this.thread) {
      this.stats.cancelled++
      void this.thread.kill('CANCELLED', `snapshot ${scene.snapshot} superseded ${this.running.scene.snapshot}`)
      this.thread = null
    }
  }

  private async pump(): Promise<void> {
    if (this.running || !this.queue.length) return
    const job = (this.running = this.queue.shift()!)
    try {
      job.ok(await this.attempt(job).catch(e => (retried(e) && !this.closed ? this.retry(job, e) : Promise.reject(e))))
    } catch (e) {
      job.fail(e)
    } finally {
      this.running = null
      this.recycle()
      void this.pump()
    }
  }

  private retry(job: Job, e: RenderError): Promise<Image> {
    this.stats.retried++
    this.log(`[pcbjs] ${e.message}; restarting the renderer worker and trying the shot once more`)
    void this.thread?.kill('WORKER_EXIT', e.message)
    this.thread = null
    return this.attempt(job)
  }

  private async attempt(job: Job): Promise<Image> {
    const t = this.spawn()
    const timer = setTimeout(() => {
      void t.kill('TIMEOUT', `the shot took longer than ${this.limits.timeout / 1000} s`)
      if (this.thread === t) this.thread = null
    }, this.limits.timeout)
    try {
      if (t.key !== job.scene.key) {
        t.key = null
        await t.call({ method: 'load', key: job.scene.key, glb: job.scene.glb, selection: job.scene.selection })
        t.key = job.scene.key
        t.loads++
      }
      return await t.call<Image>({ method: 'shot', key: job.scene.key, frame: job.frame, options: job.options })
    } finally {
      clearTimeout(timer)
    }
  }

  private spawn(): Thread {
    if (this.thread?.alive) return this.thread
    this.stats.spawned++
    return (this.thread = new Thread(this.url))
  }

  /** A thread past its scene count or memory growth goes; the next shot starts a fresh one. */
  private recycle(): void {
    const t = this.thread
    if (!t || this.running) return
    if (t.loads < this.limits.scenes && process.memoryUsage().rss - t.born < this.limits.growth) return
    this.stats.recycled++
    void t.kill('CLOSED', 'recycled')
    this.thread = null
  }

  async close(): Promise<void> {
    this.closed = true
    for (const j of this.queue) j.fail(new RenderError('CLOSED', 'the renderer worker is closed'))
    this.queue = []
    await this.thread?.kill('CLOSED', 'the renderer worker is closed')
    this.thread = null
  }
}
