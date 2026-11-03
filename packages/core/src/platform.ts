// What the compiler reaches outside JavaScript: files, hashing, paths, the environment and the cache on disk, see docs/design.md.
// Node's by default; a browser compile installs one over files in memory. On globalThis, since copies of pcbjs may share a realm.
import { sha1 as jsSha1 } from './sha1.js'
import { posixPath, type PathApi } from './posix.js'

export type { PathApi }

export interface FileStat {
  file: boolean
  dir: boolean
  /** bytes */
  size: number
  /** ms since the epoch, 0 where files do not change */
  mtime: number
}

/** A writable folder tree, Node's disk; a platform without one keeps every cache in memory. */
export interface Store {
  /** atomic: a reader sees the whole file or none; folders made, a failure ignored so a read-only project still compiles */
  write(file: string, data: string | Uint8Array): void
  /** a file or a folder with everything in it, missing or not */
  remove(file: string): void
  gzip(text: string): Uint8Array
  /** throws on bytes that are not gzip */
  gunzip(data: Uint8Array): string
}

export interface Platform {
  name: 'node' | 'browser'
  /** 40 hex; a string as its UTF-8 bytes */
  sha1(data: string | Uint8Array): string
  /** null when missing or unreadable */
  read(file: string): Uint8Array | null
  /** UTF-8, a byte order mark kept; null when missing or unreadable */
  text(file: string): string | null
  exists(file: string): boolean
  stat(file: string): FileStat | null
  /** the names in a folder, null when it is not one */
  list(dir: string): string[] | null
  realpath(file: string): string
  path: PathApi
  /** a file: URL as a path */
  fromUrl(url: string): string
  cwd(): string
  home(): string
  env(name: string): string | undefined
  store: Store | null
  /** the source of a stack frame of evaluated code, applied before callerSite filters frames; Node's maps after, through Vite */
  frame?(at: { file: string; line: number; col: number }): { file: string; line: number; col: number } | null
}

type NodeMods = {
  fs: typeof import('node:fs')
  path: typeof import('node:path')
  url: typeof import('node:url')
  zlib: typeof import('node:zlib')
  crypto: typeof import('node:crypto')
  os: typeof import('node:os')
}

function nodeMods(): NodeMods | null {
  const p = (globalThis as any).process
  if (!p || typeof p.getBuiltinModule !== 'function') return null
  try {
    const m = (n: string) => p.getBuiltinModule(`node:${n}`)
    return { fs: m('fs'), path: m('path'), url: m('url'), zlib: m('zlib'), crypto: m('crypto'), os: m('os') }
  } catch {
    return null
  }
}

const attempt = <T>(fn: () => T, none: T): T => {
  try {
    return fn()
  } catch {
    return none
  }
}

/** Node's files, crypto, paths and disk, as the compiler has always used them. */
export function nodePlatform(): Platform | null {
  const n = nodeMods()
  if (!n) return null
  const { fs, path } = n
  const proc = (globalThis as any).process
  const store: Store = {
    write(file, data) {
      const tmp = `${file}.${proc.pid}.${Math.random().toString(36).slice(2)}.tmp`
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(tmp, data)
        fs.renameSync(tmp, file)
      } catch {
        attempt(() => fs.rmSync(tmp, { force: true }), undefined)
      }
    },
    remove: file => fs.rmSync(file, { recursive: true, force: true }),
    gzip: text => n.zlib.gzipSync(text, { level: 1 }),
    gunzip: data => n.zlib.gunzipSync(data).toString('utf8'),
  }
  return {
    name: 'node',
    sha1: data => n.crypto.createHash('sha1').update(data).digest('hex'),
    read: file => attempt(() => new Uint8Array(fs.readFileSync(file)), null),
    text: file => attempt(() => fs.readFileSync(file, 'utf8'), null),
    exists: file => fs.existsSync(file),
    stat: file =>
      attempt(() => {
        const s = fs.statSync(file)
        return { file: s.isFile(), dir: s.isDirectory(), size: s.size, mtime: s.mtimeMs }
      }, null),
    list: dir => attempt(() => fs.readdirSync(dir), null),
    realpath: file => fs.realpathSync(file),
    path,
    fromUrl: url => n.url.fileURLToPath(url),
    cwd: () => proc.cwd(),
    home: () => n.os.homedir(),
    env: name => proc.env[name],
    store,
  }
}

/** A file by virtual path: its bytes or text, or null for a file that only has to exist, such as a model the browser never reads. */
export type MemoryFile = Uint8Array | string | null

export interface MemoryOptions {
  /** every file the compile may read, by absolute POSIX path */
  files?: Record<string, MemoryFile>
  /** default `/project` */
  cwd?: string
  env?: Record<string, string>
  frame?: Platform['frame']
}

const utf8 = new TextEncoder()
const decoder = new TextDecoder('utf-8', { ignoreBOM: true })

/** Files in memory, POSIX paths, a JavaScript SHA-1 and no disk: what a browser compile runs on. */
export function memoryPlatform(o: MemoryOptions = {}): Platform {
  const cwd = o.cwd ?? '/project'
  const files = new Map(Object.entries(o.files ?? {}))
  const path = posixPath(() => cwd)
  const key = (f: string) => path.resolve(f)
  const bytes = (f: string): Uint8Array | null => {
    const v = files.get(key(f))
    return v === undefined || v === null ? null : typeof v === 'string' ? utf8.encode(v) : v
  }
  const isDir = (d: string) => {
    const pre = key(d).replace(/\/?$/, '/')
    for (const f of files.keys()) if (f.startsWith(pre)) return true
    return false
  }
  const list = (d: string): string[] | null => {
    if (!isDir(d)) return null
    const pre = key(d).replace(/\/?$/, '/')
    const names = new Set<string>()
    for (const f of files.keys()) if (f.startsWith(pre)) names.add(f.slice(pre.length).split('/')[0])
    return [...names].sort()
  }
  return {
    name: 'browser',
    sha1: jsSha1,
    read: bytes,
    text: f => {
      const v = files.get(key(f))
      return typeof v === 'string' ? v : v ? decoder.decode(v) : null
    },
    exists: f => files.has(key(f)) || isDir(f),
    stat: f => (files.has(key(f)) ? { file: true, dir: false, size: bytes(f)?.length ?? 0, mtime: 0 } : isDir(f) ? { file: false, dir: true, size: 0, mtime: 0 } : null),
    list,
    realpath: key,
    path,
    fromUrl: url => decodeURIComponent(new URL(url).pathname),
    cwd: () => cwd,
    home: () => '/',
    env: name => o.env?.[name],
    store: null,
    ...(o.frame ? { frame: o.frame } : {}),
  }
}

const KEY = Symbol.for('pcbjs.platform')

/** The platform this realm compiles on: the one set, else Node's in Node, else an empty one in memory. */
export function platform(): Platform {
  const g = globalThis as any
  return (g[KEY] ??= nodePlatform() ?? memoryPlatform())
}

/** Install a platform for every copy of pcbjs in this realm; null goes back to the default. */
export function setPlatform(p: Platform | null): void {
  ;(globalThis as any)[KEY] = p ?? undefined
}
