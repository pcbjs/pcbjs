// `pcbjs shot`: PNGs of the render spec, docs/viewer.md, one per board, target, view and --select. A thin client of a live
// session, which renders by its own renderer worker; without one it compiles here and renders through the same code.
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { variantSlug } from '@pcbjs/core/internal/variants'
import { boardFindings } from '@pcbjs/export/internal/findings'
import { resolveConfig } from './project/config.js'
import { compileHere } from './project/local.js'
import { refProblem, secs } from './project/dev-reuse.js'
import { connect, sessionLine, sessionOf } from './session/thin.js'
import type { Envelope } from '@pcbjs/core/protocol'
import { glbOf, type Compiled } from './project/project.js'
import { VIEWS, type RenderSpec, type View } from './render/spec.js'
import type { RenderWorker } from './render/worker-client.js'

export const SHOT_VIEWS = VIEWS
export type ShotView = View

/** What every shot of a run shares: the spec without its view, entry and target. */
export type Look = Omit<RenderSpec, 'view' | 'entry' | 'target'>

export interface ShotOptions {
  entries?: string[]
  config?: string
  root?: string
  /** default `.pcbjs/shots` */
  outDir?: string
  /** none means 2D and 3D */
  views?: ShotView[]
  look?: Look
  /** each frames and highlights one reference, one shot each */
  select?: string[]
  verbose?: boolean
  /** compile here, every stage rebuilt; 'all' drops the route memos too */
  fresh?: boolean | 'all'
}

export interface ShotJob {
  /** the entry file */
  entry: string
  board: string
  target: string | null
  file: string
  spec: RenderSpec
}

/** In 2D, 3D, schematic order, each once; none given is 2D and 3D. */
export const shotViews = (views: readonly ShotView[] = []): ShotView[] => (views.length ? SHOT_VIEWS.filter(v => views.includes(v)) : ['2d', '3d'])

/** `WxH` as two integers from 16 to 4096; null when it does not parse. */
export function parseSize(v: string): [number, number] | null {
  const m = /^\s*(\d+)\s*[x×X,]\s*(\d+)\s*$/.exec(v)
  if (!m) return null
  const w = +m[1],
    h = +m[2]
  return w >= 16 && h >= 16 && w <= 4096 && h <= 4096 ? [w, h] : null
}

const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9._+-]+/g, '-').replace(/^-+|-+$/g, '') || 'board'

/** So shots with other options never overwrite each other: `-top`, `-explode60`, `-select-U1`, `-F.Cu`, `-back`, `-mirror`, `-dark`. */
export function shotSuffix(view: ShotView, o: Look & { select?: string } = {}): string {
  const board = view !== 'sch'
  const cam = view === '3d' && typeof o.camera === 'string' && o.camera !== 'iso' ? o.camera : view === '3d' && o.camera ? 'camera' : ''
  return [
    cam,
    view === '3d' && o.explode !== undefined ? `explode${Math.round(o.explode * 100)}` : '',
    o.select ? `select-${fileSafe(o.select)}` : '',
    o.frame && !o.select ? `frame-${fileSafe(o.frame)}` : '',
    o.highlight?.length && !o.select ? `hl-${fileSafe(o.highlight.join('+'))}` : '',
    o.layers?.length && board ? fileSafe(o.layers.join('+')) : '',
    o.side === 'B' && board ? 'back' : '',
    o.mirror && board ? 'mirror' : '',
    o.theme ?? '',
  ]
    .filter(Boolean)
    .map(p => `-${p}`)
    .join('')
}

/** Per board, per target, per view, per select. */
export function shotJobs(
  boards: { entry: string; name: string; targets: (string | null)[] }[],
  views: ShotView[],
  outDir: string,
  look: Look = {},
  select: string[] = [],
): ShotJob[] {
  const out: ShotJob[] = []
  for (const b of boards)
    for (const t of b.targets)
      for (const view of views)
        for (const sel of select.length ? select : [undefined]) {
          const slug = t != null ? variantSlug(t) : null
          const spec: RenderSpec = { ...look, view, entry: b.entry, ...(t != null ? { target: t } : {}), ...(sel ? { frame: sel, highlight: [sel] } : {}) }
          const file = join(outDir, `${fileSafe(b.name)}${slug ? `-${fileSafe(slug)}` : ''}-${view}${shotSuffix(view, { ...look, ...(sel ? { select: sel } : {}) })}.png`)
          out.push({ entry: b.entry, board: b.name, target: t, file, spec })
        }
  return out
}

interface Done {
  png: Uint8Array
  legend: string
  width: number
  height: number
}

/** Writes the PNG and prints its line; false when the shot failed. */
function report(j: ShotJob, t0: number, got: Done | Error): boolean {
  const label = `${j.board}${j.target ? ` [${j.target}]` : ''}  ${j.spec.view}${j.spec.frame ? `  ${j.spec.frame}` : ''}`
  if (got instanceof Error) {
    console.error(`${label}  FAIL  ${got.message.split('\n')[0]}`)
    return false
  }
  writeFileSync(j.file, got.png)
  const rel = relative(process.cwd(), j.file)
  console.log(`${rel && !rel.startsWith('..') ? rel : j.file}  ${got.width}x${got.height}  ${secs(performance.now() - t0)}  ${got.legend}`)
  return true
}

const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)))

interface SessionBoards {
  boards: { entry: string; current: boolean; reason?: string; name?: string; targets?: (string | null)[]; select?: Record<string, string | null> }[]
}

async function viaSession(info: NonNullable<Awaited<ReturnType<typeof sessionOf>>>, root: string, entries: string[], o: ShotOptions, outDir: string): Promise<number> {
  const c = await connect(info, 'pcbjs shot', root)
  try {
    const e = await c.request('session/boards', { project: root, entries, select: o.select ?? [] }, 600_000)
    console.error(sessionLine(info, e))
    let failed = 0
    for (const b of e.value.boards.filter(b => !b.name)) {
      console.error(`${relative(root, b.entry)}  ${b.reason ?? 'not compiled'}`)
      failed++
    }
    const boards = e.value.boards.filter(b => b.name).map(b => ({ entry: b.entry, name: b.name!, targets: b.targets ?? [null], select: b.select ?? {} }))
    for (const b of boards) for (const [sel, why] of Object.entries(b.select)) if (why) console.error(`warning  --select on ${b.name}: ${why}`)
    const jobs = shotJobs(boards, shotViews(o.views), outDir, o.look, o.select)
    mkdirSync(outDir, { recursive: true })
    for (const j of jobs) {
      const t0 = performance.now()
      const got = await c.request('session/render', { project: root, spec: j.spec }, 600_000).then(r => ({ ...r.value, png: Buffer.from(r.value.png, 'base64') }), asError)
      if (!report(j, t0, got)) failed++
    }
    return failed || !jobs.length ? 1 : 0
  } finally {
    c.close()
  }
}

async function here(cfg: Awaited<ReturnType<typeof resolveConfig>>, o: ShotOptions, outDir: string): Promise<number> {
  const local = await compileHere(cfg, { verbose: o.verbose, fresh: o.fresh })
  for (const l of local.errors) console.error(l)
  const compiled = new Map<string, Compiled>()
  const boards = local.slots
    .filter(s => s.compiled && !s.conflict)
    .map(s => {
      for (const c of s.compiled!) compiled.set(`${s.entry.file}|${c.board.variant?.name ?? ''}`, c)
      const b = s.compiled![0].board
      for (const sel of o.select ?? []) {
        const why = refProblem(b, sel)
        if (why) console.error(`warning  --select on ${b.name}: ${why}`)
      }
      return { entry: s.entry.file, name: b.name, targets: s.compiled!.map(c => c.board.variant?.name ?? null) }
    })
  const jobs = shotJobs(boards, shotViews(o.views), outDir, o.look, o.select)
  mkdirSync(outDir, { recursive: true })
  const { renderShot } = await import('./render/render.js')
  // the renderer loads only for a 3D shot
  const worker: RenderWorker | null = jobs.some(j => j.spec.view === '3d') ? new (await import('./render/worker-client.js')).RenderWorker() : null
  let failed = local.errors.length
  try {
    for (const j of jobs) {
      const t0 = performance.now()
      const c = compiled.get(`${j.entry}|${j.target ?? ''}`)!
      const got = await renderShot({
        compiled: c,
        glb: async () => glbOf(c, cfg.root),
        findings: boardFindings(c.board, cfg.root),
        project: cfg.root,
        snapshot: local.snapshot,
        spec: j.spec,
        worker: () => worker!,
      }).catch(asError)
      if (!report(j, t0, got)) failed++
    }
  } finally {
    await worker?.close()
  }
  return failed || !jobs.length ? 1 : 0
}

export async function shot(o: ShotOptions): Promise<number> {
  const cfg = await resolveConfig(o.entries ?? [], 'build', o.config, o.root, () => {})
  const outDir = resolve(cfg.root, o.outDir ?? join('.pcbjs', 'shots'))
  const root = realpathSync(cfg.root)
  const info = o.fresh ? null : await sessionOf(root)
  if (info)
    return viaSession(
      info,
      root,
      cfg.entries.map(e => e.file),
      o,
      outDir,
    )
  return here(cfg, o, outDir)
}
