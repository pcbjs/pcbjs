import { fileKey, sameFile, under } from './files.js'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileBoards, compileLoaded, sketch, type CompileOptions, type CompileResult, type Exporter, type StageTime } from '@pcbjs/compile'
import { evaluateEntry, type ModuleLoader } from '@pcbjs/compile/internal/entry'
import { defaultsKey, demanded, exportsKey, servedStages, STAGES } from '@pcbjs/compile/internal/pipeline'
import { variantSlug } from '@pcbjs/core/internal/variants'
import type { Board } from '@pcbjs/core/model'
import { patchesFile } from '@pcbjs/core/internal/patch'
import { buildFab, fabDate, zipFab, type FabSet } from '@pcbjs/export/internal/fab'
import { bomRows } from '@pcbjs/export/internal/bom'
import { boardSvg } from '@pcbjs/export/internal/svg'
import { schematicSvg } from '@pcbjs/export/internal/sch-svg'
import { boardGlb } from '@pcbjs/export/internal/board-glb'
import { layersFacet, shapesFacet, siteData, siteItems, sourceIndex, type SiteData } from '@pcbjs/export/internal/site-data'
import type { Entry, ResolvedConfig } from './config.js'
import { realm } from '@pcbjs/core/internal/realm'
import { glbInputs, glbMeshes, meshBoundsOf, modelBoxLoader, warnFetching } from './models.js'
import { linkReferences, referenceResolver } from './references.js'
import { previewDir, previewName, previewRoot, withOutline, type PreviewKind } from './preview.js'
import { cacheEnv, cacheOf, fileHash, idOf } from './stage-cache.js'
import type { View } from '@pcbjs/core/internal/plugin'
import { facetStream, keepLast, stageStatus, type FacetOut, type StageStatus } from './facets.js'
import { editedIn, touchedIds, type Spans } from './invalidate.js'

export interface Compiled {
  entry: Entry
  board: Board
  fab: FabSet
  site: SiteData
  /** absent when the compile asked for formats without it */
  svg?: string
  /** the schematic drawing as an SVG, null for a board without one; absent for a preview */
  sch?: string | null
  /** the board in 3D for the renderer and other tools, docs/export.md; absent for a preview */
  glb?: Uint8Array
  ms: number
  /** every stage that ran and its time */
  stages: StageTime[]
  /** every file the compile read, the entry's module graph and the config with its imports */
  files: string[]
  /** a compile of some views only: no fab set, SVG or site data, only the facets it streamed */
  partial?: View[]
}

/** A compiled board without its artifacts, the GLB, the fab set and the drawings: what the session holds, which leaves them in its compile thread. */
export type BoardOut = Omit<Compiled, 'fab' | 'glb' | 'svg' | 'sch'>

/** The path segments of a board's own directory: `[name]`, or `[name, slug]` for one target of a board with variants. */
export function boardDir(board: Pick<Board, 'name' | 'variant'>): string[] {
  return board.variant ? [board.name, variantSlug(board.variant.name)] : [board.name]
}

/** Where a board's files are served: /__pcbjs/<name>/ in dev, fab/<name>/ when built, plus /<slug>/ for a target. */
export function boardUrls(name: string, zipName: string, dev: boolean, slug?: string): { fab: string; svg: string } {
  const n = encodeURIComponent(name)
  const dir = (dev ? `/__pcbjs/${n}` : `fab/${n}`) + (slug ? `/${encodeURIComponent(slug)}` : '')
  return { fab: `${dir}${dev ? '/fab' : ''}/${encodeURIComponent(zipName)}`, svg: `${dir}/${n}.pcb.svg` }
}

/** Where boards.json points for an entry: boards/<name>.json, or boards/<name>/<slug>.json for a target. */
export function boardFile(board: Pick<Board, 'name' | 'variant'>): string {
  const [name, slug] = boardDir(board)
  return slug ? `boards/${encodeURIComponent(name)}/${slug}.json` : `boards/${encodeURIComponent(name)}.json`
}

/** The compile phases of one board in ms, from the timings the compiler attaches; 0 when it has none. */
function phaseSum(b: Board): number {
  const t = b.timings
  return t ? Object.values(t).reduce((a, v) => a + (typeof v === 'number' ? v : 0), 0) : 0
}

/** Every file on disk the entry reached through the module graph, and the config with its imports, by content. */
function evaluatedFiles(loader: ModuleLoader, cfg: ResolvedConfig, entry: string): Record<string, string> {
  const files = [...loader.imported(entry)].filter(f => !f.startsWith('\0') && existsSync(f))
  const out: Record<string, string> = {}
  for (const f of [...new Set([...files, ...cfg.configFiles])].sort()) out[f] = fileHash(f)
  return out
}

export interface EntryOptions {
  /** site data with the dev server's URLs */
  dev?: boolean
  /** a compile of unsaved text: the cache is written in memory only */
  draft?: boolean
  progress?: CompileOptions['progress']
  /** checked between units: a cancelled compile throws CancelledError */
  signal?: CompileOptions['signal']
  /** the views wanted, every one when absent */
  want?: View[]
  /** the export formats built, every one when absent */
  formats?: readonly string[]
  /** each facet as its stage ends */
  facet?: (f: FacetOut) => void
  /** each stage as it starts, ends or hits */
  stage?: (s: StageStatus) => void
}

/** Compile one entry: one Compiled per fab target, a single one for a board without variants. Served from the cache without evaluating when no file it read changed. */
export async function compileEntry(loader: ModuleLoader, cfg: ResolvedConfig, entry: Entry, o: EntryOptions = {}): Promise<Compiled[]> {
  const { dev = false, draft = false, progress, signal } = o
  const want = o.want && demanded(o.want).size < STAGES.length ? o.want : undefined
  const t0 = performance.now()
  const at = new Date().toISOString()
  const formats = exporters(cfg, dev, at).filter(e => !o.formats || o.formats.includes(e.name))
  const dir = cacheOf(cfg.root)
  const env = cacheEnv(cfg, dev)
  const served = draft || cfg.plugins.length ? null : servedStages(dir, entry.rel, { env, exports: exportsKey(formats), defaults: defaultsKey(realm().defaults), hashOf: fileHash })
  if (served) {
    const out = await finish(served, entry, cfg, performance.now() - t0, 0, served[0].files ?? [])
    keepLast(
      cfg.root,
      entry.rel,
      out.map(c => c.board),
    )
    return out
  }
  const stream = o.facet ? facetStream(cfg, entry.rel, dev, at, o.facet) : null
  const pf = patchesFile(entry.file)
  let files: Record<string, string> = {}
  let t1 = t0
  // the evaluate stage: the entry and its patches through the loader, then what the compile keys on, the files they read
  const load = async () => {
    const { root, patches } = await evaluateEntry(loader, entry, existsSync(pf) ? { file: pf, rel: patchesFile(entry.rel) } : null, signal)
    t1 = performance.now()
    files = evaluatedFiles(loader, cfg, entry.file)
    if (patches) Object.assign(files, evaluatedFiles(loader, cfg, pf))
    else files[pf] = 'missing'
    const options: Partial<CompileOptions> = {
      defaults: realm().defaults,
      files: loader.imported(entry.file),
      sourceRoot: cfg.root,
      cache: { dir, draft, entry: entry.rel, files, env },
      ...(patches ? { patches } : {}),
    }
    return { root, options }
  }
  const results = await compileLoaded(load, {
    references: referenceResolver(cfg.root, entry.file),
    modelBox: modelBoxLoader(cfg.root),
    progress,
    signal,
    plugins: cfg.plugins,
    exports: formats,
    ...(want ? { want } : {}),
    ...(o.stage || stream
      ? {
          // a cancelled compile streams nothing more; its next cancel point throws
          stage: e => {
            if (signal?.aborted) return
            o.stage?.(stageStatus(e))
            stream?.(e)
          },
        }
      : {}),
  })
  // a patches file yet to be made stays in the cache's list, so making it misses, and out of the watched files
  const watched = Object.keys(files).filter(f => files[f] !== 'missing')
  if (want) return results.map(({ board, stages }) => ({ entry, board, stages, files: watched, partial: want, ms: performance.now() - t0 }) as unknown as Compiled)
  const out = await finish(results, entry, cfg, t1 - t0, performance.now() - t1, watched)
  keepLast(
    cfg.root,
    entry.rel,
    out.map(c => c.board),
  )
  return out
}

export interface SketchJob {
  /** the edited file and the code the keystroke tier evaluates for it */
  file: string
  code: string
  /** its lines the edit changed, of `code`'s text */
  spans: Spans
  /** the first item id of the sketch, past the ids of the board the viewers hold */
  base: number
  signal?: CompileOptions['signal']
}

/** The keystroke tier's output: the layers and shapes facets of the edited entity alone, on the first target. */
export interface Sketch {
  board: string
  target?: string
  data: Record<string, unknown>
}

/** The keystroke tier, docs/session.md: the entry evaluated by a loader serving the edited file's code, then the geometry of what the changed lines draw; null when they draw nothing. No cache is read or written. */
export async function sketchEntry(loader: ModuleLoader, cfg: ResolvedConfig, entry: Entry, job: SketchJob): Promise<Sketch | null> {
  const { root } = await evaluateEntry(loader, entry, null, job.signal)
  const { board, target } = sketch(root, { defaults: realm().defaults, files: loader.imported(entry.file), sourceRoot: cfg.root, signal: job.signal })
  // as the site data names files: the transform gives them relative to the root, jsxDEV absolute
  const rel = (f: string) => (f.startsWith(cfg.root) ? f.slice(cfg.root.length).replace(/^[\\/]/, '') : f)
  const { uids, refs } = editedIn(sourceIndex(board, rel)[rel(job.file)] ?? [], job.spans)
  const ids = touchedIds(board, uids, refs)
  if (!ids.size) return null
  let id = job.base
  const items = board.items.filter(it => ids.has(it.id)).map(it => ({ ...it, id: id++ }))
  const part = { ...board, items, footprints: board.footprints.filter(fp => refs.has(fp.ref)) }
  const shaped = siteItems(part)
  return { board: board.name, ...(target !== undefined ? { target } : {}), data: { ...layersFacet(part, cfg.root, shaped), ...shapesFacet(part, shaped) } }
}

/** The results as Compiled, references linked and models placed; `load` and `run` the ms of loading the entry and of the compile. */
async function finish(results: CompileResult[], entry: Entry, cfg: ResolvedConfig, load: number, run: number, files: string[]): Promise<Compiled[]> {
  // shared routing runs on the lead target alone, so only loading and flattening are split evenly between targets
  const phases = results.map(r => phaseSum(r.board) + (r.stages.find(s => s.name === 'exports')?.ms ?? 0))
  const shared = (load + Math.max(0, run - phases.reduce((a, c) => a + c, 0))) / results.length
  const out = results.map(({ board, exports, stages }, i) => {
    const out = {
      entry,
      board,
      fab: exports.fab as FabSet,
      site: exports.site as SiteData,
      svg: exports.svg as string,
      sch: exports.sch as string | null,
      glb: exports.glb as Uint8Array,
      ms: shared + phases[i],
      stages,
      files,
    }
    linkReferences(out, cfg.entries)
    return out
  })
  warnFetching(out)
  return out
}

/** What check, a session and a referenced board build: the site data, which links the fab set; the SVGs and the GLB are made when asked for, see svgOf and glbOf. */
export const DATA_FORMATS = ['fab', 'site'] as const

/** The board's SVG, made on first use when its compile did not build it. */
export const svgOf = (c: Compiled): string => (c.svg ??= boardSvg(c.board))
/** The schematic's SVG, null for a board without a drawing, made on first use. */
export const schOf = (c: Compiled): string | null => (c.sch === undefined ? (c.sch = c.board.schematic.drawing ? schematicSvg(c.board) : null) : c.sch)
/** The board in 3D, made on first use: what `shot` renders. */
export const glbOf = (c: Pick<Compiled, 'board' | 'site' | 'glb'>, root: string): Uint8Array => (c.glb ??= boardGlb(c.site, glbMeshes(root, c.board, c.site)))

/** The formats of the exports stage: the fab set, the site data, which links the fab set, and the SVG, each keyed on what it reads beyond the board. */
function exporters(cfg: ResolvedConfig, dev: boolean, at: string): Exporter[] {
  // the exporters run core code too, so a core change alone misses them
  const exp = `${idOf('@pcbjs/export')} ${idOf('@pcbjs/core')}`
  // a fab set without a stated date keeps the date of the compile that made it while its board is unchanged
  const fixed = cfg.fabDate ?? (process.env.SOURCE_DATE_EPOCH ? fabDate() : null)
  const date = fixed ?? fabDate()
  return [
    { name: 'fab', key: JSON.stringify([exp, fixed ?? 'now', cfg.root, !!cfg.fabCheck]), run: board => buildFab(board, date, { root: cfg.root, check: cfg.fabCheck }) },
    { name: 'site', key: JSON.stringify([exp, cfg.root, dev]), inputs: glbInputs, run: (board, done) => siteOf(board, done.fab as FabSet, cfg, dev, at) },
    { name: 'svg', key: exp, run: board => boardSvg(board) },
    { name: 'sch', key: exp, run: board => (board.schematic.drawing ? schematicSvg(board) : null) },
    { name: 'glb', key: exp, inputs: glbInputs, run: (board, done) => boardGlb(done.site as SiteData, glbMeshes(cfg.root, board, done.site as SiteData)) },
  ]
}

function siteOf(board: Board, fab: FabSet, cfg: ResolvedConfig, dev: boolean, generatedAt: string): SiteData {
  const errors = board.drc.filter(d => d.severity === 'error').length + board.erc.filter(d => d.severity === 'error').length
  const urls = boardUrls(board.name, fab.zipName, dev, boardDir(board)[1])
  const site = siteData(board, {
    root: cfg.root,
    dev,
    fabUrl: urls.fab,
    fabName: fab.zipName,
    fabFiles: Object.keys(fab.files).sort(),
    fabStatus: errors || board.unconnected ? 'incomplete' : 'ok',
    svgUrl: urls.svg,
    bom: bomRows(board),
    generatedAt,
    meshBounds: meshBoundsOf(cfg.root),
  })
  return site
}

/** A transient board: the isolated preview of a file no board imports, the first target only. */
export interface Preview {
  file: string
  rel: string
  kind: PreviewKind
  compiled: Compiled
}

/** Compile a file's default export as the board `preview:<rel>`; null when previewRoot cannot show it. */
export async function compilePreview(loader: ModuleLoader, cfg: ResolvedConfig, file: string, rel: string): Promise<Preview | null> {
  const t0 = performance.now()
  if (loader.mapSrc) realm().mapSrc = src => loader.mapSrc!(src)
  const mod = await loader.load(file)
  // the project modules it reaches, for the circuit of a default-exported layout
  const related: Record<string, unknown>[] = []
  for (const f of loader.imported(file)) {
    if (sameFile(f, file) || !under(f, cfg.root) || fileKey(f).includes('/node_modules/')) continue
    try {
      related.push(await loader.load(f))
    } catch {
      /* not needed */
    }
  }
  const found = previewRoot(mod as Record<string, unknown>, related)
  if (!found) return null
  const files = loader.imported(file)
  let [board] = compileBoards(found.root, { files, sourceRoot: cfg.root, references: referenceResolver(cfg.root, file), modelBox: modelBoxLoader(cfg.root) })
  if (found.wrapped && !board.outline.length) [board] = compileBoards(withOutline(found.root, board.bbox), { files, sourceRoot: cfg.root })
  const fab = buildFab(board, undefined, { root: cfg.root })
  const name = previewName(rel)
  board.name = name
  board.title = rel
  const dir = previewDir(rel)
  const errors = board.drc.filter(d => d.severity === 'error').length + board.erc.filter(d => d.severity === 'error').length
  const site = siteData(board, {
    root: cfg.root,
    dev: true,
    fabUrl: `${dir}/fab/${encodeURIComponent(fab.zipName)}`,
    fabName: fab.zipName,
    fabFiles: Object.keys(fab.files).sort(),
    fabStatus: errors || board.unconnected ? 'incomplete' : 'ok',
    svgUrl: `${dir}/board.pcb.svg`,
    bom: bomRows(board),
  })
  site.transient = true
  return { file, rel, kind: found.kind, compiled: { entry: { file, rel }, board, fab, site, svg: boardSvg(board), ms: performance.now() - t0, stages: [], files: [...files] } }
}

export function writeFab(c: Compiled, dir: string): string[] {
  mkdirSync(dir, { recursive: true })
  const names: string[] = []
  for (const [name, text] of Object.entries(c.fab.files)) {
    writeFileSync(join(dir, name), text)
    names.push(name)
  }
  writeFileSync(join(dir, c.fab.zipName), zipFab(c.fab))
  names.push(c.fab.zipName)
  return names
}

export interface Library {
  board: Board
  site: SiteData
}

/** Re-evaluate effective instance parameters, suppressing its own placement overrides for a library view. */
export async function compileLayout(loader: ModuleLoader, cfg: ResolvedConfig, entry: Entry, name: string, target: string | null, ref: string): Promise<Library> {
  const { root } = await evaluateEntry(loader, entry, null)
  const boards = compileBoards(root, {
    library: ref,
    cache: false,
    sourceRoot: cfg.root,
    files: loader.imported(entry.file),
    references: referenceResolver(cfg.root, entry.file),
    modelBox: modelBoxLoader(cfg.root),
    want: ['meta', 'sch', 'layers', 'shapes', 'model'],
  })
  const board = boards.find(b => b.name === name && (target ? b.variant?.name === target : !b.variant || b.variant.index === 0))
  if (!board) throw new Error(`no board ${name} target ${target ?? 'default'}`)
  const options = { root: cfg.root, dev: true, fabUrl: '', fabName: '', fabFiles: [], fabStatus: '', svgUrl: '', bom: [] }
  const site = siteData(board, options)
  const inside = (path: string | undefined) => !!path && (path === ref || path.startsWith(ref + '/'))
  const parts = new Set(site.schematic.parts.filter(p => inside(p.path.join('/')) || p.ref === ref).map(p => p.ref))
  const routes = new Set((site.routes ?? []).filter(r => inside(r.path)).map(r => r.id))
  const ids = new Set((site.items ?? []).filter(it => parts.has(it.ref ?? '') || inside(it.path) || ('route' in it && routes.has(it.route ?? ''))).map(it => it.id))
  const kept = board.items.filter(it => ids.has(it.id))
  const renumber = new Map(kept.map((it, i) => [it.id, i + 1]))
  board.items = kept.map(it => ({ ...it, id: renumber.get(it.id)! }))
  board.footprints = board.footprints.filter(f => parts.has(f.ref)).map(f => ({ ...f, pads: f.pads.flatMap(id => (renumber.has(id) ? [renumber.get(id)!] : [])) }))
  board.outline = []
  board.references = []
  board.ratsnest = []
  board.routes = board.routes?.filter(r => routes.has(r.id))
  board.edit = board.edit?.filter(n => inside(n.ref) || parts.has(n.ref) || routes.has(n.ref))
  board.schematic = {
    ...board.schematic,
    parts: board.schematic.parts.filter(p => parts.has(p.ref)),
    circuits: board.schematic.circuits.map(c => ({ ...c, parts: c.parts.filter(p => parts.has(p)) })),
  }
  const finding = (f: Board['drc'][number]) => (f.refs ?? []).some(r => inside(r) || [...parts].some(p => r === p || r.startsWith(p + '/')))
  board.drc = board.drc.filter(finding)
  board.erc = board.erc.filter(finding)
  const boxes = site.footprints.filter(f => parts.has(f.ref)).map(f => f.bbox)
  if (boxes.length) {
    const x = Math.min(...boxes.map(b => b.x)),
      y = Math.min(...boxes.map(b => b.y))
    board.bbox = { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y }
  }
  return { board, site: siteData(board, options) }
}
