// The pcbjs a workspace has installed, the version skew `pcbjs doctor` reports, and the version the install flow resolves from the
// npm dist-tags of @pcbjs/pcbjs. No vscode here, so the tests run it as it is.

import * as fs from 'node:fs'
import * as path from 'node:path'

export const CORE = '@pcbjs/pcbjs'
export const REGISTRY = 'https://registry.npmjs.org'
export const TAGS = ['latest', 'beta', 'next'] as const
export type Tag = (typeof TAGS)[number]

export interface Installed {
  /** the version of @pcbjs/pcbjs, null when none resolves */
  version: string | null
  /** the folder whose node_modules holds it */
  dir: string | null
  /** doctor's line when the @pcbjs packages disagree on major.minor */
  skew: string | null
  /** the package is a symlink into a source tree, whose version is the last train's */
  linked: boolean
}

/** The editor extension and the renderer have versions of their own, as doctor's UNVERSIONED says. */
const UNVERSIONED = new Set(['@pcbjs/vscode', '@pcbjs/renderer'])

const isLink = (dir: string): boolean => {
  try {
    return fs.lstatSync(dir).isSymbolicLink()
  } catch {
    return false
  }
}

const readVersion = (file: string): string | null => {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')).version
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

/** Every @pcbjs package resolved from dir as Node resolves them, nearest node_modules first, as installedPackages in @pcbjs/cli. */
export function installedPackages(dir: string): { name: string; version: string; dir: string; linked: boolean }[] {
  const found = new Map<string, { name: string; version: string; dir: string; linked: boolean }>()
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    const scope = path.join(d, 'node_modules', '@pcbjs')
    let subs: string[] = []
    try {
      subs = fs.readdirSync(scope).sort()
    } catch {}
    for (const sub of subs) {
      const name = `@pcbjs/${sub}`
      const version = found.has(name) ? null : readVersion(path.join(scope, sub, 'package.json'))
      if (version) found.set(name, { name, version, dir: d, linked: isLink(path.join(scope, sub)) })
    }
    if (path.dirname(d) === d) break
  }
  return [...found.values()]
}

export const minorOf = (v: string): string => /^(\d+)\.(\d+)/.exec(v)?.slice(1, 3).join('.') ?? v

/** The skew rule of versionSkew in @pcbjs/cli's doctor: the packages disagree on major.minor. */
export function skewOf(packages: { name: string; version: string }[]): string | null {
  const versioned = packages.filter(p => !UNVERSIONED.has(p.name))
  if (new Set(versioned.map(p => minorOf(p.version))).size < 2) return null
  return `@pcbjs packages disagree on the version: ${versioned.map(p => `${p.name} ${p.version}`).join(', ')}`
}

export function installed(dir: string): Installed {
  const all = installedPackages(dir)
  const core = all.find(p => p.name === CORE)
  return { version: core?.version ?? null, dir: core?.dir ?? null, skew: skewOf(all), linked: core?.linked ?? false }
}

/** The status bar item's text, colour, command and tooltip for what is installed. */
export function versionStatus(i: Installed, boards: string | null): { text: string; warning: boolean; command: string | null; tooltip: string } {
  if (!i.version)
    return { text: '$(circuit-board) pcbjs: Not installed', warning: false, command: 'pcbjs.install', tooltip: `${CORE} is not installed in this folder. Click to install it.` }
  const tail = boards ? `: ${boards}` : ''
  if (i.skew) return { text: `$(warning) pcbjs ${i.version}${tail}`, warning: true, command: 'pcbjs.install', tooltip: `${i.skew}. Click to install one version of ${CORE}.` }
  // a workspace link carries the last train's number while the tree has moved on, so it reads as a development tree
  if (i.linked)
    return {
      text: `$(circuit-board) pcbjs ${i.version}+dev${tail}`,
      warning: false,
      command: null,
      tooltip: `${CORE} linked from a source tree in ${i.dir}; ${i.version} is the last train it published`,
    }
  return { text: `$(circuit-board) pcbjs ${i.version}${tail}`, warning: false, command: null, tooltip: `${CORE} ${i.version} in ${i.dir}` }
}

/** -1, 0 or 1 by semver precedence, a prerelease before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.split('+')[0].split(/-(.*)/s)
    return { nums: core.split('.').map(Number), pre: pre ? pre.split('.') : [] }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) < (y.nums[i] ?? 0) ? -1 : 1
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1
    if (p === q) continue
    const np = /^\d+$/.test(p)
    const nq = /^\d+$/.test(q)
    if (np && nq) return Number(p) < Number(q) ? -1 : 1
    if (np !== nq) return np ? -1 : 1
    return p < q ? -1 : 1
  }
  return 0
}

export type FetchFn = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>

/** The dist-tags of @pcbjs/pcbjs, null when the registry does not answer within timeoutMs. */
export async function distTags(fetchFn: FetchFn = fetch as unknown as FetchFn, timeoutMs = 4000): Promise<Partial<Record<string, string>> | null> {
  try {
    const res = await fetchFn(`${REGISTRY}/-/package/${CORE}/dist-tags`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    const tags = await res.json()
    return tags && typeof tags === 'object' ? (tags as Record<string, string>) : null
  } catch {
    return null
  }
}

/** What the install flow installs: `npm install -D @pcbjs/pcbjs@<spec>` and the exact version it gives. */
export interface Resolution {
  spec: string
  version: string
  /** the tag it came from, null for the packaged fallback */
  tag: Tag | null
  offline: boolean
}

/** A pre-release build of the extension includes beta and next by default, a release build only on the checkbox. */
export const prereleaseDefault = (packaged: string): boolean => packaged.includes('-')

/** latest, or the newest of latest, beta and next with `prereleases`; the packaged version when the registry gave nothing. */
export function resolveInstall(tags: Partial<Record<string, string>> | null, prereleases: boolean, packaged: string): Resolution {
  const offline = { spec: packaged, version: packaged, tag: null, offline: true }
  if (!tags) return offline
  const pool = (prereleases ? TAGS : (['latest'] as const)).filter(t => typeof tags[t] === 'string') as Tag[]
  if (!pool.length) return offline
  const tag = pool.reduce((best, t) => (compareVersions(tags[t]!, tags[best]!) > 0 ? t : best))
  return { spec: tag, version: tags[tag]!, tag, offline: false }
}

export const installCommand = (r: Resolution): string => `npm install -D ${CORE}@${r.spec}`

/** The folder an install runs in: the nearest with a package.json from the file's folder up to the root, else the root. */
export function installDir(root: string, file?: string): string {
  if (!file) return root
  for (let d = path.dirname(file); d.startsWith(root); d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'package.json'))) return d
    if (d === root || path.dirname(d) === d) break
  }
  return root
}
