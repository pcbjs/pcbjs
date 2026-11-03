// First starter owns: a starter finds the live session of a project or its checkout, else spawns one detached under a lock and waits for it.
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectSession, probe } from './client.js'
import type { SessionInfo } from './frames.js'
import { devJsonOf, lockOf, logDirOf, logOf, otherWorktree, real, repoRecordOf, sessionKey } from './paths.js'

/** ms a starter waits for the session it spawned, or for another starter's */
export const START_MS = 30_000
/** bytes past which the log is started afresh */
const LOG_MAX = 1024 * 1024
const MAIN = fileURLToPath(new URL('../session-main.js', import.meta.url))

/** What a checkout's record names: the session a starter in another project of it joins. */
export interface RepoRecord {
  session: string
  pid: number
  socket: string
  root: string
}

export const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e: any) {
    return e?.code === 'EPERM'
  }
}

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

/** The session dev.json names, when its pid lives, its socket answers and it serves this worktree; another process's only. */
export async function liveSession(root: string): Promise<SessionInfo | null> {
  const info = readJson<SessionInfo>(devJsonOf(root))
  if (!info || typeof info.session !== 'string' || typeof info.socket !== 'string' || typeof info.pid !== 'number' || info.pid === process.pid) return null
  if (info.checkout && otherWorktree(info.checkout, root)) return null
  if (!alive(info.pid)) return null
  return (await probe(info.socket)) ? info : null
}

/** The live session of the checkout holding `root`, from its record. */
export async function repoSession(root: string): Promise<RepoRecord | null> {
  const rec = readJson<RepoRecord>(repoRecordOf(sessionKey(root)))
  if (!rec || typeof rec.socket !== 'string' || typeof rec.pid !== 'number' || rec.pid === process.pid || !alive(rec.pid)) return null
  return (await probe(rec.socket)) ? rec : null
}

export interface EnsureOptions {
  /** the `session serve` arguments for a session started here */
  args: string[]
  /** a line for the user */
  log?: (line: string) => void
  timeoutMs?: number
}

export interface Ensured {
  info: SessionInfo
  /** this starter spawned it */
  started: boolean
  /** it served another project of the repository and attached this one */
  joined: boolean
}

/** The session serving `root`: the live one, its checkout's with `root` attached, or a new one. */
export async function ensureSession(root: string, o: EnsureOptions): Promise<Ensured> {
  root = real(root)
  const live = await liveSession(root)
  if (live) return { info: live, started: false, joined: false }
  const joined = await join(root)
  if (joined) return { info: joined, started: false, joined: true }
  const deadline = Date.now() + (o.timeoutMs ?? START_MS)
  for (;;) {
    if (takeLock(root)) {
      try {
        const again = await liveSession(root)
        if (again) return { info: again, started: false, joined: false }
        return { info: await spawnSession(root, o.args, deadline), started: true, joined: false }
      } finally {
        releaseLock(root)
      }
    }
    // another starter holds the lock: its session, or the lock going stale
    while (Date.now() < deadline && existsSync(lockOf(root)) && !staleLock(root)) {
      const info = await liveSession(root)
      if (info) return { info, started: false, joined: false }
      await sleep(100)
    }
    if (Date.now() >= deadline) throw new Error(`no session came up for ${root} within ${Math.round((o.timeoutMs ?? START_MS) / 1000)} s; see ${logOf(root)}`)
    const info = await liveSession(root)
    if (info) return { info, started: false, joined: false }
  }
}

/** Ask the repository's session to serve `root` too. */
async function join(root: string): Promise<SessionInfo | null> {
  const rec = await repoSession(root)
  if (!rec) return null
  try {
    const c = await connectSession(rec.socket, { name: 'pcbjs starter', role: 'cli' })
    try {
      await c.request('session/attach', { folders: [root] })
    } finally {
      c.close()
    }
  } catch {
    return null
  }
  return liveSession(root)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function takeLock(root: string): boolean {
  const file = lockOf(root)
  mkdirSync(dirname(file), { recursive: true })
  for (let i = 0; i < 2; i++) {
    try {
      const fd = openSync(file, 'wx', 0o600)
      writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }))
      closeSync(fd)
      return true
    } catch (e: any) {
      if (e?.code !== 'EEXIST') throw e
      if (!staleLock(root)) return false
      try {
        unlinkSync(file)
      } catch {}
    }
  }
  return false
}

/** A lock whose pid is dead, or older than START_MS, or unreadable for as long. */
export function staleLock(root: string): boolean {
  const file = lockOf(root)
  const lock = readJson<{ pid: number; at: number }>(file)
  if (lock && typeof lock.pid === 'number') return !alive(lock.pid) || Date.now() - lock.at > START_MS
  try {
    return Date.now() - statSync(file).mtimeMs > START_MS
  } catch {
    return false
  }
}

function releaseLock(root: string): void {
  const lock = readJson<{ pid: number }>(lockOf(root))
  if (lock?.pid === process.pid)
    try {
      unlinkSync(lockOf(root))
    } catch {}
}

/** An append descriptor of .pcbjs/log/session.log, the old log set aside past 1 MB. */
export function openLog(root: string): number {
  mkdirSync(logDirOf(root), { recursive: true })
  const file = logOf(root)
  try {
    if (statSync(file).size > LOG_MAX) renameSync(file, file + '.1')
  } catch {}
  return openSync(file, 'a', 0o600)
}

/** The last lines of the session log, for a failure. */
export function logTail(root: string, n = 20): string[] {
  try {
    return readFileSync(logOf(root), 'utf8').trimEnd().split('\n').slice(-n)
  } catch {
    return []
  }
}

async function spawnSession(root: string, args: string[], deadline: number): Promise<SessionInfo> {
  const fd = openLog(root)
  const child = spawn(process.execPath, [MAIN, 'session', 'serve', ...args], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, NO_COLOR: '1' },
  })
  closeSync(fd)
  let exit: number | null = null
  child.once('exit', code => (exit = code ?? 1))
  child.unref()
  while (Date.now() < deadline) {
    const info = await liveSession(root)
    if (info) return info
    // an exit with 0 found another session; its dev.json follows
    if (exit !== null && exit !== 0) throw new Error(`the session exited with code ${exit}:\n${logTail(root).join('\n')}`)
    await sleep(100)
  }
  throw new Error(`the session did not come up within ${START_MS / 1000} s; see ${logOf(root)}`)
}
