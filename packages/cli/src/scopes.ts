import { readdirSync, statSync } from 'node:fs'
import { basename, relative, resolve, sep } from 'node:path'
import { captureDefaults, installDefaults, type DefaultsSnapshot } from '@pcbjs/core/defaults'
import { findConfig } from './config.js'

export interface ScopeInfo {
  /** the URL segment: the config directory relative to its workspace folder, slugged; the folder's name for the folder itself */
  slug: string
  /** the config directory, absolute */
  dir: string
  /** the workspace folder it was found under */
  folder: string
  /** `dir` relative to `folder` with forward slashes, '' for the folder itself */
  rel: string
  configFile: string
}

/** Names that never hold a scope: dependencies, generated output and hidden directories. */
const skipDir = (name: string): boolean => name === 'node_modules' || name.startsWith('.')

/** Path segments a scope slug may not take: the viewer's own routes and what Vite serves from the viewer's root. */
const RESERVED = new Set(['board', 'src', 'assets', 'node_modules', 'public', 'index.html', 'dev3d.html'])

/** A URL segment for a scope: each path segment kept to letters, digits, dot, dash and underscore, joined by dashes. */
export function slugOf(rel: string, folder: string): string {
  const raw = rel ? rel : basename(resolve(folder))
  let s =
    raw
      .split('/')
      .map(p => p.replace(/[^A-Za-z0-9._-]+/g, '-'))
      .join('-')
      .replace(/^[-._]+|-+$/g, '') || 'project'
  if (RESERVED.has(s)) s += '-project'
  return s
}

/** Every directory with a pcb.config.* or pcbjs.config.* under the folders, in path order, skipping hidden dirs and symbolic links. */
export function findScopes(folders: string[], maxDepth = 8): ScopeInfo[] {
  const out: ScopeInfo[] = []
  const taken = new Set<string>()
  const seen = new Set<string>()
  for (const f of folders) {
    const folder = resolve(f)
    const walk = (dir: string, depth: number) => {
      if (seen.has(dir)) return
      seen.add(dir)
      let names: { name: string; dir: boolean }[]
      try {
        names = readdirSync(dir, { withFileTypes: true }).map(d => ({ name: d.name, dir: d.isDirectory() }))
      } catch {
        return
      }
      const config = findConfig(dir, file => names.some(n => !n.dir && n.name === basename(file)))
      if (config) {
        const rel = relative(folder, dir).split(sep).join('/')
        let slug = slugOf(rel, folder)
        for (let i = 2; taken.has(slug); i++) slug = `${slugOf(rel, folder)}-${i}`
        taken.add(slug)
        out.push({ slug, dir, folder, rel, configFile: config.file })
      }
      if (depth >= maxDepth) return
      for (const n of names.filter(n => n.dir && !skipDir(n.name)).sort((a, b) => a.name.localeCompare(b.name))) walk(resolve(dir, n.name), depth + 1)
    }
    walk(folder, 0)
  }
  return out
}

/** The scope a file belongs to: the deepest scope directory that holds it, null when none does. */
export function scopeOf<S extends Pick<ScopeInfo, 'dir'>>(scopes: S[], file: string): S | null {
  let best: S | null = null
  for (const s of scopes) {
    const d = s.dir.endsWith(sep) ? s.dir : s.dir + sep
    if ((file === s.dir || file.startsWith(d)) && (!best || s.dir.length > best.dir.length)) best = s
  }
  return best
}

/** Size and modification time of each file, to tell later whether any changed. */
export function stampFiles(files: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>()
  for (const f of files) {
    try {
      const s = statSync(f)
      out.set(f, `${s.size}:${s.mtimeMs}`)
    } catch {
      out.set(f, 'missing')
    }
  }
  return out
}

/** True when a file stamped by stampFiles changed or went away since. */
export function changedSince(stamps: Map<string, string>): boolean {
  for (const [f, v] of stampFiles(stamps.keys())) if (stamps.get(f) !== v) return true
  return false
}

export const NO_DEFAULTS: DefaultsSnapshot = { board: null, rules: null }

/** Run `fn` with a scope's defaults installed, since they are one registry per process, and keep what it left; calls must not overlap. */
export async function withDefaults<T>(holder: { defaults: DefaultsSnapshot | null }, fn: () => Promise<T>): Promise<T> {
  const before = captureDefaults()
  installDefaults(holder.defaults ?? NO_DEFAULTS)
  try {
    return await fn()
  } finally {
    holder.defaults = captureDefaults()
    installDefaults(before)
  }
}
