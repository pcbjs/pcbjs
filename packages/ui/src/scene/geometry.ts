// three.js geometries from the jobs of @pcbjs/export/scene/geometry, and the worker pool that runs them
import * as THREE from 'three'
import { jobSize, runJob, type GeoJob, type GeoResult } from '@pcbjs/export/internal/scene/geometry'

/** A BufferGeometry from a result, null for an empty one. */
export function toGeometry(r: GeoResult): THREE.BufferGeometry | null {
  if (!r.position) return null
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(r.position, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(r.normal!, 3))
  for (let i = 0; i < r.groups.length; i += 3) g.addGroup(r.groups[i], r.groups[i + 1], r.groups[i + 2])
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(r.sphere[0], r.sphere[1], r.sphere[2]), r.sphere[3])
  return g
}

type Slot = { w: Worker; load: number }

/** Batches go to the worker with the least work queued, so pours run side by side; here when no worker starts. */
export class GeometryPool {
  private slots: Slot[] = []
  private failed = false
  private next = 0
  private waiting = new Map<number, { slot: Slot; load: number; done: (r: GeoResult[]) => void }>()
  private spawn: () => Worker
  private size: number
  /** per batch, for the dev stats: jobs, points and the ms the worker spent */
  readonly log: { jobs: number; points: number; ms: number }[] = []
  constructor(spawn: () => Worker, size = 3) {
    this.spawn = spawn
    this.size = size
  }

  private slot(): Slot | null {
    if (this.failed) return null
    if (this.slots.length < this.size && !this.slots.some(s => s.load === 0)) {
      try {
        const w = this.spawn()
        const slot: Slot = { w, load: 0 }
        w.onmessage = (e: MessageEvent<{ id: number; results: GeoResult[]; ms: number }>) => {
          const p = this.waiting.get(e.data.id)
          if (!p) return
          this.waiting.delete(e.data.id)
          p.slot.load -= p.load
          this.log.push({ jobs: e.data.results.length, points: p.load, ms: Math.round(e.data.ms) })
          p.done(e.data.results)
        }
        w.onerror = e => {
          console.warn('3D view: a geometry worker failed, building on the main thread', e.message)
          this.fail()
        }
        this.slots.push(slot)
      } catch {
        if (!this.slots.length) {
          this.failed = true
          return null
        }
      }
    }
    return this.slots.reduce((a, b) => (b.load < a.load ? b : a))
  }
  private fail() {
    this.failed = true
    for (const s of this.slots) s.w.terminate()
    this.slots = []
    // the batches in flight are lost with the workers: their callers build them on the main thread
    const lost = [...this.waiting.values()]
    this.waiting.clear()
    for (const p of lost) p.done([])
  }

  /** Run the jobs; the promise has a result per job in order, built off the main thread when it can be. */
  run(jobs: GeoJob[]): Promise<GeoResult[]> {
    const slot = this.slot()
    if (!slot) return Promise.resolve(jobs.map(runJob))
    const id = this.next++
    const load = jobs.reduce((n, j) => n + jobSize(j), 0) + 1
    slot.load += load
    return new Promise<GeoResult[]>(resolve => {
      this.waiting.set(id, { slot, load, done: r => resolve(r.length === jobs.length ? r : jobs.map(runJob)) })
      // copied, not transferred, so the jobs can still run here if the worker dies
      slot.w.postMessage({ id, jobs })
    })
  }

  dispose() {
    for (const s of this.slots) s.w.terminate()
    this.slots = []
    this.waiting.clear()
  }
}
