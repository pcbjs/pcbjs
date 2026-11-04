// A project's config and entries as browser ESM for @pcbjs/compile/browser: the `?pcb:module` facet and scripts/browser-equality.mjs.
// Each file takes the CLI's scope and source range transforms as Vite's SSR applies them, then esbuild bundles with keepNames,
// since Rollup renames a function expression shadowing its own constant and with it the name a part is labelled by. docs/browser.md.
import { sameFile, under } from './files.js'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { Plugin as EsbuildPlugin, Metafile } from 'esbuild'
import { decode, encode, type SourceMapMappings } from '@jridgewell/sourcemap-codec'
import type { BrowserModule } from '@pcbjs/compile/browser'
import { mathKind, type MathKind } from '@pcbjs/compile/internal/fdlibm'
import { patchesFile } from '@pcbjs/core/internal/patch'
import { scopePlugin } from './scope-plugin.js'
import { sourceRangesPlugin, transformSourceRanges } from './source-ranges.js'
import { PKG_DIR } from './vite-base.js'
import type { ResolvedConfig } from './config.js'

/** The virtual project root of a browser compile. */
export const ROOT = '/project'

const sha1 = (b: Uint8Array | string) => createHash('sha1').update(b).digest('hex')
const posix = (p: string) => p.split(sep).join('/')

interface RawMap {
  version: number
  sources: string[]
  sourcesContent?: (string | null)[]
  mappings: string
}

/** The map of code after two transforms, `outer` over `inner`, back to the code before both. */
function composeMaps(outer: RawMap, inner: RawMap): RawMap {
  const lines = decode(inner.mappings)
  const at = (l: number, c: number) => {
    let hit: number[] | null = null
    for (const s of lines[l] ?? []) if (s[0] <= c) hit = s
    return hit && hit.length >= 4 ? hit : null
  }
  const mappings: SourceMapMappings = decode(outer.mappings).map(segs =>
    segs.flatMap(s => {
      const q = s.length >= 4 ? at(s[2]!, s[3]!) : null
      return q ? [[s[0], 0, q[2], q[3] + (s[3]! - q[0])] as [number, number, number, number]] : []
    }),
  )
  return { version: 3, sources: inner.sources, sourcesContent: inner.sourcesContent, mappings: encode(mappings) }
}

type Transform = (code: string, file: string) => { code: string; map: RawMap } | null

/** The transforms of Vite's SSR for a project file: scope injection and source ranges under the root, source ranges alone for a shared file beside it. */
function transformsOf(root: string, own: string[]): Transform[] {
  const asFn = (p: { transform?: unknown }) => (code: string, file: string) => (p.transform as (c: string, id: string) => { code: string; map: RawMap } | null)(code, file)
  const shared: Transform = (code, file) => {
    const rel = relative(root, file)
    if (!rel.startsWith('..') || own.some(d => under(file, d))) return null
    return transformSourceRanges(code, file, posix(rel)) as { code: string; map: RawMap } | null
  }
  return [asFn(scopePlugin(root, own)), asFn(sourceRangesPlugin(root, own, () => null)), shared]
}

/** An esbuild plugin applying the transforms to every design file, then esbuild's own per file, with one composed source map. */
export function designFiles(esbuild: typeof import('esbuild'), root: string, own: string[]): EsbuildPlugin {
  const transforms = transformsOf(root, own)
  return {
    name: 'pcbjs-design-files',
    setup(b) {
      b.onLoad({ filter: /\.tsx?$/ }, async args => {
        if (args.path.includes(`${sep}node_modules${sep}`) || args.path.endsWith('.d.ts') || own.some(d => under(args.path, d))) return undefined
        let code = readFileSync(args.path, 'utf8')
        let map: RawMap | null = null
        for (const t of transforms) {
          const r = t(code, args.path)
          if (!r) continue
          map = map ? composeMaps(r.map, map) : r.map
          code = r.code
        }
        const js = await esbuild.transform(code, {
          loader: args.path.endsWith('x') ? 'tsx' : 'ts',
          sourcefile: args.path,
          sourcemap: 'external',
          target: 'esnext',
          jsx: 'automatic',
          jsxImportSource: '@pcbjs/core',
          jsxDev: false,
        })
        const last = JSON.parse(js.map) as RawMap
        const whole = map ? composeMaps(last, map) : last
        return { contents: `${js.code}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(whole)).toString('base64')}`, loader: 'js' }
      })
    },
  }
}

/** A source path of a built module's map as the browser compile names it: under /project, else as an installed package. */
export function virtualSource(root: string, abs: string): string {
  const rel = relative(root, abs)
  if (!rel.startsWith('..')) return `${ROOT}/${posix(rel)}`
  const p = posix(abs)
  const nm = p.lastIndexOf('/node_modules/')
  if (nm >= 0) return p.slice(nm)
  const pk = p.lastIndexOf('/packages/')
  return pk >= 0 ? `/node_modules/@pcbjs/${p.slice(pk + 10)}` : p
}

/** One built module and the modules it reaches by static import, with the hash of each project source evaluated. */
export interface BuiltModule {
  /** paths in the build output, forward slashes */
  module: string
  modules: string[]
  sources: Record<string, string>
  /** the entry's .patches.ts, built, when it has one */
  patches?: string
}

export interface BuiltProject {
  root: string
  /** every output file by its path in the build output */
  outputs: Map<string, Uint8Array>
  config: BuiltModule | null
  entries: Map<string, BuiltModule>
  math: MathKind
}

/** The pcbjs packages' own code, never a design file. */
export const ownDirs = (): string[] => [resolve(PKG_DIR, '..')]

/** Leaves the pcbjs packages out of a build: an import of one becomes the URL `url` gives its specifier. */
function packagesAt(url: (spec: string) => string): EsbuildPlugin {
  return {
    name: 'pcbjs-packages-at',
    setup(b) {
      b.onResolve({ filter: /^@pcbjs\// }, args => ({ path: url(args.path), external: true }))
    },
  }
}

/**
 * The config and every entry of a project as browser ESM in shared chunks; in memory, or into `outdir` when given.
 * With `packages`, the pcbjs packages stay out and are imported from the URL it gives each specifier, as buildPackages() writes them.
 */
export async function buildModules(cfg: ResolvedConfig, o: { outdir?: string; minify?: boolean; packages?: (spec: string) => string } = {}): Promise<BuiltProject> {
  const esbuild = await import('esbuild')
  const own = ownDirs()
  const root = cfg.root
  const patches = cfg.entries.map(e => patchesFile(e.file)).filter(f => existsSync(f))
  const files = [...(cfg.configFile ? [cfg.configFile] : []), ...cfg.entries.map(e => e.file), ...patches]
  const outdir = o.outdir ?? join(root, '.pcbjs', 'module')
  const res = await esbuild.build({
    absWorkingDir: root,
    entryPoints: files,
    outdir,
    outbase: root,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    splitting: true,
    keepNames: true,
    minify: !!o.minify,
    sourcemap: 'linked',
    // a minified build ships to a page, whose compile maps stack frames by position and never reads the sources
    sourcesContent: !o.minify,
    metafile: true,
    write: false,
    target: 'esnext',
    logLevel: 'silent',
    // a design reading the environment reads none in the browser: a site never ships the build machine's
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    jsx: 'automatic',
    jsxImportSource: '@pcbjs/core',
    plugins: [...(o.packages ? [packagesAt(o.packages)] : []), designFiles(esbuild, root, own)],
  })
  const outputs = new Map<string, Uint8Array>()
  for (const f of res.outputFiles) {
    const rel = posix(relative(outdir, f.path))
    if (!rel.endsWith('.map')) {
      outputs.set(rel, f.contents)
      continue
    }
    const map = JSON.parse(f.text) as RawMap
    map.sources = map.sources.map(s => virtualSource(root, resolve(dirname(f.path), s)))
    outputs.set(rel, new TextEncoder().encode(JSON.stringify(map)))
  }
  const meta = res.metafile as Metafile
  const outRel = (o: string) => posix(relative(outdir, resolve(root, o)))
  const reach = (start: string) => {
    const seen = new Set<string>()
    const stack = [start]
    while (stack.length) {
      const n = stack.pop()!
      if (seen.has(n) || !meta.outputs[n]) continue
      seen.add(n)
      stack.push(...meta.outputs[n].imports.filter(i => i.kind === 'import-statement').map(i => i.path))
    }
    return [...seen]
  }
  const mine = (f: string) => !relative(root, f).startsWith('..') && !f.includes(`${sep}node_modules${sep}`) && !own.some(d => under(f, d))
  const outOf = (file: string) => Object.keys(meta.outputs).find(k => meta.outputs[k].entryPoint && resolve(root, meta.outputs[k].entryPoint!) === file)
  const of = (file: string): BuiltModule => {
    const entry = outOf(file)!
    const pf = outOf(patchesFile(file))
    const chunks = reach(entry)
    const inputs = [...new Set(chunks.flatMap(c => Object.keys(meta.outputs[c].inputs)).map(i => resolve(root, i)))].filter(f => mine(f) && existsSync(f))
    return {
      module: outRel(entry),
      modules: chunks.map(outRel),
      sources: Object.fromEntries(inputs.map(f => [`${ROOT}/${posix(relative(root, f))}`, sha1(readFileSync(f))])),
      ...(pf ? { patches: outRel(pf) } : {}),
    }
  }
  return {
    root,
    outputs,
    config: cfg.configFile ? of(cfg.configFile) : null,
    entries: new Map(cfg.entries.map(e => [e.file, of(e.file)])),
    math: mathKind() ?? 'plain',
  }
}

/** The pcbjs packages the specifiers name as browser ESM in shared chunks, minified, each entry at `<specifier>.js`, resolved from `root`. */
export async function buildPackages(specs: string[], root: string): Promise<Map<string, Uint8Array>> {
  const esbuild = await import('esbuild')
  const res = await esbuild.build({
    absWorkingDir: root,
    entryPoints: specs.map(s => ({ in: s, out: s })),
    outdir: join(root, '.pcbjs', 'packages'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    splitting: true,
    keepNames: true,
    minify: true,
    write: false,
    target: 'esnext',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  return new Map(res.outputFiles.map(f => [posix(relative(join(root, '.pcbjs', 'packages'), f.path)), f.contents]))
}

/** Model files only have to exist for the browser compile; their contents are never read there. */
const MODEL = /\.(step|stp|wrl|vrml|glb|gltf|stl|obj)$/i
/** Sources, built, and pictures and archives, which no compile reads. */
const UNREAD = /\.(tsx?|mts|mjs|js|json|md|html|css|vue|map|png|jpe?g|gif|webp|avif|ico|pdf|zip)$/i

/** Every file of a project the compile may read beside its modules, by path from the root, and whether its contents are needed. */
export function projectFiles(root: string, at = root, out: { rel: string; read: boolean }[] = []): { rel: string; read: boolean }[] {
  for (const e of readdirSync(at, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue
    const f = join(at, e.name)
    if (e.isDirectory()) projectFiles(root, f, out)
    else if (!UNREAD.test(e.name)) out.push({ rel: posix(relative(root, f)), read: !MODEL.test(e.name) })
  }
  return out
}

/** The browser module of one entry, every path made a URL by `url`: built outputs by their output path, project files by their path from the root. */
export function browserModule(
  built: BuiltProject,
  entry: { file: string; rel: string },
  url: { output: (rel: string) => string; file: (rel: string) => string },
  more: Pick<BrowserModule, 'routes' | 'references' | 'meshes' | 'expect' | 'generatedAt'> = {},
): BrowserModule {
  const e = built.entries.get(entry.file) ?? [...built.entries].find(([file]) => sameFile(file, entry.file))?.[1]
  if (!e) throw new Error(`${entry.rel} is no entry of the built project`)
  const files: Record<string, string | null> = Object.fromEntries(projectFiles(built.root).map(f => [`${ROOT}/${f.rel}`, f.read ? url.file(f.rel) : null]))
  // a model with a mesh exists for the compile, fetched ones too, which live under .pcbjs where projectFiles never looks
  for (const p of Object.keys(more.meshes ?? {})) files[p] ??= null
  const modules = [...new Set([...(built.config?.modules ?? []), ...e.modules])]
  return {
    format: 1,
    root: ROOT,
    project: createHash('sha1').update(built.root).digest('hex').slice(0, 12),
    math: built.math,
    entry: entry.rel,
    ...(built.config ? { config: url.output(built.config.module) } : {}),
    module: url.output(e.module),
    ...(e.patches ? { patches: url.output(e.patches) } : {}),
    modules: modules.map(url.output),
    sources: { ...built.config?.sources, ...e.sources },
    files,
    ...more,
  }
}
