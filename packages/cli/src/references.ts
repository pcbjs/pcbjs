// see docs/references.md; the entry chain travels to each child in PCBJS_REFERENCE_CHAIN so a cycle is found across processes
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Connect } from 'vite'
import type { Board } from '@pcbjs/core/model'
import type { HeightSource, ReferencedBoard, ReferencedFootprint, ReferenceResolver } from '@pcbjs/core/reference'
import { isOwnFile } from '@pcbjs/core/own-files'
import { bodyHeight, entryLabel } from '@pcbjs/compile/reference'
import { findConfig, resolveConfig } from './config.js'
import type { Compiled } from './project.js'

/** Bump when what a referenced compile keeps or how its mesh is built changes, so older caches compile again. */
export const REFERENCE_VERSION = 3
/** The longest chain of references, the entry being compiled included. */
export const MAX_CHAIN = 8
const CHAIN_ENV = 'PCBJS_REFERENCE_CHAIN'
const HASH = /^[0-9a-f]{64}$/

const real = (f: string) => {
  try {
    return realpathSync(f)
  } catch {
    return resolve(f)
  }
}
export const boardMeshDir = (root: string): string => join(root, '.pcbjs', 'models', 'boards')
const cacheDir = (root: string) => join(root, '.pcbjs', 'references')
const cacheFile = (root: string, entry: string) => join(cacheDir(root), `${createHash('sha256').update(entry).digest('hex').slice(0, 20)}.json`)

/** Outermost first, from the parent that started this process. */
export function inheritedChain(): string[] {
  try {
    const v = JSON.parse(process.env[CHAIN_ENV] ?? '[]')
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

// by project root and entry, with the stamps of their files when last checked
interface Memo {
  board: ReferencedBoard
  stamps: Map<string, string>
}
const MEMO = Symbol.for('pcbjs.cli.references')
const memo = (): Map<string, Memo> => ((globalThis as any)[MEMO] ??= new Map())
/** For the tests. */
export const referenceStats = (): { spawned: number; cached: number } => ((globalThis as any)[Symbol.for('pcbjs.cli.references.stats')] ??= { spawned: 0, cached: 0 })

const stamp = (f: string) => {
  try {
    const s = statSync(f)
    return `${s.size}:${s.mtimeMs}`
  } catch {
    return 'missing'
  }
}
const sha = (f: string): string => {
  try {
    return createHash('sha256').update(readFileSync(f)).digest('hex')
  } catch {
    return 'missing'
  }
}

/** Every file's path and content, and REFERENCE_VERSION. */
export function graphHash(hashes: Record<string, string>): string {
  const h = createHash('sha256').update(`pcbjs-reference v${REFERENCE_VERSION}\0`)
  for (const f of Object.keys(hashes).sort()) h.update(`${f}\0${hashes[f]}\0`)
  return h.digest('hex')
}

/** The nearest directory up from the entry with a pcb.config.*, else its own directory. */
export function projectOf(entry: string): string {
  for (let d = dirname(entry); ; d = dirname(d)) {
    if (findConfig(d)) return d
    if (dirname(d) === d) return dirname(entry)
  }
}

export function referenceResolver(root: string, entry: string): ReferenceResolver {
  const chain = [...inheritedChain(), real(entry)]
  return { resolve: file => resolveEntry(root, chain, file) }
}

const arrow = (list: string[]) => list.map(entryLabel).join(' → ')

function resolveEntry(root: string, chain: string[], file: string): ReferencedBoard {
  if (!existsSync(file)) throw new Error(`${relative(root, file) || file} does not exist`)
  const f = real(file)
  const at = chain.indexOf(f)
  if (at >= 0) throw new Error(`a reference cycle: ${arrow([...chain.slice(at), f])}`)
  if (chain.length >= MAX_CHAIN) throw new Error(`references nest more than ${MAX_CHAIN} deep: ${arrow([...chain, f])}`)
  const hit = cached(root, f)
  const board = hit ?? spawnChild(root, chain, f)
  if (hit) referenceStats().cached++
  checkGraph(chain, board)
  if (board.mesh) meshPaths().set(board.mesh, join(boardMeshDir(root), `${board.mesh}.bin`))
  return board
}

// by hash, for the dev endpoint and the build
const MESHES = Symbol.for('pcbjs.cli.references.meshes')
const meshPaths = (): Map<string, string> => ((globalThis as any)[MESHES] ??= new Map())

// from this process or from the cache file; null when anything changed
function cached(root: string, f: string): ReferencedBoard | null {
  const key = `${root}\0${f}`
  const m = memo().get(key)
  if (m && [...m.stamps].every(([p, s]) => stamp(p) === s) && meshThere(root, m.board)) return m.board
  let data: { version: number; board: ReferencedBoard; hashes: Record<string, string> } | null = null
  try {
    data = JSON.parse(readFileSync(cacheFile(root, f), 'utf8'))
  } catch {
    return null
  }
  if (!data || data.version !== REFERENCE_VERSION || data.board?.entry !== f) return null
  for (const [p, h] of Object.entries(data.hashes)) if (sha(p) !== h) return null
  if (!meshThere(root, data.board)) return null
  memo().set(key, { board: data.board, stamps: new Map(Object.keys(data.hashes).map(p => [p, stamp(p)])) })
  return data.board
}
const meshThere = (root: string, b: ReferencedBoard) => !b.mesh || existsSync(join(boardMeshDir(root), `${b.mesh}.bin`))

function checkGraph(chain: string[], b: ReferencedBoard): void {
  const walk = (node: string, path: string[]) => {
    for (const next of b.graph[node] ?? []) {
      const at = chain.indexOf(next)
      if (at >= 0) throw new Error(`a reference cycle: ${arrow([...chain.slice(at), ...path, next])}`)
      if (path.includes(next)) throw new Error(`a reference cycle: ${arrow([...path.slice(path.indexOf(next)), next])}`)
      if (chain.length + path.length + 1 > MAX_CHAIN) throw new Error(`references nest more than ${MAX_CHAIN} deep: ${arrow([...chain, ...path, next])}`)
      walk(next, [...path, next])
    }
  }
  walk(b.entry, [b.entry])
}

const CHILD = fileURLToPath(new URL('./reference-child.js', import.meta.url))

function spawnChild(root: string, chain: string[], f: string): ReferencedBoard {
  referenceStats().spawned++
  mkdirSync(cacheDir(root), { recursive: true })
  const out = join(cacheDir(root), `run.${process.pid}.${Math.random().toString(36).slice(2)}.json`)
  const r = spawnSync(process.execPath, [CHILD, f, out, boardMeshDir(root)], {
    cwd: projectOf(f),
    env: { ...process.env, [CHAIN_ENV]: JSON.stringify(chain), NODE_ENV: 'production' },
    encoding: 'utf8',
    maxBuffer: 64 << 20,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let res: { ok: boolean; board?: ReferencedBoard; hashes?: Record<string, string>; error?: string } | null = null
  try {
    res = JSON.parse(readFileSync(out, 'utf8'))
  } catch {
    /* reported below */
  } finally {
    rmSync(out, { force: true })
  }
  if (!res) throw new Error(`its compile did not finish${r.error ? `: ${r.error.message}` : ''}${r.stderr ? `: ${String(r.stderr).trim().split('\n').slice(-3).join(' ')}` : ''}`)
  if (!res.ok || !res.board) throw new Error(res.error ?? 'its compile failed')
  const file = cacheFile(root, f),
    tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ version: REFERENCE_VERSION, board: res.board, hashes: res.hashes ?? {} }))
  renameSync(tmp, file)
  memo().set(`${root}\0${f}`, { board: res.board, stamps: new Map(Object.keys(res.hashes ?? {}).map(p => [p, stamp(p)])) })
  return res.board
}

/** Runs in reference-child.js, in the referenced entry's project directory, and writes the mesh into `meshDir`. */
export async function compileReferenced(entry: string, meshDir: string): Promise<{ board: ReferencedBoard; hashes: Record<string, string> }> {
  const root = projectOf(entry)
  const cfg = await resolveConfig([relative(root, entry)], 'build', undefined, root, () => {})
  const { pluginState } = await import('./plugin.js')
  const { compileServer } = await import('./check.js')
  const { compileEntry, importedFiles } = await import('./project.js')
  const { CLIENT_DIR } = await import('./vite.js')
  const state = pluginState(cfg)
  const server = await compileServer(cfg, state)
  try {
    const [c] = await compileEntry(server, cfg, cfg.entries[0], false)
    const own = (p: string) => !p.includes('/node_modules/') && !p.startsWith('\0') && !p.includes('/.pcbjs/') && !isOwnFile(p) && existsSync(p)
    const files = new Set([...importedFiles(server, cfg.entries[0].file)].filter(own))
    if (cfg.configFile) files.add(cfg.configFile)
    const graph: Record<string, string[]> = { [real(entry)]: [] }
    for (const r of c.board.references ?? []) {
      for (const p of r.files) files.add(p)
      graph[real(entry)].push(r.entry)
      const nested = [...memo().values()].find(m => m.board.entry === r.entry)?.board
      if (nested) Object.assign(graph, nested.graph)
    }
    // model files count too: their boxes give the bodies their heights
    for (const fp of c.board.footprints) {
      const m = fp.model
      if (m?.kind === 'step' && m.path && existsSync(m.path)) files.add(m.path)
    }
    const hashes = Object.fromEntries([...files].sort().map(p => [p, sha(p)]))
    const hash = graphHash(hashes)
    const s = c.site
    const { modelBoxLoader } = await import('./models.js')
    const load = modelBoxLoader(cfg.root)
    const byRef = new Map(c.board.footprints.map(f => [f.ref, f]))
    const height = (ref: string, given: number): { height: number; heightFrom?: ReferencedFootprint['heightFrom'] } => {
      const fp = byRef.get(ref)
      if (!fp) return { height: given }
      const h = bodyHeight(c.board, fp, load)
      return { height: h.height, heightFrom: h.from }
    }
    const board: ReferencedBoard = {
      entry: real(entry),
      name: s.name,
      title: s.title,
      revision: s.revision,
      thickness: s.thickness,
      outline: s.outline,
      drills: s.drills,
      footprints: s.footprints.map(fp => ({
        ref: fp.ref,
        at: fp.at,
        rot: fp.rot,
        side: fp.side,
        ...height(fp.ref, fp.height),
        body: fp.body,
        pads: fp.pads.map(p => ({ num: p.num, name: p.name, at: p.at, ...(p.net ? { net: p.net } : {}) })),
      })),
      hash,
      files: [...files].sort(),
      graph,
      status: s.fab.status,
    }
    // built by the viewer's own geometry code, loaded through this Vite server
    const mod = await server.ssrLoadModule(join(CLIENT_DIR, 'src/scene/reference.ts'))
    const { meshFromBinary, meshToBinary } = await import('@pcbjs/step/binary')
    const { modelsDir } = await import('./models.js')
    const steps = (h: string) => {
      try {
        return meshFromBinary(readFileSync(join(modelsDir(cfg.root), `${h}.bin`)))
      } catch {
        return null
      }
    }
    const model = mod.referenceMesh(s, steps) as { meshes: any[]; board: number }
    mkdirSync(meshDir, { recursive: true })
    const bin = join(meshDir, `${hash}.bin`),
      tmp = `${bin}.${process.pid}.tmp`
    writeFileSync(tmp, meshToBinary(model))
    renameSync(tmp, bin)
    board.mesh = hash
    board.split = model.board
    return { board, hashes }
  } finally {
    await server.close()
  }
}

/** For the dev server's watcher. */
export function referenceFiles(compiled: Iterable<Compiled>): string[] {
  const out = new Set<string>()
  for (const c of compiled) for (const r of c.board.references ?? []) for (const f of r.files) out.add(f)
  return [...out]
}

export function usedReferenceMeshes(compiled: Iterable<Compiled>): Set<string> {
  return new Set([...compiled].flatMap(c => (c.board.references ?? []).flatMap(r => (r.mesh ? [r.mesh] : []))))
}

/** Its name, when an entry of the config compiles it. */
export function linkReferences(c: Compiled, entries: { file: string }[]): void {
  const ours = new Set(entries.map(e => real(e.file)))
  for (const [i, r] of (c.board.references ?? []).entries()) if (ours.has(r.entry) && c.site.references?.[i]) c.site.references[i].page = r.name
}

/** GET /__pcbjs/model/boards/<hash> answers with the mesh of a referenced board. */
export function referenceMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = (req.url ?? '').split('?')[0]
    if (!url.startsWith('/__pcbjs/model/boards/')) return next()
    const hash = url.slice('/__pcbjs/model/boards/'.length)
    let bin: Buffer | null = null
    const path = HASH.test(hash) ? meshPaths().get(hash) : undefined
    if (path)
      try {
        bin = readFileSync(path)
      } catch {
        /* below */
      }
    if (!bin) {
      res.statusCode = 404
      res.end('no such reference mesh')
      return
    }
    res.setHeader('content-type', 'application/octet-stream')
    res.setHeader('cache-control', 'public, max-age=31536000, immutable')
    res.end(bin)
  }
}

/** Null when it is not in the cache. */
export function referenceMesh(hash: string): Uint8Array | null {
  const path = meshPaths().get(hash)
  if (!path) return null
  try {
    return new Uint8Array(readFileSync(path))
  } catch {
    return null
  }
}

const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2)

const SOURCE: Record<HeightSource, string> = { height: 'height', model: 'model box', bare: 'bare hole', default: 'default 1 mm' }

/** Names the parts whose height comes from a model box or the default. */
function heightLine(list: { ref: string; height?: number; from?: HeightSource }[]): string {
  const by = new Map<HeightSource, string[]>()
  for (const h of list) {
    const k = h.from ?? 'height'
    by.set(k, [...(by.get(k) ?? []), h.ref])
  }
  const named = new Map(list.map(h => [h.ref, h.height]))
  return (['height', 'model', 'default', 'bare'] as const)
    .filter(k => by.has(k))
    .map(k => {
      const refs = by.get(k)!
      const list = k === 'model' || k === 'default' ? ` ${refs.map(r => (k === 'model' && named.get(r) !== undefined ? `${r} ${f2(named.get(r)!)}` : r)).join(', ')}` : ''
      return `${refs.length} ${SOURCE[k]}${list}`
    })
    .join('; ')
}

export function inspectReferences(b: Board, root: string): { text: string[]; json: unknown; found: boolean } {
  const refs = b.references ?? []
  if (!refs.length) return { text: ['no references'], json: { references: [] }, found: false }
  const text: string[] = []
  const rows = refs.map(r => {
    const t = r.transform
    const angle = ((Math.atan2(t[1], t[0]) * 180) / Math.PI + 360) % 360
    const flipped = t[10] < 0
    const o: [number, number, number] = [t[12], -t[13], t[14]]
    text.push(`${r.name}  ${relative(root, r.entry)}  ${r.title}  ${r.status}`)
    text.push(
      `  anchor  ${r.anchor.kind === 'mate' ? `${r.anchor.local} mates ${r.anchor.remote}` : `at ${r.anchor.at.map(f2).join(' ')}`}${r.stack ? `  stack ${r.stack}` : ''}${r.gap !== undefined ? `  gap ${f2(r.gap)}` : ''}${r.rotate ? `  rotate ${f2(r.rotate)}` : ''}${r.offset.some(v => v) ? `  offset ${r.offset.map(f2).join(' ')}` : ''}`,
    )
    text.push(`  transform  origin to ${f2(o[0])} ${f2(o[1])} ${f2(o[2])}, turned ${f2(angle)} deg${flipped ? ', upside down' : ''}, slab z ${f2(r.z[0])} to ${f2(r.z[1])}`)
    if (r.mates && r.mates.length > 1)
      text.push(
        `  also mates  ${r.mates
          .slice(1)
          .map(m => `${m.local.ref}.${m.local.pin} on ${m.remote.ref}.${m.remote.pin}`)
          .join(', ')}`,
      )
    if (r.gap !== undefined)
      text.push(
        `  gap from  ${r.gapFrom === 'gap' ? 'gap' : r.gapFrom === 'height' ? `${r.anchor.kind === 'mate' ? r.anchor.local.split('.')[0] : 'the part'}'s height` : r.gapFrom === 'model' ? 'the model box' : r.gapFrom === 'default' ? 'the 8 mm default' : 'gap'}`,
      )
    if (r.heights?.length) text.push(`  heights here  ${heightLine(r.heights)}`)
    if (r.bodies.length) text.push(`  heights there  ${heightLine(r.bodies.map(b => ({ ref: b.ref, height: b.z[1] - b.z[0], from: b.from })))}`)
    text.push(`  mesh  ${r.mesh ? `.pcbjs/models/boards/${r.mesh.slice(0, 12)}….bin` : 'none'}  ${r.files.length} files`)
    return {
      name: r.name,
      entry: relative(root, r.entry),
      anchor: r.anchor,
      stack: r.stack ?? null,
      gap: r.gap ?? null,
      rotate: r.rotate,
      offset: r.offset,
      transform: r.transform,
      z: r.z,
      hash: r.hash,
      status: r.status,
      gapFrom: r.gapFrom ?? null,
      pairs: (r.mates ?? (r.mate ? [r.mate] : [])).map(m => ({ local: `${m.local.ref}.${m.local.pin}`, remote: `${m.remote.ref}.${m.remote.pin}` })),
      heights: {
        here: (r.heights ?? []).map(h => ({ ref: h.ref, height: h.height, from: h.from })),
        there: r.bodies.map(b => ({ ref: b.ref, height: Math.round((b.z[1] - b.z[0]) * 1000) / 1000, from: b.from ?? null })),
      },
    }
  })
  return { text, json: { references: rows }, found: true }
}
