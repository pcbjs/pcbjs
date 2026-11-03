import { incidents, readIncident } from './session/incident.js'
import { logDirOf } from './session/paths.js'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { REALM_ABI } from '@pcbjs/core/internal/realm'
import { ROUTER_VERSION } from '@pcbjs/compile/internal/route-cache'
import { TUNE_VERSION } from '@pcbjs/compile/internal/tune'
import { CACHE_FORMAT, compileId } from '@pcbjs/compile/internal/cache'
import { REFERENCE_VERSION } from './project/references.js'
import { findConfig, resolveConfig } from './project/config.js'
import { installedModels } from '@pcbjs/kicad'
import { fetchedDir, KICAD_3D_TAG } from './project/fetch-model.js'
import { installedPackages, type InstalledPackage } from './project/installed.js'
import { cacheSummary } from './model-cache.js'

/** The editor extension, which ships inside @pcbjs/cli, and the renderer, which has releases of its own. */
const UNVERSIONED = new Set(['@pcbjs/vscode', '@pcbjs/renderer'])

export { installedPackages, type InstalledPackage }

const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function cliVersion(): string {
  try {
    return JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf8')).version
  } catch {
    return '0.0.0'
  }
}

/** The dist-tag a version is published under: beta for 0.0.1-beta.2, next for a snapshot, else latest. */
export function distTag(version: string): string {
  return /^\d+\.\d+\.\d+-([A-Za-z]+)/.exec(version)?.[1] ?? 'latest'
}

/** What a new project asks for: a caret on a prerelease also takes next snapshots, so the tag; else the minor a train shares. */
export function installRange(version: string): string {
  const tag = distTag(version)
  return tag === 'latest' ? `~${version.split('.').slice(0, 2).join('.')}.0` : tag
}

/** latest holds the 0.0.0 placeholder while the packages are in beta, so the fix names the running line. */
export const UPDATE_COMMAND = `npm install @pcbjs/pcbjs@${distTag(cliVersion())}`

/** major.minor, so 0.0.1 and 0.0.2 agree and 0.1.0-beta.1 and 0.1.3 agree. */
export function minorOf(version: string): string {
  const m = /^(\d+)\.(\d+)/.exec(version)
  return m ? `${m[1]}.${m[2]}` : version
}

/** Null when every package shares one major.minor, else the line naming each version and the fix. */
export function versionSkew(packages: { name: string; version: string }[]): string | null {
  packages = packages.filter(p => !UNVERSIONED.has(p.name))
  const minors = new Set(packages.map(p => minorOf(p.version)))
  if (minors.size < 2) return null
  const list = packages.map(p => `${p.name} ${p.version}`).join(', ')
  return `@pcbjs packages disagree on the version: ${list}; run ${UPDATE_COMMAND}`
}

/** The installed packages plus the running CLI when it is another copy, such as a global install. */
export function packagesInUse(root: string): InstalledPackage[] {
  const installed = installedPackages(root)
  const own = installed.find(p => p.name === '@pcbjs/cli')
  if (own && realpathSync(own.dir) === realpathSync(cliDir)) return installed
  return [...installed, { name: 'pcbjs (running)', version: cliVersion(), dir: cliDir }]
}

/** The pcbjs libraries installed in a project, each package with a pcbjs.json that `pcbjs build --lib` wrote: its version and the core it was built with. */
export function installedLibraries(root: string): { name: string; version: string; core: string }[] {
  const nm = join(root, 'node_modules')
  if (!existsSync(nm)) return []
  const dirs = readdirSync(nm).flatMap(n => (n.startsWith('@') ? readdirSync(join(nm, n)).map(m => `${n}/${m}`) : [n]))
  const out: { name: string; version: string; core: string }[] = []
  for (const d of dirs) {
    const stamp = join(nm, d, 'pcbjs.json')
    if (d.startsWith('@pcbjs/') || !existsSync(stamp)) continue
    try {
      const p = JSON.parse(readFileSync(join(nm, d, 'package.json'), 'utf8'))
      out.push({ name: p.name, version: p.version, core: JSON.parse(readFileSync(stamp, 'utf8')).core })
    } catch {}
  }
  return out
}

const KEY = Symbol.for('pcbjs.cli.versionWarned')

/** The single warning line for a version skew, printed at most once per process. */
export function warnVersionSkew(root = process.cwd(), warn: (line: string) => void = l => console.warn(l)): void {
  const g = globalThis as any
  if (g[KEY]) return
  g[KEY] = true
  try {
    const skew = versionSkew(packagesInUse(root))
    if (skew) warn(`pcbjs: warning: ${skew}`)
  } catch {}
}

export function stepConverter(): string | null {
  try {
    const step = createRequire(import.meta.url).resolve('@pcbjs/step/package.json')
    const occt = createRequire(step).resolve('occt-import-js')
    const wasm = join(dirname(occt), 'occt-import-js.wasm')
    return existsSync(wasm) ? wasm : null
  } catch {
    return null
  }
}

/** The realm abi of the project's own @pcbjs/core, null when it has none to resolve. */
async function projectAbi(root: string): Promise<number | null> {
  try {
    const file = createRequire(join(root, 'package.json')).resolve('@pcbjs/core/internal/realm')
    return (await import(pathToFileURL(file).href)).REALM_ABI ?? null
  } catch {
    return null
  }
}

/** Model files under a folder, its LICENSES.md left out. */
/** Where @pcbjs/renderer resolves from the cli when the project has no copy of its own, null when nowhere. */
function rendererDir(): string | null {
  try {
    return dirname(fileURLToPath(import.meta.resolve('@pcbjs/renderer')))
  } catch {
    return null
  }
}

function countFiles(dir: string): number {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile() && e.name !== 'LICENSES.md' && !e.name.endsWith('.tmp')).length
  } catch {
    return 0
  }
}

export async function doctor(o: { config?: string; root?: string; desync?: boolean; log?: (line: string) => void } = {}): Promise<number> {
  const root = resolve(o.root ?? process.cwd())
  const log = o.log ?? (l => console.log(l))
  if (o.desync) {
    const last = incidents(root).at(-1)
    if (!last) {
      log(`no desync incident in ${relative(process.cwd(), logDirOf(root)) || logDirOf(root)}`)
      return 0
    }
    log(readIncident(root, last).trimEnd())
    return 0
  }
  const show = (p: string) => (relative(root, p).startsWith('..') ? p : relative(root, p) || '.')
  const row = (k: string, v: string) => log(`${k.padEnd(18)} ${v}`)
  const packages = packagesInUse(root)

  row('pcbjs', `${cliVersion()}  ${show(cliDir)}`)
  row('node', process.version)
  if (!packages.length) row('packages', `none under ${root}; run npm install`)
  for (const p of packages) row(p.name, `${p.version}  ${show(p.dir)}`)
  const core = packages.find(p => p.name === '@pcbjs/core')?.version
  for (const l of installedLibraries(root))
    row(
      l.name,
      `${l.version}  library built with core ${l.core}${core && minorOf(core) !== minorOf(l.core) ? `; warning: core here is ${core}, so its boards may not read: rebuild it or install a version built for ${minorOf(core)}` : ''}`,
    )
  if (!packages.some(p => p.name === '@pcbjs/renderer'))
    row('renderer', rendererDir() ? `@pcbjs/renderer  ${show(rendererDir()!)}` : 'not found; pcbjs shot needs @pcbjs/renderer, reinstall @pcbjs/cli')
  const wasm = stepConverter()
  row('step converter', wasm ? show(wasm) : 'not found; STEP models will not load, reinstall @pcbjs/step')
  row('model cache', cacheSummary())
  row('formats', `cache ${CACHE_FORMAT}, compile ${compileId()}, router ${ROUTER_VERSION}, tune ${TUNE_VERSION}, reference ${REFERENCE_VERSION}, realm ${REALM_ABI}`)

  const found = o.config ? resolve(root, o.config) : findConfig(root)
  if (!found) row('config', 'none; pcbjs create <dir> starts a project')
  else {
    row('config', show(found))
    try {
      const cfg = await resolveConfig([], 'build', o.config, root, () => {})
      row('entries', cfg.entries.map(e => e.rel).join(', '))
      const lib = installedModels()
      row('kicad models', lib && existsSync(lib) ? show(lib) : `none installed; kicad: models download from KiCad ${KICAD_3D_TAG} on first use`)
      row('fetched models', `${countFiles(fetchedDir(cfg.root))} in ${show(fetchedDir(cfg.root))}; pcbjs model check counts the standard library's parts`)
    } catch (e) {
      row('entries', `error: ${(e as Error).message.split('\n')[0]}`)
    }
  }

  const seen = incidents(root)
  row('desync incidents', seen.length ? `${seen.length} in ${show(logDirOf(root))}, the last ${seen.at(-1)}; pcbjs doctor --desync prints it` : 'none')

  const skew = versionSkew(packages)
  if (skew) {
    log(`\nerror: ${skew}`)
    return 1
  }
  const abi = await projectAbi(root)
  if (abi !== null && abi !== REALM_ABI) {
    log(`\nerror: the project's @pcbjs/core has realm abi ${abi} and the running cli's ${REALM_ABI}, so the two cannot share a compile; run ${UPDATE_COMMAND}`)
    return 1
  }
  log('\nversions agree')
  return 0
}
