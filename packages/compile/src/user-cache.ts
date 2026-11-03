// The user-level model cache: converted meshes, board meshes and fetched models shared by every project, which links them into its .pcbjs/models.
import { createHash } from 'node:crypto'
import { accessSync, constants, copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, posix, resolve, sep, win32 } from 'node:path'

/** One cached file; `used`, `added` and `at` in ms since the epoch. */
export interface CacheEntry {
  source: string
  options?: Record<string, string | number>
  note?: string
  size: number
  added: number
  used: number
  /** when the source last gave this content, for a key named by content */
  at?: number
}

/** A cached file by its key, such as `meshes/<hash>.bin`, `boards/<hash>.bin` or `fetched/<sha256>.step`. */
export type CacheRow = CacheEntry & { key: string }

const INDEX = 'index.json'
const KINDS = ['meshes', 'boards', 'fetched', 'downloads']
const INDEX_VERSION = 1
// a hit rewrites the index at most this often per entry
const TOUCH_MS = 3600_000

type Env = Record<string, string | undefined>

/** `PCBJS_CACHE_DIR`, else the platform's user cache directory with pcbjs in it. */
export function cacheDirFor(env: Env, platform: string, home: string): string {
  if (env.PCBJS_CACHE_DIR) return resolve(env.PCBJS_CACHE_DIR)
  if (platform === 'darwin') return posix.join(home, 'Library', 'Caches', 'pcbjs')
  if (platform === 'win32') return win32.join(env.LOCALAPPDATA && win32.isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : win32.join(home, 'AppData', 'Local'), 'pcbjs')
  return posix.join(env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : posix.join(home, '.cache'), 'pcbjs')
}

export const userCacheDir = (): string => cacheDirFor(process.env, process.platform, homedir())

/** The cache's index file, rewritten whenever an entry is added. */
export const cacheIndex = (): string => join(userCacheDir(), INDEX)

// by directory: the directory when it can be written, else null, and whether the fallback was told
const STATE = Symbol.for('pcbjs.userCache')
const state = (): { dirs: Map<string, string | null>; touched: Set<string> } => ((globalThis as any)[STATE] ??= { dirs: new Map(), touched: new Set() })

/** The cache directory, made with mode 0700; null with one line on stderr per process when it cannot be written. */
export function userCache(): string | null {
  const dir = userCacheDir(),
    s = state()
  if (s.dirs.has(dir)) return s.dirs.get(dir)!
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    accessSync(dir, constants.W_OK)
    s.dirs.set(dir, dir)
  } catch (e: any) {
    s.dirs.set(dir, null)
    console.warn(`pcbjs: the model cache ${dir} cannot be written (${e?.code ?? e?.message ?? e}); models stay in each project's .pcbjs/models`)
  }
  return s.dirs.get(dir)!
}

const tmpOf = (file: string) => `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`

/** A hard link of `from` at `to`, or a copy where no link can be made, replacing `to` at once. */
export function linkOrCopy(from: string, to: string): 'link' | 'copy' {
  mkdirSync(dirname(to), { recursive: true })
  const tmp = tmpOf(to)
  try {
    let how: 'link' | 'copy' = 'link'
    try {
      linkSync(from, tmp)
    } catch {
      copyFileSync(from, tmp)
      how = 'copy'
    }
    renameSync(tmp, to)
    return how
  } finally {
    rmSync(tmp, { force: true })
  }
}

const keyPath = (dir: string, key: string) => join(dir, ...key.split('/'))

function readIndex(dir: string): Record<string, CacheEntry> {
  try {
    const j = JSON.parse(readFileSync(join(dir, INDEX), 'utf8'))
    return j?.version === INDEX_VERSION && j.entries && typeof j.entries === 'object' ? j.entries : {}
  } catch {
    return {}
  }
}

function writeIndex(dir: string, entries: Record<string, CacheEntry>): void {
  const file = join(dir, INDEX),
    tmp = tmpOf(file)
  try {
    writeFileSync(tmp, JSON.stringify({ version: INDEX_VERSION, entries }, null, 1) + '\n', { mode: 0o600 })
    renameSync(tmp, file)
  } finally {
    rmSync(tmp, { force: true })
  }
}

function editIndex(dir: string, edit: (entries: Record<string, CacheEntry>) => void): void {
  try {
    const entries = readIndex(dir)
    edit(entries)
    writeIndex(dir, entries)
  } catch {
    /* the index is a record of the files, which ls and prune read too */
  }
}

/** What the index says of a key. */
export function entryOf(key: string): CacheEntry | undefined {
  const dir = userCache()
  return dir ? readIndex(dir)[key] : undefined
}

/** The cached file of a key, or null; a hit counts as a use. */
export function cached(key: string): string | null {
  const dir = userCache()
  if (!dir) return null
  const file = keyPath(dir, key)
  try {
    if (!statSync(file).isFile()) return null
  } catch {
    return null
  }
  touch(dir, key)
  return file
}

function touch(dir: string, key: string): void {
  const s = state(),
    id = `${dir}\0${key}`
  if (s.touched.has(id)) return
  s.touched.add(id)
  const now = Date.now(),
    e = readIndex(dir)[key]
  if (e && now - e.used < TOUCH_MS) return
  editIndex(dir, entries => {
    const size = statSync(keyPath(dir, key)).size
    entries[key] = { ...(entries[key] ?? { source: 'unknown', added: now }), size, used: now }
  })
}

/** Link or copy the cached file of a key to `dest`; false when the cache does not have it. */
export function viewOf(key: string, dest: string): boolean {
  const file = cached(key)
  if (!file) return false
  try {
    linkOrCopy(file, dest)
    return true
  } catch {
    return false
  }
}

function writeBytes(file: string, data: Uint8Array): void {
  const tmp = tmpOf(file)
  try {
    writeFileSync(tmp, data)
    renameSync(tmp, file)
  } finally {
    rmSync(tmp, { force: true })
  }
}

/** Put a file, linked where it can be, or bytes into the cache under a key, and note it in the index; nothing when the cache cannot be written. */
export function store(key: string, from: string | Uint8Array, meta: Pick<CacheEntry, 'source' | 'options' | 'note' | 'at'>): void {
  const dir = userCache()
  if (!dir) return
  const file = keyPath(dir, key)
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    if (typeof from === 'string') linkOrCopy(from, file)
    else writeBytes(file, from)
  } catch {
    return
  }
  const now = Date.now()
  state().touched.add(`${dir}\0${key}`)
  editIndex(dir, entries => {
    entries[key] = { ...meta, size: statSync(file).size, added: entries[key]?.added ?? now, used: now }
  })
}

// strictly increasing, so two stores in one millisecond keep their order
let lastAt = 0

/** Put content under `<kind>/<sha256><ext>`, so another download of the source never replaces it, as the source's newest; returns the key. */
export function storeContent(kind: string, from: string | Uint8Array, ext: string, meta: Pick<CacheEntry, 'source' | 'options' | 'note'>): string | null {
  if (!userCache()) return null
  const hash = createHash('sha256')
    .update(typeof from === 'string' ? readFileSync(from) : from)
    .digest('hex')
  const key = `${kind}/${hash}${ext}`
  lastAt = Math.max(Date.now(), lastAt + 1)
  store(key, from, { ...meta, at: lastAt })
  return key
}

/** The key of the content a source gave last under a kind, by the index, or null. */
export function latestOf(kind: string, source: string): string | null {
  const dir = userCache()
  if (!dir) return null
  let best: string | null = null,
    when = -1
  for (const [key, e] of Object.entries(readIndex(dir))) {
    const t = e.at ?? e.added
    if (!key.startsWith(`${kind}/`) || e.source !== source || t <= when || !existsSync(keyPath(dir, key))) continue
    best = key
    when = t
  }
  return best
}

/** Every cached file, from the folders themselves so a lost index loses only sources and dates. */
export function cacheRows(dir = userCacheDir()): CacheRow[] {
  const index = readIndex(dir)
  const rows: CacheRow[] = []
  for (const kind of KINDS) {
    let list: string[] = []
    try {
      list = readdirSync(join(dir, kind), { recursive: true }) as string[]
    } catch {
      continue
    }
    for (const rel of list) {
      if (rel.endsWith('.tmp')) continue
      const file = join(dir, kind, rel)
      let st
      try {
        st = statSync(file)
      } catch {
        continue
      }
      if (!st.isFile()) continue
      const key = `${kind}/${rel.split(sep).join('/')}`
      const e = index[key]
      rows.push({ ...e, source: e?.source ?? 'unknown', added: e?.added ?? st.mtimeMs, used: e?.used ?? st.mtimeMs, size: st.size, key })
    }
  }
  return rows.sort((a, b) => b.used - a.used)
}

export interface PruneOptions {
  /** days since the last use */
  older?: number
  /** MB the cache keeps at most, the least recently used going first */
  maxSize?: number
  all?: boolean
  now?: number
}

/** Remove cached files by age, to a size, or all; the projects keep their own links. */
export function pruneCache(o: PruneOptions, dir = userCacheDir()): { removed: CacheRow[]; kept: CacheRow[] } {
  const now = o.now ?? Date.now()
  const rows = cacheRows(dir)
  const gone = new Set<CacheRow>()
  for (const r of rows) if (o.all || (o.older !== undefined && now - r.used > o.older * 86400_000)) gone.add(r)
  if (o.maxSize !== undefined) {
    let total = rows.filter(r => !gone.has(r)).reduce((a, r) => a + r.size, 0)
    for (const r of [...rows].reverse()) {
      if (total <= o.maxSize * 1e6) break
      if (gone.has(r)) continue
      gone.add(r)
      total -= r.size
    }
  }
  for (const r of gone) rmSync(keyPath(dir, r.key), { force: true })
  if (gone.size) editIndex(dir, entries => gone.forEach(r => delete entries[r.key]))
  return { removed: rows.filter(r => gone.has(r)), kept: rows.filter(r => !gone.has(r)) }
}

/** Bytes of every cached file. */
export const cacheSize = (dir = userCacheDir()): number => cacheRows(dir).reduce((a, r) => a + r.size, 0)
