// The renderer worker, on the pattern of @pcbjs/renderer's examples: one scene in WASM keyed by its snapshot, replaced whole,
// each shot framed here so the bounds query and the render are one message. worker-client.ts is the other side.
import { parentPort } from 'node:worker_threads'
import { createRenderer, serializeError, type Bounds, type Renderer } from '@pcbjs/renderer'
import type { FrameRequest } from './scene3d.js'
import type { ToRuntime } from './worker-client.js'

let scene: { key: string; renderer: Renderer } | null = null
const port = parentPort!

function union(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a || !b) return a ?? b
  return { min: [0, 1, 2].map(i => Math.min(a.min[i], b.min[i])) as Bounds['min'], max: [0, 1, 2].map(i => Math.max(a.max[i], b.max[i])) as Bounds['max'] }
}

/** The fit camera on the union of the frame's bounds, grown by its margin; the whole visible board when it names nothing visible. */
function framed(r: Renderer, f: FrameRequest, o: Parameters<Renderer['render']>[0]) {
  const q = { visibility: o.visibility, nodeTranslations: o.nodeTranslations }
  let b = f.bounds
  if (f.nodes.length) b = union(b, r.bounds({ ...q, nodes: f.nodes }))
  if (f.selections.length) b = union(b, r.bounds({ ...q, selections: f.selections }))
  if (!b) return { ...f.camera, margin: 1.04 }
  const m = f.margin
  return { ...f.camera, bounds: { min: b.min.map(v => v - m) as Bounds['min'], max: b.max.map(v => v + m) as Bounds['max'] } }
}

async function handle(m: ToRuntime): Promise<{ result: unknown; transfer: ArrayBuffer[] }> {
  if (m.method === 'load') {
    const next = await createRenderer(m.glb, { selectionGeometry: m.selection })
    scene?.renderer.dispose()
    scene = { key: m.key, renderer: next }
    return { result: { key: m.key, triangles: next.triangles }, transfer: [] }
  }
  if (!scene || scene.key !== m.key) throw Object.assign(new Error(`render: scene ${m.key} is not loaded`), { code: 'DISPOSED' })
  const o = m.frame ? { ...m.options, camera: framed(scene.renderer, m.frame, m.options) } : m.options
  const r = await scene.renderer.render(o)
  return { result: { rgba: r.rgba, width: r.width, height: r.height }, transfer: [r.rgba.buffer as ArrayBuffer] }
}

let queue = Promise.resolve()
port.on('message', (m: ToRuntime) => {
  queue = queue.then(async () => {
    try {
      const { result, transfer } = await handle(m)
      port.postMessage({ id: m.id, result }, transfer)
    } catch (e) {
      port.postMessage({ id: m.id, error: serializeError(e) })
    }
  })
})
