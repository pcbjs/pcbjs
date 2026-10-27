// meshes cached as .pcbjs/models/<hash>.bin, the hash from @pcbjs/step/key as the site data's `step.mesh`; OpenCascade loads here only
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Connect, Plugin } from 'vite'
import type { Board, Footprint, Pt } from '@pcbjs/core/model'
import { meshKey } from '@pcbjs/step/key'
import { meshFromBinary } from '@pcbjs/step/binary'
import { bounds } from '@pcbjs/step/mesh'
import { modelMatrix, placementIssue, transformBox, type Box3, type Rect } from '@pcbjs/step/place'
import { stepMeshKey } from '@pcbjs/export/models'
import type { ModelBoxLoader } from '@pcbjs/compile/reference'
import type { ResolvedConfig } from './config.js'
import type { PluginState } from './plugin.js'
import type { Compiled } from './project.js'
import { referenceMesh, referenceMiddleware, usedReferenceMeshes } from './references.js'
import { fetchNotice, installModelFetch } from './fetch-model.js'

const HASH = /^[0-9a-f]{64}$/

export const modelsDir = (root: string): string => join(root, '.pcbjs', 'models')

/** By mesh hash: the absolute path the compiler resolved. */
export function usedModels(compiled: Iterable<Compiled>): Map<string, string> {
  const out = new Map<string, string>()
  for (const c of compiled) {
    const byRef = new Map(c.board.footprints.map(f => [f.ref, f]))
    for (const fp of c.site.footprints) {
      const mesh = fp.step?.mesh, m = byRef.get(fp.ref)?.model
      if (mesh && m?.kind === 'step' && m.path) out.set(mesh, m.path)
    }
  }
  return out
}

/** The isolated preview of dev included. */
export function compiledOf(state: PluginState): Compiled[] {
  return [...state.slots.flatMap(s => s.compiled ?? []), ...(state.preview ? [state.preview.compiled] : [])]
}

// by hash, so concurrent requests share one conversion
const INFLIGHT = Symbol.for('pcbjs.cli.models.inflight')
const inflight = (): Map<string, Promise<Uint8Array>> => ((globalThis as any)[INFLIGHT] ??= new Map())

/** Written through a temporary file and a rename, so another process never reads half a file; throws when the content no longer has this hash. */
export function meshFor(hash: string, path: string, dir: string): Promise<Uint8Array> {
  if (!HASH.test(hash)) return Promise.reject(new Error(`not a mesh hash: ${hash}`))
  const file = join(dir, `${hash}.bin`)
  try { return Promise.resolve(new Uint8Array(readFileSync(file))) } catch { /* not cached yet */ }
  const running = inflight().get(hash)
  if (running) return running
  const job = (async () => {
    const content = new Uint8Array(readFileSync(path))
    if (meshKey(content) !== hash) throw new Error(`${path} changed since the board compiled`)
    const { modelToMesh, meshToBinary } = await import('@pcbjs/step')
    const bin = meshToBinary(await modelToMesh(content, { path }))
    mkdirSync(dir, { recursive: true })
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    try { writeFileSync(tmp, bin); renameSync(tmp, file) } finally { rmSync(tmp, { force: true }) }
    return bin
  })()
  inflight().set(hash, job)
  job.then(() => inflight().delete(hash), () => inflight().delete(hash))
  return job
}

// by hash, for the life of the process
const BOUNDS = Symbol.for('pcbjs.cli.models.bounds')
const boundsMemo = (): Map<string, Box3> => ((globalThis as any)[BOUNDS] ??= new Map())

/** In the model's own frame, converting the file when it is not cached yet. */
export async function meshBounds(hash: string, path: string, dir: string): Promise<Box3> {
  const hit = boundsMemo().get(hash)
  if (hit) return hit
  const b = bounds(meshFromBinary(await meshFor(hash, path, dir)))
  boundsMemo().set(hash, b)
  return b
}

const MODEL_CHILD = fileURLToPath(new URL('./model-child.js', import.meta.url))
// so a compile does not try them again
const FAILED = Symbol.for('pcbjs.cli.models.failed')
const failed = (): Set<string> => ((globalThis as any)[FAILED] ??= new Set())

/** From this process, the cache, or a conversion in a child process; null when it does not read. */
function meshBoundsSync(hash: string, path: string, dir: string): Box3 | null {
  const hit = boundsMemo().get(hash)
  if (hit) return hit
  const file = join(dir, `${hash}.bin`)
  let bin: Uint8Array | null = null
  try { bin = new Uint8Array(readFileSync(file)) } catch { /* not cached yet */ }
  if (!bin && !failed().has(hash)) {
    // a hung conversion must not hold the compile: two minutes, then the part keeps its default height
    spawnSync(process.execPath, [MODEL_CHILD, hash, path, dir], { stdio: 'ignore', timeout: 120_000 })
    try { bin = new Uint8Array(readFileSync(file)) } catch { failed().add(hash) }
  }
  if (!bin) return null
  try { const b = bounds(meshFromBinary(bin)); boundsMemo().set(hash, b); return b } catch { return null }
}

/** See CompileOptions.modelBox: synchronous, so a new file converts once in a child process; it also points the model fetch at this project. */
export function modelBoxLoader(root: string): ModelBoxLoader {
  installModelFetch(root)
  return spec => {
    const hash = spec.path ? stepMeshKey(spec.path) : null
    if (!hash || !spec.path) return null
    const b = meshBoundsSync(hash, spec.path, modelsDir(root))
    if (!b || !b.min.every(Number.isFinite) || !b.max.every(Number.isFinite)) return null
    const box = transformBox(modelMatrix({ offset: spec.offset ?? [0, 0, 0], rotate: spec.rotate ?? [0, 0, 0], scale: spec.scale ?? [1, 1, 1] }), b)
    return { min: box.min, max: box.max }
  }
}

/** mm, x right and y down, before the footprint's rotation and its mirror on the back. */
export function toFootprint(fp: Pick<Footprint, 'at' | 'rot' | 'side'>, p: Pt): Pt {
  const a = (fp.rot * Math.PI) / 180, dx = p[0] - fp.at[0], dy = p[1] - fp.at[1]
  const x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a)
  return [fp.side === 'B' ? -x : x, y]
}

/** In its own frame, else the extent of its pads and graphics; null when it has neither. */
export function courtyardRect(board: Board, fp: Footprint): Rect | null {
  const layer = fp.side === 'B' ? 'B.CrtYd' : 'F.CrtYd'
  const box = (pts: Pt[]): Rect | null => {
    if (!pts.length) return null
    const l = pts.map(p => toFootprint(fp, p))
    return { x0: Math.min(...l.map(p => p[0])), y0: Math.min(...l.map(p => p[1])), x1: Math.max(...l.map(p => p[0])), y1: Math.max(...l.map(p => p[1])) }
  }
  const mine = board.items.filter(it => it.ref === fp.ref)
  return box(mine.flatMap(it => (it.kind === 'graphic' && it.layer === layer ? it.paths.flat() : [])))
    ?? box(mine.flatMap(it => (it.kind === 'pad' ? it.poly : it.kind === 'graphic' ? it.paths.flat() : [])))
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/** The mesh extent, the courtyard and the issue, if any; a file that does not convert gets the issue with the reason. */
export async function placeModels(compiled: Iterable<Compiled>, root: string): Promise<void> {
  for (const c of compiled) {
    const waiting = c.site.footprints.flatMap(sf => (sf.model?.kind === 'box' && sf.model.fetch ? [{ ref: sf.ref, source: sf.model.fetch }] : []))
    const notice = fetchNotice(c.board.name, waiting)
    if (notice) console.warn(notice)
    const byRef = new Map(c.board.footprints.map(f => [f.ref, f]))
    for (const sf of c.site.footprints) {
      const step = sf.step, fp = byRef.get(sf.ref), m = fp?.model
      if (!step?.mesh || !fp || m?.kind !== 'step' || !m.path) continue
      const cy = courtyardRect(c.board, fp)
      if (cy) step.courtyard = { x0: round3(cy.x0), y0: round3(cy.y0), x1: round3(cy.x1), y1: round3(cy.y1) }
      let b: Box3
      try { b = await meshBounds(step.mesh, m.path, modelsDir(root)) } catch (e: any) { step.issue = `the file did not read: ${String(e?.message ?? e).split('\n')[0].split(` ${m.path}`).join('')}`; continue }
      step.bounds = { min: b.min.map(round3) as Box3['min'], max: b.max.map(round3) as Box3['max'] }
      const tht = fp.pads.some(id => { const it = c.board.items[id - 1]; return it?.kind === 'pad' && !!it.drill })
      const issue = cy ? placementIssue(b, step.transform, cy, 1, { height: fp.height, tht }) : null
      if (issue) step.issue = issue
    }
  }
}

/** GET /__pcbjs/model/<hash> answers with the mesh binary of a model a compiled board uses. */
export function modelMiddleware(cfg: ResolvedConfig, state: PluginState): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = (req.url ?? '').split('?')[0]
    if (!url.startsWith('/__pcbjs/model/')) return next()
    const hash = url.slice('/__pcbjs/model/'.length)
    const path = HASH.test(hash) ? usedModels(compiledOf(state)).get(hash) : undefined
    if (!path) { res.statusCode = 404; res.end('no such model'); return }
    meshFor(hash, path, modelsDir(cfg.root)).then(bin => {
      res.setHeader('content-type', 'application/octet-stream')
      // the hash names the content, so the browser may keep it
      res.setHeader('cache-control', 'public, max-age=31536000, immutable')
      res.end(Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength))
    }, (e: any) => {
      console.warn(`[pcbjs] model ${path}: ${String(e?.message ?? e)}`)
      res.statusCode = 500; res.end(String(e?.message ?? e))
    })
  }
}

/** List it before the pcbjs plugin, whose /__pcbjs/ handler answers every other path. */
export function modelsPlugin(cfg: ResolvedConfig, state: PluginState, mode: 'dev' | 'build'): Plugin {
  return {
    name: 'pcbjs:models',
    configureServer(s) { if (mode === 'dev') { s.middlewares.use(referenceMiddleware()); s.middlewares.use(modelMiddleware(cfg, state)) } },
    async generateBundle() {
      // the SSR bundle of the prerender never loads a mesh
      if (mode !== 'build' || (this.environment && this.environment.name !== 'client')) return
      for (const [hash, path] of usedModels(compiledOf(state))) {
        try { this.emitFile({ type: 'asset', fileName: `models/${hash}.bin`, source: await meshFor(hash, path, modelsDir(cfg.root)) }) }
        catch (e: any) { this.warn(`model ${path}: ${String(e?.message ?? e)}; the site draws the generated model`) }
      }
      // referenced boards, as models/boards/<hash>.bin
      for (const hash of usedReferenceMeshes(compiledOf(state))) { const bin = referenceMesh(hash); if (bin) this.emitFile({ type: 'asset', fileName: `models/boards/${hash}.bin`, source: bin }); else this.warn(`reference mesh ${hash} is not in the cache`) }
    },
  }
}
