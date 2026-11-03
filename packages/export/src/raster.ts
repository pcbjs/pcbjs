// SVG to PNG through sharp in a child process, so a synchronous exporter can rasterise
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const CHILD = fileURLToPath(new URL('./raster-child.js', import.meta.url))

// the last rasters by SVG content, on globalThis like the other pcbjs caches, so an edit that leaves the faces as they were spawns nothing
const KEY = Symbol.for('pcbjs.export.rasters')
const memo = (): Map<string, Uint8Array> => ((globalThis as any)[KEY] ??= new Map())
const KEEP = 16

/** One PNG per SVG, each drawn at the width and height its root element states; throws with the child's message when sharp fails. */
export function rasterSync(svgs: string[]): Uint8Array[] {
  const keys = svgs.map(s => createHash('sha1').update(s).digest('hex'))
  const todo = [...new Set(keys.filter(k => !memo().has(k)))]
  const made = spawnRaster(todo.map(k => svgs[keys.indexOf(k)]))
  const out = keys.map(k => memo().get(k) ?? made[todo.indexOf(k)])
  todo.forEach((k, i) => memo().set(k, made[i]))
  while (memo().size > KEEP) memo().delete(memo().keys().next().value!)
  return out
}

function spawnRaster(svgs: string[]): Uint8Array[] {
  if (!svgs.length) return []
  const r = spawnSync(process.execPath, [CHILD], { input: JSON.stringify(svgs), maxBuffer: 1 << 30, timeout: 120_000 })
  if (r.status !== 0)
    throw new Error(
      `rasterising the board faces failed: ${String(r.stderr ?? r.error ?? '')
        .trim()
        .split('\n')
        .at(-1)}`,
    )
  const out: Uint8Array[] = []
  const buf = r.stdout
  for (let at = 0; at < buf.length;) {
    const n = buf.readUInt32LE(at)
    out.push(new Uint8Array(buf.subarray(at + 4, at + 4 + n)))
    at += 4 + n
  }
  if (out.length !== svgs.length) throw new Error(`rasterising the board faces gave ${out.length} images for ${svgs.length}`)
  return out
}
