// `import layers from './pcb.tsx?pcb:layers'`: a board module's facets as ES modules for a site built with Vite. A worker thread per
// project compiles, or in dev the live session serving the project; an edit to a file the board read updates its facet modules. docs/ui.md.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin, ViteDevServer } from 'vite'
import { checkHash, facetKey } from '@pcbjs/compile/browser'
import {
  facetHash,
  FACET_NAMES,
  IMPORT_FACETS,
  splitSite,
  type BoardRef,
  type BoardSummary,
  type FacetHeader,
  type FacetName,
  type Facets,
  type ImportFacet,
  type ModelFacet,
} from '@pcbjs/core/site-facets'
import { findConfig, resolveConfig } from './project/config.js'
import { browserModule, buildModules, buildPackages, ROOT, type BuiltProject } from './project/module-build.js'
import { posterSvg } from './server/poster.js'
import { meshFor, modelsDir } from './project/models.js'
import { boardMeshDir, referenceResolver } from './project/references.js'
import type { SiteReference } from '@pcbjs/core/internal/reference'
import type { BrowserModule } from '@pcbjs/compile/browser'
import { workerCompiler } from './session/worker-client.js'
import { liveSession } from './session/start.js'
import { proxySession, sameOrigin } from './session/endpoint.js'
import { connectSession, type SessionConn } from './session/client.js'
import type { Compiler } from './project/compiler.js'
import type { Compiled } from './project/project.js'
import type { FacetOut } from './project/facets.js'
import { parseSnapshot } from '@pcbjs/core/protocol'

export interface PcbjsPluginOptions {
  /** what `?pcb:board` ships in a build: 'data', the default, the facets as JSON files; 'compile' the poster and the board's module, compiled in the page's worker */
  boards?: 'data' | 'compile'
  /** ask a live session in dev; default true */
  session?: boolean
}

/** One compile of a board target as the facet modules use it. */
export interface CompiledBoard {
  entry: string
  board: string
  target: string | null
  /** the session's run, or the compiles so far of the project's own worker */
  run: number
  /** of every facet's hash */
  hash: string
  facets: Partial<Record<FacetName, { data: Record<string, unknown>; hash: string }>>
  posters: { '2d'?: string; sch?: string | null }
  /** every file the compile read, for HMR */
  files: string[]
  /** the stages the compile ran or took from the cache, none from a session */
  stages: string[]
  via: 'worker' | 'session'
  /** the entries its reference() calls compiled, absolute */
  references: string[]
  /** the target compiled, the first one for a null target of a board with variants */
  variant: string | null
}

interface Project {
  root: string
  configFile: string
  compiler: Compiler | null
  session: Promise<SessionConn | null> | null
  /** compiles so far */
  n: number
}

/** DATA_FORMATS of project/project.ts, which this module does not load into a site's Vite process */
const DATA_FORMATS = ['fab', 'site']

const QUERY = /\?pcb:([a-z]+)((?:&[^&=]+=[^&]*)*)$/

/** The facet a module id asks for, its file and options; null for any other id. */
export function parseFacetId(id: string): { file: string; facet: string; target: string | null; view: '2d' | 'sch' } | null {
  const m = QUERY.exec(id)
  if (!m) return null
  const params = new URLSearchParams(m[2].replace(/^&/, ''))
  return { file: id.slice(0, m.index), facet: m[1], target: params.get('target'), view: params.get('view') === 'sch' ? 'sch' : '2d' }
}

/** The project of a module: the nearest pcb.config.* above it, as for an entry. */
function projectRoot(file: string): { root: string; configFile: string } {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    const configFile = findConfig(dir)
    if (configFile) return { root: dir, configFile }
    if (dirname(dir) === dir) throw new Error(`no pcb.config.* above ${file}`)
  }
}

/** The content of a compile's facets, from their hashes. */
const facetsHash = (facets: CompiledBoard['facets']): string => facetHash(Object.entries(facets).map(([f, x]) => `${f}:${x!.hash}`))

/** Where a page of this server reaches a live session, by project. */
const SESSION_PROXY = '/@pcbjs/session/'

const keyOf = (file: string, target: string | null) => `${file}\0${target ?? ''}`
const short = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12)

/** The compiles behind the facet modules: one worker thread per project, made on first use; `serving` lets a live session answer. */
export function facetCompiler(o: { session?: boolean; log?: (line: string) => void } = {}) {
  const projects = new Map<string, Project>()
  const log = o.log ?? ((l: string) => console.warn(`[pcbjs] ${l}`))
  let serving = false
  const projectOf = (file: string): Project => {
    const { root, configFile } = projectRoot(file)
    let p = projects.get(root)
    if (!p) projects.set(root, (p = { root, configFile, compiler: null, session: null, n: 0 }))
    return p
  }

  /** The facets a live session holds of an entry it compiles, null when none serves it or it is no entry there. */
  async function viaSession(p: Project, file: string, target: string | null, want: FacetName[]): Promise<CompiledBoard | null> {
    p.session ??= liveSession(p.root)
      .then(info => (info ? connectSession(info.socket, { name: 'pcbjs vite', role: 'cli', project: p.root, token: info.token }) : null))
      .catch(() => null)
    const conn = await p.session
    if (!conn) return null
    try {
      const r = await conn.request('session/facets', { entry: file, target, facets: want })
      const facets = Object.fromEntries(r.facets.map(f => [f.facet, { data: f.data, hash: f.hash }]))
      const board = r.facets[0]?.board ?? ''
      return {
        entry: file,
        board,
        target,
        run: parseSnapshot(r.snapshot)?.run ?? 0,
        hash: facetsHash(facets),
        facets,
        posters: {},
        files: r.files,
        stages: [],
        via: 'session',
        references: [],
        variant: r.facets[0]?.target ?? target,
      }
    } catch {
      return null
    }
  }

  async function viaWorker(p: Project, file: string, target: string | null, want: FacetName[] | null): Promise<CompiledBoard> {
    p.compiler ??= workerCompiler({ root: p.root, configFile: p.configFile, log })
    const streamed: FacetOut[] = []
    const entry = { file, rel: relative(p.root, file).split(sep).join('/') }
    const out = await p.compiler.compile(entry, {
      draft: false,
      dev: false,
      // as check compiles, so the stage cache serves either from the other; the posters add the SVGs
      formats: want ? DATA_FORMATS : [...DATA_FORMATS, 'svg', 'sch'],
      ...(want ? { want } : {}),
      facet: f => streamed.push(f),
    })
    const c = target === null ? out[0] : out.find(k => k.board.variant?.name === target)
    if (!c) throw new Error(`${entry.rel} has no target ${target}; its targets are ${out.map(k => k.board.variant?.name ?? '(none)').join(', ')}`)
    const facets: CompiledBoard['facets'] = c.site
      ? Object.fromEntries(Object.entries(splitSite(c.site)).map(([f, data]) => [f, { data, hash: c.hashes[f as FacetName]! }]))
      : Object.fromEntries(streamed.filter(f => (f.target ?? null) === (c.board.variant?.name ?? null)).map(x => [x.facet, { data: x.data, hash: x.hash }]))
    const files = [...new Set([...p.compiler.imported(file), ...c.files])].filter(f => !f.startsWith('\0'))
    return {
      entry: file,
      board: c.board.name,
      target,
      run: ++p.n,
      hash: facetsHash(facets),
      facets,
      posters: want
        ? {}
        : posterOf(
            await p.compiler.artifact(c.run, c.board.name, c.board.variant?.name ?? null, 'svg'),
            await p.compiler.artifact(c.run, c.board.name, c.board.variant?.name ?? null, 'sch'),
          ),
      files,
      stages: c.stages.map(s => s.name),
      via: 'worker',
      references: (c.board.references ?? []).map(r => r.entry),
      variant: c.board.variant?.name ?? null,
    }
  }

  return {
    /** Dev: a live session serving a project may answer its data facets. */
    serve() {
      serving = o.session !== false
    },
    /** One compile of `file` at `target` holding `want`, or every facet with the posters for null. */
    async compile(file: string, target: string | null, want: FacetName[] | null): Promise<CompiledBoard> {
      const p = projectOf(file)
      if (serving && want) {
        const s = await viaSession(p, file, target, want)
        if (s && want.every(f => s.facets[f])) return s
      }
      return viaWorker(p, file, target, want)
    },
    /** Dev: true when a live session compiles `file` as one of its entries, so a page may follow its stream. */
    async serves(file: string, target: string | null): Promise<boolean> {
      return serving && !!(await viaSession(projectOf(file), file, target, ['meta']))
    },
    /** Files changed on disk: the threads evaluate them again. */
    changed(files: string[]) {
      for (const p of projects.values()) p.compiler?.changed(files)
    },
    workers: () => [...projects.values()].filter(p => p.compiler).length,
    async close() {
      for (const p of projects.values()) {
        await p.compiler?.close()
        ;(await p.session)?.close()
      }
      projects.clear()
    },
  }
}
export type FacetCompiler = ReturnType<typeof facetCompiler>

const posterOf = (svg: Compiled['svg'], sch: Compiled['sch']): CompiledBoard['posters'] => ({
  ...(svg ? { '2d': posterSvg(svg) } : {}),
  ...(sch !== undefined ? { sch: sch && posterSvg(sch) } : {}),
})

/** What a page shows of a board before its facets load, from its meta facet. */
export function summaryOf(b: CompiledBoard): BoardSummary {
  const m = (b.facets.meta?.data ?? {}) as Record<string, any>
  const vb: number[] = m.viewBox ?? [0, 0, 1, 1]
  const page: number[] | undefined = (b.facets.sch?.data as any)?.schematic?.drawing?.page
  return {
    name: m.name ?? b.board,
    title: m.title ?? '',
    rev: m.rev ?? '',
    copper: m.copper ?? 2,
    bbox: m.bbox ?? { x: 0, y: 0, w: 0, h: 0 },
    aspect: { '2d': vb[2] / vb[3], ...(page ? { sch: (page[2] - page[0]) / (page[3] - page[1]) } : {}) },
    counts: { footprints: m.footprints?.length ?? 0, nets: m.nets?.length ?? 0 },
  }
}

/** The page half of `boards: 'compile'`, imported by its file from the board modules. */
const RUNTIME = fileURLToPath(new URL('./board-compile.js', import.meta.url))

/** The module build of a project: its config's entries and `also`, minified, so its boards share one set of chunks; `packages` as buildModules takes it. */
async function moduleBuild(root: string, also: string[], packages?: (spec: string) => string): Promise<BuiltProject> {
  const log = () => {}
  const listed = (await resolveConfig([], 'build', undefined, root, log)).entries.map(e => e.rel)
  const rels = [...new Set([...listed, ...also.map(f => relative(root, f).split(sep).join('/'))])]
  return buildModules(await resolveConfig(rels, 'build', undefined, root, log), { minify: true, ...(packages ? { packages } : {}) })
}

/** The compile worker of @pcbjs/export as one ES module for the page's `new Worker`, built with esbuild as the design modules are. */
async function workerBundle(): Promise<Uint8Array> {
  const esbuild = await import('esbuild')
  const r = await esbuild.build({
    entryPoints: [fileURLToPath(import.meta.resolve('@pcbjs/export/browser-worker'))],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    keepNames: true,
    minify: true,
    write: false,
    target: 'esnext',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  return r.outputFiles[0].contents
}

/** A referenced board as the browser compile reads it: its entry virtual, no build machine paths. */
const virtualRef = (root: string, entry: string): string => posix.resolve(ROOT, relative(root, entry).split(sep).join('/'))

/** The facets an import needs compiled: null for every one with the posters. */
const wantOf = (facet: ImportFacet): FacetName[] | null => (FACET_NAMES.includes(facet as FacetName) ? [facet as FacetName] : null)

/**
 * The Vite plugin of the `?pcb:` imports: `meta`, `sch`, `layers`, `model`, `findings` and `fab` as JSON data, `board` as the ref
 * the components of @pcbjs/ui take, `poster` as the URL of the board's SVG, `&view=sch` its schematic; `&target=` picks a variant.
 */
export function pcbjs(opts: PcbjsPluginOptions = {}): Plugin {
  const compiler = facetCompiler({ session: opts.session })
  let build = false
  let ssr = false
  /** the last compile of each file and target, and the facet modules that read it */
  const boards = new Map<string, Promise<CompiledBoard>>()
  const readers = new Map<string, Set<string>>()
  const byShort = new Map<string, string>()
  // a load waits one turn so the facets of one board imported together compile once
  const batch = new Map<string, { want: Set<FacetName> | null; done: Promise<CompiledBoard> }>()
  let server: ViteDevServer | null = null
  // dev: the project of each session path a board ref names
  const sessions = new Map<string, string>()
  /** Dev: where a page reaches the live session compiling a board, through this server, and the scope of its project there. */
  async function sessionOf(b: CompiledBoard): Promise<BoardRef['session'] | null> {
    const root = projectRoot(b.entry).root
    const info = (await compiler.serves(b.entry, b.target)) ? await liveSession(root) : null
    if (!info) return null
    const k = short(root)
    sessions.set(k, root)
    const seg = /^\/([^/]+)\//.exec(new URL(info.url).pathname)?.[1]
    return { path: `${SESSION_PROXY}${k}`, scope: seg ? decodeURIComponent(seg) : null }
  }
  let base = '/'
  /** the module build of each project, made on first use, made again when a file outside it asks */
  const builds = new Map<string, { files: Set<string>; job: Promise<BuiltProject> }>()
  let runtime: Promise<Uint8Array> | null = null
  /** build: the meshes the module facets name, by hash */
  const used = new Map<string, { file: string; root: string }>()
  const boardMeshes = new Map<string, string>()
  /** build: the pcbjs packages the module builds import, written once for every project under pcb/lib/, and a root to resolve them from */
  const packages = new Set<string>()
  let packagesRoot: string | null = null
  const packageUrl = (root: string) => (spec: string) => {
    packages.add(spec)
    packagesRoot ??= root
    return `${base}pcb/lib/${spec}.js`
  }
  /** dev: what /@pcbjs/module/ serves; build: the assets emitted, each once */
  const served = new Map<string, () => Uint8Array | null>()
  const emitted = new Set<string>()
  /** the references of the files the facet modules emitted */
  const assets = new Set<string>()

  /** The URL of a file of the module facet: an asset of a fixed name in a build, served from memory in dev. */
  function fileUrl(ctx: { emitFile: (f: { type: 'asset'; fileName: string; source: Uint8Array }) => string }, name: string, bytes: () => Uint8Array | null): string {
    if (!build) {
      served.set(name, bytes)
      return `/@pcbjs/module/${name}`
    }
    if (!emitted.has(name)) {
      emitted.add(name)
      const source = bytes()
      if (source) ctx.emitFile({ type: 'asset', fileName: name, source })
    }
    return base + name
  }

  /** The browser module of a compiled board: its sources built for the browser, its files, route memo and references, and Node's facet hashes. */
  async function moduleFor(ctx: Parameters<typeof fileUrl>[0], b: CompiledBoard): Promise<BrowserModule> {
    const { root } = projectRoot(b.entry)
    let p = builds.get(root)
    if (!p?.files.has(b.entry)) {
      const files = new Set([...(p?.files ?? []), b.entry])
      builds.set(root, (p = { files, job: moduleBuild(root, [...files], build ? packageUrl(root) : undefined) }))
    }
    const built = await p.job
    const entry = { file: b.entry, rel: relative(root, b.entry).split(sep).join('/') }
    // the folder names the build, so a later build of more entries never meets an earlier one's files
    const k = short([built.root, ...built.entries.keys()].join('\0'))
    const put = (path: string, bytes: () => Uint8Array | null) => fileUrl(ctx, `pcb/${k}/${path}`, bytes)
    const json = (v: unknown) => () => new TextEncoder().encode(JSON.stringify(v))
    // every output, the source maps the worker reads beside the modules it imports
    for (const rel of built.outputs.keys()) put(rel, () => built.outputs.get(rel) ?? null)
    const memo = join(built.root, '.pcbjs', 'cache', 'route', `${b.board}.json`)
    // the memo without its indentation, which the page never reads
    const routes = existsSync(memo) ? { [b.board]: put(`routes/${b.board}.json`, json(JSON.parse(readFileSync(memo, 'utf8')))) } : null
    const resolver = b.references.length ? referenceResolver(built.root, b.entry) : null
    const references = Object.fromEntries(
      b.references.map(e => {
        // a library's prebuilt board, by the package name reference() gives it, which the file records as its entry
        if (e.endsWith('.json')) {
          const board = JSON.parse(readFileSync(e, 'utf8')) as { entry: string }
          return [board.entry, put(`references/${short(e)}.json`, json(board))]
        }
        const v = virtualRef(built.root, e)
        return [v, put(`references/${short(e)}.json`, json({ ...resolver!.resolve(e), entry: v, files: [], graph: {} }))]
      }),
    )
    const generatedAt = (b.facets.meta?.data as { generatedAt?: string } | undefined)?.generatedAt
    const meshes = meshesOf(b, built.root)
    return browserModule(
      built,
      entry,
      { output: rel => put(rel, () => built.outputs.get(rel) ?? null), file: rel => put(`files/${rel}`, () => readFileSync(join(built.root, rel))) },
      {
        ...(routes ? { routes } : {}),
        ...(b.references.length ? { references } : {}),
        ...(Object.keys(meshes).length ? { meshes } : {}),
        // the project root as the browser compile names it
        expect: Object.fromEntries(
          Object.entries(b.facets).map(([f, x]) => [facetKey(b.board, b.variant ?? undefined, f), checkHash(JSON.parse(JSON.stringify(x!.data).split(built.root).join(ROOT)))]),
        ),
        ...(generatedAt ? { generatedAt } : {}),
      },
    )
  }

  /** The STEP models of a board inside its project, by virtual path to the hash Node gave their content; a build writes each mesh once as models/<hash>.bin, a referenced board's as models/boards/<hash>.bin. */
  function meshesOf(b: CompiledBoard, root: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const m of (b.facets.model?.data as ModelFacet | undefined)?.models ?? []) {
      const file = m.step?.file && resolve(root, m.step.file)
      if (!file || !m.step?.mesh || relative(root, file).startsWith('..')) continue
      out[posix.join(ROOT, relative(root, file).split(sep).join('/'))] = m.step.mesh
      if (build) used.set(m.step.mesh, { file, root })
    }
    // a referenced board's mesh is megabytes with its part bodies, so compile mode, which ships as little as it can, leaves it out
    for (const r of (b.facets.meta?.data as { references?: SiteReference[] } | undefined)?.references ?? []) {
      const file = r.mesh && join(boardMeshDir(root), `${r.mesh}.bin`)
      if (build && opts.boards !== 'compile' && file && existsSync(file)) boardMeshes.set(r.mesh!, file)
    }
    return out
  }

  async function workerUrl(ctx: Parameters<typeof fileUrl>[0]): Promise<string> {
    runtime ??= workerBundle()
    const bytes = await runtime
    return fileUrl(ctx, 'pcb/runtime/browser-worker.js', () => bytes)
  }

  function compiled(file: string, target: string | null, facet: ImportFacet): Promise<CompiledBoard> {
    const key = keyOf(file, target)
    const want = wantOf(facet)
    const had = boards.get(key)
    const open = batch.get(key)
    if (open) {
      if (want && open.want) want.forEach(f => open.want!.add(f))
      else open.want = null
      return open.done
    }
    const run = (async () => {
      const last = had ? await had.catch(() => null) : null
      if (last && (want ? want.every(f => last.facets[f]) : last.posters['2d'] !== undefined)) return last
      await new Promise(r => setTimeout(r, 0))
      const asked = batch.get(key)!.want
      batch.delete(key)
      const next = compiler.compile(file, target, asked ? [...new Set([...asked, ...Object.keys(last?.facets ?? {})] as FacetName[])] : null)
      boards.set(key, next)
      return next
    })()
    batch.set(key, { want: want ? new Set(want) : null, done: run })
    return run
  }

  const endpoint = (b: CompiledBoard, name: string) => {
    const k = short(keyOf(b.entry, b.target))
    byShort.set(k, keyOf(b.entry, b.target))
    return `/@pcbjs/facet/${k}/${name}?run=${b.run}&h=${b.hash}`
  }

  return {
    name: 'pcbjs:facets',
    enforce: 'pre',
    api: { workers: () => compiler.workers(), boards },
    // a facet file's URL under the base, also in an SSR build, whose own would be a file: URL of its output folder
    resolveFileUrl({ referenceId, fileName }) {
      return ssr && assets.has(referenceId) ? JSON.stringify(base + fileName) : null
    },
    configResolved(c) {
      build = c.command === 'build'
      ssr = !!c.build.ssr
      base = c.base || '/'
      if (!build) compiler.serve()
    },
    async resolveId(id, importer) {
      const q = parseFacetId(id)
      if (!q) return null
      const r = await this.resolve(q.file, importer, { skipSelf: true })
      return r ? r.id.split('?')[0] + id.slice(q.file.length) : null
    },
    async load(id) {
      const q = parseFacetId(id)
      if (!q) return null
      if (!IMPORT_FACETS.includes(q.facet as ImportFacet)) this.error(`?pcb:${q.facet} is no facet; the facets are ${IMPORT_FACETS.join(', ')}`)
      const facet = q.facet as ImportFacet
      const b = await compiled(q.file, q.target, facet)
      const key = keyOf(q.file, q.target)
      ;(readers.get(key) ?? readers.set(key, new Set()).get(key)!).add(id)
      for (const f of b.files) this.addWatchFile(f)
      const header = (f: ImportFacet, hash: string): FacetHeader => ({ entry: b.entry, board: b.board, target: b.target, facet: f, run: b.run, hash })
      const head = (f: ImportFacet, hash: string) => `export const header = ${JSON.stringify(header(f, hash))}\n`
      const emit = (name: string, source: string) => {
        const id = this.emitFile({ type: 'asset', name, source })
        assets.add(id)
        return `import.meta.ROLLUP_FILE_URL_${id}`
      }
      const asset = (name: string, source: string) => (build ? emit(name, source) : JSON.stringify(endpoint(b, name)))
      const slug = b.target ? `${b.board}-${b.target}` : b.board
      if (facet === 'poster') {
        const svg = q.view === 'sch' ? b.posters.sch : b.posters['2d']
        if (!svg) this.error(`${relative(process.cwd(), q.file)} has no ${q.view === 'sch' ? 'schematic drawing' : 'board SVG'}`)
        return `${head(facet, facetHash(svg))}export default ${asset(`${slug}${q.view === 'sch' ? '.sch' : ''}.svg`, svg!)}\n`
      }
      if (facet === 'module') {
        const mod = await moduleFor(this, b)
        return `${head(facet, facetHash(mod as unknown as Record<string, unknown>))}export default JSON.parse(${JSON.stringify(JSON.stringify(mod))})\n`
      }
      if (facet === 'board') {
        const ref: Omit<BoardRef, 'facets' | 'poster'> = {
          kind: 'pcbjs-board',
          format: 1,
          entry: b.entry,
          board: b.board,
          target: b.target,
          run: b.run,
          summary: summaryOf(b),
          ...(build ? {} : { live: true }),
        }
        const session = build ? null : await sessionOf(b)
        if (session) ref.session = session
        const board2d = `'2d': ${asset(`${slug}.svg`, b.posters['2d'] ?? '')}`
        if (build && opts.boards === 'compile') {
          // the board's poster now, the facets and so the schematic from the page's compile worker: the mode ships as little as it can
          const posters = [board2d]
          const mod = await moduleFor(this, b)
          const url = fileUrl(this, `pcb/${short(b.entry)}/${slug}.module.json`, () => new TextEncoder().encode(JSON.stringify(mod)))
          const worker = await workerUrl(this)
          return `${head(facet, b.hash)}import { compileBoard } from ${JSON.stringify(RUNTIME)}\nconst board = { ...${JSON.stringify({ ...ref, facets: {}, module: url })}, poster: { ${posters.join(', ')} } }\ncompileBoard(board, ${JSON.stringify(worker)})\nexport default board\n`
        }
        meshesOf(b, projectRoot(b.entry).root)
        const posters = [board2d, ...(b.posters.sch ? [`sch: ${asset(`${slug}.sch.svg`, b.posters.sch)}`] : [])]
        const facets = Object.entries(b.facets).map(([f, x]) => `${JSON.stringify(f)}: ${asset(`${slug}.${f}.json`, JSON.stringify(x!.data))}`)
        const hot = build ? '' : `if (import.meta.hot) {\n  import.meta.hot.accept()\n  globalThis[Symbol.for('pcbjs.boards')]?.live(board)\n}\n`
        return `${head(facet, b.hash)}const board = { ...${JSON.stringify(ref)}, facets: { ${facets.join(', ')} }, poster: { ${posters.join(', ')} } }\nexport default board\n${hot}`
      }
      const x = b.facets[facet as FacetName]!
      return `${head(facet, x.hash)}export default JSON.parse(${JSON.stringify(JSON.stringify(x.data))})\n`
    },
    configureServer(s) {
      server = s
      // a live ref's store follows its session as a viewer, on the session socket reached through this server, its own origin
      s.httpServer?.on('upgrade', (req, socket, head) => {
        const at = (req.url ?? '').split('?')[0]
        if (!at.startsWith(SESSION_PROXY)) return
        const root = sessions.get(at.slice(SESSION_PROXY.length))
        if (!root || !sameOrigin(req)) return void socket.destroy()
        void liveSession(root).then(info => (info ? proxySession(req, socket, head, info.url) : socket.destroy()))
      })
      s.middlewares.use('/@pcbjs/module/', (req, res, next) => {
        const bytes = served.get(decodeURIComponent((req.url ?? '').split('?')[0].replace(/^\//, '')))?.()
        if (!bytes) return next()
        const type = /\.m?js$/.test(req.url ?? '') ? 'text/javascript' : /\.(json|map)$/.test(req.url ?? '') ? 'application/json' : 'application/octet-stream'
        res.setHeader('content-type', type)
        res.setHeader('cache-control', 'no-cache')
        res.end(bytes)
      })
      s.middlewares.use('/@pcbjs/facet/', (req, res, next) => {
        const [k, name] = (req.url ?? '').split('?')[0].split('/').filter(Boolean)
        const key = byShort.get(k)
        const b = key ? boards.get(key) : undefined
        if (!b || !name) return next()
        b.then(
          board => {
            const m = /^(?:.*?)\.(\w+)\.json$/.exec(name)
            const body = m ? JSON.stringify(board.facets[m[1] as FacetName]?.data ?? null) : name.endsWith('.sch.svg') ? board.posters.sch : board.posters['2d']
            if (body == null) return next()
            res.setHeader('content-type', m ? 'application/json' : 'image/svg+xml')
            res.setHeader('cache-control', 'no-cache')
            res.end(body)
          },
          () => next(),
        )
      })
    },
    async handleHotUpdate(ctx) {
      const hit: string[] = []
      for (const [key, b] of boards) {
        const board = await b.catch(() => null)
        if (board && !board.files.includes(ctx.file) && board.entry !== ctx.file) continue
        hit.push(key)
      }
      if (!hit.length) return
      compiler.changed([ctx.file])
      builds.clear()
      const mods = new Set(ctx.modules)
      for (const key of hit) {
        boards.delete(key)
        for (const id of readers.get(key) ?? []) {
          const m = server?.moduleGraph.getModuleById(id)
          if (m) {
            server!.moduleGraph.invalidateModule(m)
            mods.add(m)
          }
        }
      }
      return [...mods]
    },
    async generateBundle() {
      for (const [hash, { file, root }] of used) {
        const name = `models/${hash}.bin`
        if (emitted.has(name)) continue
        emitted.add(name)
        try {
          this.emitFile({ type: 'asset', fileName: name, source: await meshFor(hash, file, modelsDir(root)) })
        } catch (e) {
          this.warn(`model ${relative(root, file)}: ${(e as Error).message}; the page draws the generated model`)
        }
      }
      for (const [hash, file] of boardMeshes) {
        const name = `models/boards/${hash}.bin`
        if (emitted.has(name)) continue
        emitted.add(name)
        this.emitFile({ type: 'asset', fileName: name, source: readFileSync(file) })
      }
      if (!packages.size || emitted.has('pcb/lib/')) return
      emitted.add('pcb/lib/')
      for (const [rel, source] of await buildPackages([...packages].sort(), packagesRoot!)) this.emitFile({ type: 'asset', fileName: `pcb/lib/${rel}`, source })
    },
    // a build ends here, and so does a dev server's close
    async closeBundle() {
      await compiler.close()
    },
  }
}

/** A board's facets in Node, as the plugin compiles them: for a data loader or a test. */
export async function resolveBoard(file: string, o: { target?: string; facets?: FacetName[] } = {}): Promise<{ header: Omit<FacetHeader, 'facet' | 'hash'>; facets: Facets }> {
  const c = facetCompiler({ session: false })
  try {
    const b = await c.compile(resolve(file), o.target ?? null, o.facets ?? [...FACET_NAMES])
    const facets: Facets = Object.fromEntries(Object.entries(b.facets).map(([f, x]) => [f, x!.data]))
    return { header: { entry: b.entry, board: b.board, target: b.target, run: b.run }, facets }
  } finally {
    await c.close()
  }
}
