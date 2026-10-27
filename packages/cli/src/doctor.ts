import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROUTER_VERSION } from '@pcbjs/compile/route-cache'
import { TUNE_VERSION } from '@pcbjs/compile/tune'
import { REFERENCE_VERSION } from './references.js'
import { findChrome } from './shot.js'
import { findConfig, resolveConfig } from './config.js'
import { installedModels } from '@pcbjs/kicad'
import { fetchedDir, KICAD_3D_TAG } from './fetch-model.js'

export interface InstalledPackage { name: string; version: string; dir: string }

/** The editor extension, which ships inside @pcbjs/cli and is versioned on its own. */
const UNVERSIONED = new Set(['@pcbjs/vscode'])

const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function cliVersion(): string {
  try { return JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf8')).version } catch { return '0.0.0' }
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

/** Every @pcbjs package a project resolves, nearest node_modules first, as Node resolves them. */
export function installedPackages(root: string): InstalledPackage[] {
  const found = new Map<string, InstalledPackage>()
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    const scope = join(dir, 'node_modules', '@pcbjs')
    if (existsSync(scope)) for (const sub of readdirSync(scope).sort()) {
      const name = `@pcbjs/${sub}`
      const pkgFile = join(scope, sub, 'package.json')
      if (found.has(name) || !existsSync(pkgFile)) continue
      try { found.set(name, { name, version: JSON.parse(readFileSync(pkgFile, 'utf8')).version, dir: join(scope, sub) }) } catch {}
    }
    if (dirname(dir) === dir) break
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

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
  } catch { return null }
}

/** Model files under a folder, its LICENSES.md left out. */
function countFiles(dir: string): number {
  try { return readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile() && e.name !== 'LICENSES.md' && !e.name.endsWith('.tmp')).length } catch { return 0 }
}

export async function doctor(o: { config?: string; root?: string; log?: (line: string) => void } = {}): Promise<number> {
  const root = resolve(o.root ?? process.cwd())
  const log = o.log ?? (l => console.log(l))
  const show = (p: string) => (relative(root, p).startsWith('..') ? p : relative(root, p) || '.')
  const row = (k: string, v: string) => log(`${k.padEnd(18)} ${v}`)
  const packages = packagesInUse(root)

  row('pcbjs', `${cliVersion()}  ${show(cliDir)}`)
  row('node', process.version)
  if (!packages.length) row('packages', `none under ${root}; run npm install`)
  for (const p of packages) row(p.name, `${p.version}  ${show(p.dir)}`)
  const chrome = findChrome()
  row('chrome', chrome ?? 'not found; pcbjs shot needs one, set PCBJS_CHROME')
  const wasm = stepConverter()
  row('step converter', wasm ? show(wasm) : 'not found; STEP models will not load, reinstall @pcbjs/step')
  row('formats', `router ${ROUTER_VERSION}, tune ${TUNE_VERSION}, reference ${REFERENCE_VERSION}`)

  const found = o.config ? { file: resolve(root, o.config) } : findConfig(root)
  if (!found) row('config', 'none; pcbjs create <dir> starts a project')
  else {
    row('config', show(found.file))
    try {
      const cfg = await resolveConfig([], 'build', o.config, root, () => {})
      row('entries', cfg.entries.map(e => e.rel).join(', '))
      const lib = installedModels()
      row('kicad models', lib && existsSync(lib) ? show(lib) : `none installed; kicad: models download from KiCad ${KICAD_3D_TAG} on first use`)
      row('fetched models', `${countFiles(fetchedDir(cfg.root))} in ${show(fetchedDir(cfg.root))}; pcbjs model check counts the standard library's parts`)
    } catch (e) { row('entries', `error: ${(e as Error).message.split('\n')[0]}`) }
  }

  const skew = versionSkew(packages)
  if (skew) { log(`\nerror: ${skew}`); return 1 }
  log('\nversions agree')
  return 0
}
