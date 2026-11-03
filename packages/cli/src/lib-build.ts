// `pcbjs build --lib`: the project as an npm package of its parts, circuits, footprints and boards, docs/library.md. The modules of
// `lib.exports` go out as JavaScript with their types, the CLI's transforms applied since a consumer's Vite never transforms
// node_modules; every board of `entries` goes out as data: its facets, reference data, meshes, GLB and posters.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import type { Metafile } from 'esbuild'
import { realm } from '@pcbjs/core/internal/realm'
import { splitSite } from '@pcbjs/core/site-facets'
import { msText } from '@pcbjs/export/internal/findings'
import { configOf, expandEntries, loadUserConfig, type ResolvedConfig } from './project/config.js'
import { compileServer, errorText } from './project/compile.js'
import { compileEntry, type Compiled } from './project/project.js'
import { viteLoader } from './project/loader.js'
import { compileReferenced, REFERENCE_VERSION } from './project/references.js'
import { designFiles, ownDirs } from './project/module-build.js'
import { summaryOf, type CompiledBoard } from './facet-plugin.js'

export interface LibOptions {
  root?: string
  config?: string
  /** the package folder, default dist */
  outDir?: string
  quiet?: boolean
}

export interface LibResult {
  dir: string
  modules: string[]
  boards: string[]
}

/** The `pcbjs.json` of a library: what built it, which `doctor` compares with what is installed. */
export interface LibStamp {
  format: 1
  compile: string
  core: string
}

const require = createRequire(import.meta.url)
const versionOf = (pkg: string): string => JSON.parse(readFileSync(require.resolve(`${pkg}/package.json`), 'utf8')).version
const posix = (p: string) => p.split(sep).join('/')
const slug = (name: string) => name.replace(/[^\w.-]+/g, '-')

/** A peer range of one train: its major.minor, prereleases included. */
export function trainRange(version: string): string {
  const [major, minor] = version.split('.').map(Number)
  return `>=${major}.${minor}.0-0 <${major}.${minor + 1}.0`
}

/** Every part a module makes when it loads: a library exports factories and circuits, never a part every consumer would place. */
export function loadParts(before: ReadonlySet<unknown>, root: string): string[] {
  return realm()
    .registry.parts.filter(p => !before.has(p))
    .map(p => `${p.boundRef ?? p.explicitRef ?? p.label}${p.src ? ` at ${posix(relative(root, p.src.file)) || p.src.file}:${p.src.line}` : ''}`)
}

async function checkExports(cfg: ResolvedConfig, files: string[]): Promise<void> {
  const server = await compileServer(cfg)
  const loader = viteLoader(server)
  realm().mapSrc = loader.mapSrc ?? null
  try {
    for (const f of files) {
      const before = new Set<unknown>(realm().registry.parts)
      await loader.load(f)
      const made = loadParts(before, cfg.root)
      if (made.length)
        throw new Error(
          `${relative(cfg.root, f)} makes ${made.join(', ')} when it loads: a library module exports factories and circuits, so every consumer names its own parts; make ${made.length > 1 ? 'them' : 'it'} inside a circuit or a function`,
        )
    }
  } finally {
    await server.close()
  }
}

/** The modules as ESM in shared chunks, the CLI's transforms applied and every package left external; the packages they import. */
async function buildJs(cfg: ResolvedConfig, files: string[], out: string): Promise<Set<string>> {
  const esbuild = await import('esbuild')
  const res = await esbuild.build({
    absWorkingDir: cfg.root,
    entryPoints: files,
    outdir: out,
    outbase: cfg.root,
    chunkNames: 'chunks/[name]-[hash]',
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'neutral',
    packages: 'external',
    keepNames: true,
    sourcemap: 'linked',
    sourcesContent: true,
    metafile: true,
    target: 'es2022',
    logLevel: 'silent',
    jsx: 'automatic',
    jsxImportSource: '@pcbjs/core',
    plugins: [designFiles(esbuild, cfg.root, ownDirs())],
  })
  const meta = res.metafile as Metafile
  const pkgs = new Set<string>()
  for (const o of Object.values(meta.outputs))
    for (const i of o.imports)
      if (i.external && !i.path.startsWith('.') && !i.path.startsWith('node:')) pkgs.add(i.path.startsWith('@') ? i.path.split('/').slice(0, 2).join('/') : i.path.split('/')[0])
  return pkgs
}

/** The declarations of the modules, by the project's tsconfig. */
function buildTypes(cfg: ResolvedConfig, files: string[], out: string): void {
  const tsconfig = join(cfg.root, 'tsconfig.json')
  const base = existsSync(tsconfig) ? ts.parseJsonConfigFileContent(ts.readConfigFile(tsconfig, ts.sys.readFile).config, ts.sys, cfg.root).options : {}
  const options: ts.CompilerOptions = {
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: '@pcbjs/core',
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    skipLibCheck: true,
    ...base,
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: false,
    composite: false,
    incremental: false,
    allowImportingTsExtensions: false,
    rootDir: cfg.root,
    declarationDir: out,
    outDir: out,
  }
  const program = ts.createProgram(files, options)
  const r = program.emit()
  const errors = [...ts.getPreEmitDiagnostics(program), ...r.diagnostics].filter(d => d.category === ts.DiagnosticCategory.Error)
  if (errors.length)
    throw new Error(
      `the types of the library do not build:\n${ts.formatDiagnostics(errors.slice(0, 10), { getCanonicalFileName: f => f, getCurrentDirectory: () => cfg.root, getNewLine: () => '\n' })}`,
    )
}

/** One board as data: facets, reference data and mesh, GLB, posters, and an index exporting its BoardRef. */
async function writeBoard(c: Compiled, cfg: ResolvedConfig, name: string, out: string): Promise<string> {
  const id = slug(c.board.name)
  const dir = join(out, 'boards', id)
  mkdirSync(dir, { recursive: true })
  const facets = splitSite(c.site)
  for (const [f, data] of Object.entries(facets)) writeFileSync(join(dir, `${f}.json`), JSON.stringify(data))
  const meshes = mkdtempSync(join(tmpdir(), 'pcbjs-lib-'))
  try {
    const { board } = await compileReferenced(c.entry.file, meshes)
    if (board.mesh) copyFileSync(join(meshes, `${board.mesh}.bin`), join(dir, 'mesh.bin'))
    const entry = `${name}/boards/${id}`
    writeFileSync(join(dir, 'reference.json'), JSON.stringify({ format: REFERENCE_VERSION, ...board, entry, files: [], graph: {} }))
  } finally {
    rmSync(meshes, { recursive: true, force: true })
  }
  if (!c.glb || !c.svg) throw new Error(`${c.entry.rel}: the build made no GLB or SVG`)
  writeFileSync(join(dir, 'model.glb'), c.glb)
  writeFileSync(join(dir, '2d.svg'), c.svg)
  if (c.sch) writeFileSync(join(dir, 'sch.svg'), c.sch)
  const summary = summaryOf({ board: c.board.name, facets: { meta: { data: facets.meta, hash: '' }, sch: { data: facets.sch, hash: '' } } } as unknown as CompiledBoard)
  const url = (f: string) => `new URL(${JSON.stringify(`./${f}`)}, import.meta.url).href`
  const facetUrls = Object.keys(facets).map(f => `    ${f}: ${url(`${f}.json`)},`)
  writeFileSync(
    join(dir, 'index.js'),
    [
      `// ${c.board.name}, a board of ${name}, as pcbjs build --lib wrote it: the ref the components of @pcbjs/ui take, its summary and its GLB.`,
      `export const meta = ${JSON.stringify(summary)}`,
      `export const model = ${url('model.glb')}`,
      'export const board = {',
      `  kind: 'pcbjs-board',`,
      '  format: 1,',
      `  entry: ${JSON.stringify(`${name}/boards/${id}`)},`,
      `  board: ${JSON.stringify(c.board.name)},`,
      '  target: null,',
      `  snapshot: ${JSON.stringify(`${c.site.generatedAt ? Date.parse(c.site.generatedAt).toString(16) : '0'}.0`)},`,
      '  summary: meta,',
      '  facets: {',
      ...facetUrls,
      '  },',
      `  poster: { '2d': ${url('2d.svg')}${c.sch ? `, sch: ${url('sch.svg')}` : ''} },`,
      '  model,',
      `  reference: ${url('reference.json')},`,
      '}',
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(dir, 'index.d.ts'),
    "import type { BoardRef, BoardSummary } from '@pcbjs/core/site-facets'\nexport declare const meta: BoardSummary\nexport declare const model: string\nexport declare const board: BoardRef\n",
  )
  return id
}

/** The package.json of the library: the project's name and version, an entry per module and per board, the pcbjs packages as peers of this train. */
function packageJson(cfg: ResolvedConfig, own: Record<string, any>, modules: [string, string][], boards: string[], imports: Set<string>): Record<string, unknown> {
  const exports: Record<string, unknown> = {}
  for (const [key, rel] of modules) exports[key] = { types: `./${rel}.d.ts`, default: `./${rel}.js` }
  for (const b of boards) exports[`./boards/${b}`] = { types: `./boards/${b}/index.d.ts`, pcbjs: `./boards/${b}/reference.json`, default: `./boards/${b}/index.js` }
  exports['./pcbjs.json'] = './pcbjs.json'
  exports['./package.json'] = './package.json'
  const declared: Record<string, string> = { ...own.devDependencies, ...own.peerDependencies, ...own.dependencies }
  const peers: Record<string, string> = { '@pcbjs/core': trainRange(versionOf('@pcbjs/core')) }
  const deps: Record<string, string> = {}
  for (const p of [...imports].sort()) {
    if (p.startsWith('@pcbjs/')) peers[p] = trainRange(versionOf(p))
    else deps[p] = declared[p] ?? '*'
  }
  return {
    name: own.name,
    version: own.version,
    ...(own.description ? { description: own.description } : {}),
    ...(own.license ? { license: own.license } : {}),
    type: 'module',
    exports,
    ...(Object.keys(deps).length ? { dependencies: deps } : {}),
    peerDependencies: peers,
    sideEffects: false,
  }
}

/** Builds the library of the project at `root` into its package folder. */
export async function buildLib(o: LibOptions = {}): Promise<LibResult> {
  process.env.NODE_ENV ??= 'production'
  const started = performance.now()
  // a library of parts alone has no entries
  const loaded = await loadUserConfig('build', o.config, o.root ?? process.cwd())
  const listed = loaded.user.entries ?? []
  const cfg = configOf(loaded, listed.length && loaded.file ? expandEntries(listed, dirname(loaded.file), loaded.shown ?? 'pcb.config.ts') : [])
  const say = (l: string) => {
    if (!o.quiet) console.log(l)
  }
  if (!cfg.lib?.exports) throw new Error("pcbjs build --lib needs lib.exports in the config, such as lib: { exports: { '.': './index.ts' } }; library.md")
  const pkgFile = join(cfg.root, 'package.json')
  const own = existsSync(pkgFile) ? JSON.parse(readFileSync(pkgFile, 'utf8')) : {}
  if (!own.name || !own.version)
    throw new Error(`pcbjs build --lib takes the package name and version from ${relative(process.cwd(), pkgFile) || pkgFile}, which has ${own.name ? 'no version' : 'no name'}`)
  const out = resolve(cfg.root, o.outDir ?? 'dist')
  if (!relative(cfg.root, out) || !relative(out, cfg.root).startsWith('..')) throw new Error(`the library folder ${out} must be inside the project and not hold it`)
  const mods = Object.entries(cfg.lib.exports).map(([key, f]) => {
    const file = resolve(cfg.root, f)
    if (!existsSync(file)) throw new Error(`lib.exports ${JSON.stringify(key)} names ${f}, which does not exist`)
    if (relative(cfg.root, file).startsWith('..')) throw new Error(`lib.exports ${JSON.stringify(key)} names ${f}, outside the project`)
    return { key, file, rel: posix(relative(cfg.root, file)).slice(0, -extname(file).length) }
  })
  const files = mods.map(m => m.file)
  const modules: [string, string][] = mods.map(m => [m.key, m.rel])
  if (files.length) await checkExports(cfg, files)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  const imports = files.length ? await buildJs(cfg, files, out) : new Set<string>()
  if (files.length) buildTypes(cfg, files, out)
  const boards: string[] = []
  const server = await compileServer(cfg)
  try {
    for (const e of cfg.entries) {
      let c: Compiled
      try {
        ;[c] = await compileEntry(viteLoader(server), cfg, e, { formats: ['fab', 'site', 'svg', 'sch', 'glb'] })
      } catch (err) {
        throw new Error(`${e.rel}: ${errorText(err, false, cfg.root).line}`)
      }
      boards.push(await writeBoard(c, cfg, own.name, out))
    }
  } finally {
    await server.close()
  }
  writeFileSync(join(out, 'package.json'), JSON.stringify(packageJson(cfg, own, modules, boards, imports), null, 2) + '\n')
  writeFileSync(join(out, 'pcbjs.json'), JSON.stringify({ format: 1, compile: versionOf('@pcbjs/compile'), core: versionOf('@pcbjs/core') } satisfies LibStamp, null, 2) + '\n')
  say(
    `lib    ${relative(process.cwd(), out) || out}  ${own.name}@${own.version}  ${modules.length} module${modules.length === 1 ? '' : 's'}, ${boards.length} board${boards.length === 1 ? '' : 's'}  ${msText(performance.now() - started)}`,
  )
  return { dir: out, modules: modules.map(([k]) => k), boards }
}
