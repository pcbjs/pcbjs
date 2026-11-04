// What the CLI tells the compiler's stage cache: where it is, the files an entry evaluated by content, and what else the evaluation read.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { packageId } from '@pcbjs/compile/internal/cache'
import type { ResolvedConfig } from './config.js'

/** `.pcbjs/cache` of a project. */
export const cacheOf = (root: string): string => join(root, '.pcbjs', 'cache')

// by path, with the size and mtime it was hashed at
const hashes = new Map<string, { stamp: string; sha: string }>()

/** A file's sha1 by content, 'missing' when it is gone; rehashed only when its size or mtime moved. */
export function fileHash(file: string): string {
  let stamp: string
  try {
    const s = statSync(file)
    stamp = `${s.size}:${s.mtimeMs}`
  } catch {
    return 'missing'
  }
  const hit = hashes.get(file)
  if (hit?.stamp === stamp) return hit.sha
  let sha = 'missing'
  try {
    sha = createHash('sha1').update(readFileSync(file)).digest('hex')
  } catch {
    /* gone between the stat and the read */
  }
  hashes.set(file, { stamp, sha })
  return sha
}

const require = createRequire(import.meta.url)
/** An installed package's id: its version, and its dist hash when it is a workspace link. */
export const idOf = (name: string): string => {
  try {
    return packageId(dirname(require.resolve(`${name}/package.json`)))
  } catch {
    return 'none'
  }
}

/** What an evaluation reads beyond its files: environment variables, the Vite mode and the @pcbjs packages the project installs. */
export function cacheEnv(cfg: ResolvedConfig, dev: boolean): string {
  const vars = Object.keys(process.env)
    .sort()
    .map(k => `${k}=${process.env[k]}`)
  return JSON.stringify([dev ? 'dev' : 'build', createHash('sha256').update(JSON.stringify(vars)).digest('hex'), installed(cfg.root)])
}

/** `@pcbjs/<name>@<version>` of each package under the nearest node_modules/@pcbjs dirs, as Node resolves them. */
function installed(root: string): string[] {
  const seen = new Map<string, string>()
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    const scope = join(dir, 'node_modules', '@pcbjs')
    let subs: string[] = []
    try {
      subs = readdirSync(scope)
    } catch {
      /* none here */
    }
    for (const sub of subs.sort()) {
      if (seen.has(sub)) continue
      try {
        seen.set(sub, JSON.parse(readFileSync(join(scope, sub, 'package.json'), 'utf8')).version)
      } catch {
        /* not a package */
      }
    }
    if (dirname(dir) === dir) break
  }
  return [...seen].map(([n, v]) => `${n}@${v}`)
}
