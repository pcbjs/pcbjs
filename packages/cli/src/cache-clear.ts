// pcbjs cache clear: delete the caches of every project under the folders, while no session serves them.
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { findScopes } from './session/scopes.js'
import { liveSession } from './session/start.js'
import { sizeText } from './model-cache.js'

export interface CacheClearOptions {
  /** searched for projects as `--workspace` searches them; the working directory without any */
  folders: string[]
  /** also `.pcbjs/models`: model meshes, board meshes and fetched models */
  models?: boolean
  /** clear even while a live session serves a project */
  force?: boolean
  log?: (line: string) => void
}

/** The cache paths of a project: the stage cache, route memos, references and Vite deps, the type-check cache, and the models with `models`. */
export const cachePaths = (dir: string, models: boolean): string[] => [
  join(dir, '.pcbjs', 'cache'),
  join(dir, '.pcbjs', 'typecheck.json'),
  ...(models ? [join(dir, '.pcbjs', 'models')] : []),
]

/** Bytes under a path, symbolic links counted as themselves. */
export function sizeOf(p: string): number {
  const st = lstatSync(p, { throwIfNoEntry: false })
  if (!st) return 0
  if (!st.isDirectory()) return st.size
  return readdirSync(p).reduce((n, name) => n + sizeOf(join(p, name)), 0)
}

/** The folders themselves and every project under them. */
export function projectDirs(folders: string[]): string[] {
  const roots = (folders.length ? folders : ['.']).map(f => resolve(f))
  return [...new Set([...roots, ...findScopes(roots).map(s => s.dir)])]
}

/** Exit 1 when a live session serves a project and `force` is off, else 0 once every cache path is gone. */
export async function cacheClear(o: CacheClearOptions): Promise<number> {
  const log = o.log ?? (l => console.log(l))
  const dirs = projectDirs(o.folders)
  if (!o.force) {
    for (const d of dirs) {
      const s = await liveSession(d)
      if (s) {
        log(`session ${s.session}, pid ${s.pid}, serves ${d}: stop it with pcbjs session stop, or pass --force`)
        return 1
      }
    }
  }
  let total = 0
  let count = 0
  for (const p of dirs.flatMap(d => cachePaths(d, !!o.models))) {
    if (!existsSync(p)) continue
    const size = sizeOf(p)
    rmSync(p, { recursive: true, force: true })
    log(`removed ${p}  ${sizeText(size)}`)
    total += size
    count++
  }
  log(`removed ${count} path${count === 1 ? '' : 's'}, ${sizeText(total)}, from ${dirs.length} folder${dirs.length === 1 ? '' : 's'}`)
  return 0
}
