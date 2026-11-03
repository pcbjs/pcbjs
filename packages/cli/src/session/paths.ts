// Where a session keeps its files: dev.json, the lock and the log under each project's .pcbjs, the socket or pipe, the repository record.
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** past 100 bytes a UNIX socket path no longer fits macOS's sun_path */
const SUN_PATH = 100

export const real = (p: string): string => {
  try {
    return realpathSync(resolve(p))
  } catch {
    return resolve(p)
  }
}

export const devJsonOf = (root: string): string => join(root, '.pcbjs', 'dev.json')
export const lockOf = (root: string): string => join(root, '.pcbjs', 'session.lock')
export const logDirOf = (root: string): string => join(root, '.pcbjs', 'log')
export const logOf = (root: string): string => join(logDirOf(root), 'session.log')

/** First 16 hex characters of SHA-256. */
export const hash16 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16)

const userName = (): string => {
  let name = ''
  try {
    name = userInfo().username
  } catch {}
  return (name || process.env.USERNAME || process.env.USER || 'user').toLowerCase().replace(/[^a-z0-9]/g, '') || 'user'
}

const tmpRuntimeDir = (): string => join(tmpdir(), `pcbjs-${typeof process.getuid === 'function' ? String(process.getuid()) : userName()}`)

/** The 0700 directory for the long-path socket and the repository records. */
export function runtimeDir(): string {
  const xdg = process.env.XDG_RUNTIME_DIR
  return ownDir(xdg && process.platform !== 'win32' ? join(xdg, 'pcbjs') : tmpRuntimeDir())
}

/** `dir` made 0700 and checked to be this user's. */
function ownDir(dir: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') {
    const st = statSync(dir)
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) throw new Error(`${dir} belongs to another user; set XDG_RUNTIME_DIR to a directory of your own`)
    if ((st.mode & 0o777) !== 0o700) chmodSync(dir, 0o700)
  }
  return dir
}

/** The UNIX socket of a session whose first folder is `folder`, or on Windows its named pipe. */
export function socketOf(folder: string): string {
  const r = real(folder)
  if (process.platform === 'win32') return `\\\\.\\pipe\\pcbjs-${userName()}-${hash16(r.toLowerCase())}`
  const fits = (p: string) => Buffer.byteLength(p) < SUN_PATH
  const own = join(r, '.pcbjs', 'session')
  if (fits(own)) return own
  // a long XDG_RUNTIME_DIR falls through to the temporary directory
  const run = join(runtimeDir(), `${hash16(r)}.sock`)
  return fits(run) ? run : join(ownDir(tmpRuntimeDir()), `${hash16(r)}.sock`)
}

/** The git common dir holding `dir`, shared by every worktree of one repository; null outside git. */
export function gitCommonDir(dir: string): string | null {
  for (let d = real(dir); ; d = dirname(d)) {
    const dot = join(d, '.git')
    if (existsSync(dot)) {
      try {
        if (statSync(dot).isDirectory()) return real(dot)
        const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, 'utf8'))
        if (!m) return null
        const gitdir = resolve(d, m[1].trim())
        const common = join(gitdir, 'commondir')
        return real(existsSync(common) ? resolve(gitdir, readFileSync(common, 'utf8').trim()) : gitdir)
      } catch {
        return null
      }
    }
    if (dirname(d) === d) return null
  }
}

/** The top of the git checkout holding `dir`, one worktree of its repository, else the folder itself. */
export function checkoutOf(dir: string): string {
  for (let d = real(dir); ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d
    if (dirname(d) === d) return real(dir)
  }
}

/** `a` and `b` lie in two worktrees of one repository. */
export function otherWorktree(a: string, b: string): boolean {
  const common = gitCommonDir(a)
  return common !== null && common === gitCommonDir(b) && checkoutOf(a) !== checkoutOf(b)
}

/** What a session is keyed by: the checkout of its first folder, so another worktree of the repository gets its own. */
export const sessionKey = (folder: string): string => checkoutOf(folder)

/** The record naming the live session of a checkout, so a starter in another project of it finds it. */
export const repoRecordOf = (key: string): string => join(runtimeDir(), `${hash16(key)}.json`)
