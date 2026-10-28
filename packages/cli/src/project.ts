import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ViteDevServer } from 'vite'
import { compileBoards, CompileError, type CompileOptions } from '@pcbjs/compile'
import { variantSlug } from '@pcbjs/core/variants'
import type { Board } from '@pcbjs/core/model'
import { buildFab, fabDate, zipFab, type FabSet } from '@pcbjs/export/fab'
import { bomRows } from '@pcbjs/export/bom'
import { boardSvg } from '@pcbjs/export/svg'
import { siteData, type SiteData } from '@pcbjs/export/site-data'
import type { Entry, ResolvedConfig } from './config.js'
import { setSourceMapper } from '@pcbjs/core/schematic'
import { siteMarkers } from '@pcbjs/export/findings'
import { modelBoxLoader, placeModels } from './models.js'
import { linkReferences, referenceResolver } from './references.js'
import { previewDir, previewName, previewRoot, withOutline, type PreviewKind } from './preview.js'

/** Map a position in the code Vite evaluated back to the source through Vite's own stack rewriting, for where parts are declared. */
function sourceMapper(server: ViteDevServer) {
  return (src: { file: string; line: number; col: number }) => {
    const e = new Error()
    e.stack = `Error\n    at f (${src.file}:${src.line}:${src.col})`
    server.ssrFixStacktrace(e)
    const m = /\((.+):(\d+):(\d+)\)\s*$/.exec(e.stack.split('\n')[1] ?? '')
    return m ? { file: m[1], line: Number(m[2]), col: Number(m[3]) } : src
  }
}

/** Every file the entry reaches through the SSR module graph, itself included, for scoping out-of-line sourcing rules. */
export function importedFiles(server: ViteDevServer, file: string): Set<string> {
  const graph = server.environments?.ssr?.moduleGraph ?? (server as any).moduleGraph
  const seen = new Set<string>([file])
  const stack = [...(graph.getModulesByFile(file) ?? [])]
  const visited = new Set<unknown>()
  while (stack.length) {
    const m: any = stack.pop()
    if (!m || visited.has(m)) continue
    visited.add(m)
    if (m.file) seen.add(m.file)
    for (const d of m.importedModules ?? []) stack.push(d)
  }
  return seen
}

export interface Compiled {
  entry: Entry
  board: Board
  fab: FabSet
  site: SiteData
  svg: string
  ms: number
}

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

/** Compile one entry: one Compiled per fab target, a single one for a board without variants. A `draft` leaves the route files as they are; `progress` follows the router. */
export async function compileEntry(
  server: ViteDevServer,
  cfg: ResolvedConfig,
  entry: Entry,
  dev: boolean,
  draft = false,
  progress?: CompileOptions['progress'],
): Promise<Compiled[]> {
  const t0 = performance.now()
  setSourceMapper(sourceMapper(server))
  const mod = await server.ssrLoadModule(entry.file, { fixStacktrace: true })
  let root = mod.default
  if (typeof root === 'function') root = root()
  root = await root
  if (!root) throw new CompileError(`${entry.rel} has no default export (export default <PCB …>)`)
  const t1 = performance.now()
  const boards = compileBoards(root, {
    files: importedFiles(server, entry.file),
    routeCache: { dir: join(cfg.root, '.pcbjs', 'routes'), draft },
    references: referenceResolver(cfg.root, entry.file),
    modelBox: modelBoxLoader(cfg.root),
    progress,
  })
  const t2 = performance.now()
  // shared routing runs on the lead target alone, so only loading and flattening are split evenly between targets
  const phases = boards.map(b => phaseSum(b))
  const shared = (t1 - t0 + Math.max(0, t2 - t1 - phases.reduce((a, c) => a + c, 0))) / boards.length
  const out = boards.map((board, i) => {
    const ms = shared + phases[i]
    const t3 = performance.now()
    const fab = buildFab(board, cfg.fabDate ?? fabDate(), { root: cfg.root, check: cfg.fabCheck })
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
    })
    site.editor = { ...cfg.editor }
    site.drc = siteMarkers(board, board.drc, cfg.root)
    site.erc = siteMarkers(board, board.erc, cfg.root)
    const out = { entry, board, fab, site, svg: boardSvg(board), ms: ms + performance.now() - t3 }
    linkReferences(out, cfg.entries)
    return out
  })
  // model files: their extent and how they sit on the courtyard, converted once per content
  await placeModels(out, cfg.root)
  return out
}

/** A transient board: the isolated preview of a file no board imports, the first target only. */
export interface Preview {
  file: string
  rel: string
  kind: PreviewKind
  compiled: Compiled
}

/** Compile a file's default export as the board `preview:<rel>`; null when previewRoot cannot show it. */
export async function compilePreview(server: ViteDevServer, cfg: ResolvedConfig, file: string, rel: string): Promise<Preview | null> {
  const t0 = performance.now()
  setSourceMapper(sourceMapper(server))
  const mod = await server.ssrLoadModule(file, { fixStacktrace: true })
  // the project modules it reaches, for the circuit of a default-exported layout
  const related: Record<string, unknown>[] = []
  for (const f of importedFiles(server, file)) {
    if (f === file || !f.startsWith(cfg.root) || f.includes('/node_modules/')) continue
    try {
      related.push(await server.ssrLoadModule(f))
    } catch {
      /* not needed */
    }
  }
  const found = previewRoot(mod as Record<string, unknown>, related)
  if (!found) return null
  const files = importedFiles(server, file)
  let [board] = compileBoards(found.root, { files, references: referenceResolver(cfg.root, file), modelBox: modelBoxLoader(cfg.root) })
  if (found.wrapped && !board.outline.length) [board] = compileBoards(withOutline(found.root, board.bbox), { files })
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
  site.editor = { ...cfg.editor }
  site.drc = siteMarkers(board, board.drc, cfg.root)
  site.erc = siteMarkers(board, board.erc, cfg.root)
  site.transient = true
  return { file, rel, kind: found.kind, compiled: { entry: { file, rel }, board, fab, site, svg: boardSvg(board), ms: performance.now() - t0 } }
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
