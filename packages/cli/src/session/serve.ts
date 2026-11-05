// `pcbjs session serve`: the session itself. Vite, the compile and the language servers of devWorkspace, plus the socket or pipe,
// dev.json in every project it serves, the idle grace and the exit polling. docs/session.md has the lifecycle.
import { sameFile, under } from '../project/files.js'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { dirname } from 'node:path'
import type { ViteDevServer } from 'vite'
import { devWorkspace } from './workspace.js'
import { addToWorkspace, scopeRoute, scopesInfo, type ProjectSpec, type Workspace } from './scope-state.js'
import { scopeOf } from './scopes.js'
import { findConfig, loadUserConfig } from '../project/config.js'
import { MAJOR, PROTOCOL } from '@pcbjs/core/protocol'
import { VERSION, type DevOptions } from '../server/listen.js'
import type { DevState, ViewMethod } from './plugin.js'
import { tiersOf } from './drafts.js'
import type { Handler } from './clients.js'
import { queryMethods } from './queries.js'
import { agentMethods } from './agents.js'
import { RenderWorker } from '../render/worker-client.js'
import { lineReader, sessionId, type EditMode, type SessionInfo } from './frames.js'
import { probe } from './client.js'
import { liveSession, repoSession, type RepoRecord } from './start.js'
import { checkoutOf, devJsonOf, logOf, otherWorktree, real, repoRecordOf, sessionKey, socketOf } from './paths.js'

/** s a session without clients stays up */
export const GRACE_S = 600
/** ms between the checks for clients and for the first folder and its dev.json, which fs.watch misses */
const TICK_MS = 1000
const POLL_MS = 2000

export interface ServeOptions extends DevOptions {
  /** projects served as they are: `pcbjs dev` in a project */
  projects?: ProjectSpec[]
  /** folders searched for projects: `--workspace` */
  folders?: string[]
  edit?: EditMode
  /** s without clients before the session ends */
  grace?: number
  /** a line for the log */
  log?: (line: string) => void
}

export interface Session {
  id: string
  info: () => SessionInfo
  server: ViteDevServer
  workspace: Workspace
  stop(reason: string): Promise<void>
  /** resolves once stopped */
  done: Promise<string>
}

const folderList = (p: { folders?: unknown }): string[] => (Array.isArray(p?.folders) ? p.folders.filter((f): f is string => typeof f === 'string') : [])

/** The edit mode: the flag, else `session.edit` in the first project's config, else localhost. */
export function editMode(flag: unknown, config: unknown): EditMode {
  for (const v of [flag, config]) if (v === 'localhost' || v === 'all' || v === 'none') return v
  return 'localhost'
}

/** null when another session already serves the first folder: this one exits 0. */
export async function serveSession(o: ServeOptions): Promise<Session | null> {
  const log = o.log ?? ((l: string) => console.log(l))
  const projects = (o.projects ?? []).map(p => ({ ...p, dir: real(p.dir) }))
  const folders = (o.folders ?? []).map(real)
  const first = projects[0]?.dir ?? folders[0] ?? real('.')
  const other = await liveSession(first)
  if (other) {
    log(`pcbjs: session ${other.session}, pid ${other.pid}, already serves ${first}`)
    return null
  }
  const socket = socketOf(first)
  if (!(await freeSocket(socket))) {
    log(`pcbjs: another session answers on ${socket}`)
    return null
  }
  const id = sessionId(randomBytes(5))
  const edit = editMode(o.edit, await configEdit(first))
  const token = edit === 'all' ? randomBytes(16).toString('base64url') : undefined
  const startedAt = new Date().toISOString()
  let changed = () => {}
  const state: DevState = {
    slots: [],
    tiers: tiersOf(),
    session: { id, edit, token, onChange: () => changed() },
  }
  const { server, workspace: ws } = await devWorkspace({ ...o, folders, projects, state })
  const written = new Set<string>()
  const checkout = checkoutOf(first)

  const infoFor = (root: string, url: string): SessionInfo => ({
    pid: process.pid,
    tiers: state.tiers!,
    version: VERSION,
    protocol: PROTOCOL,
    major: MAJOR,
    startedAt,
    root,
    url,
    session: id,
    socket,
    edit,
    checkout,
    ...(token ? { token } : {}),
  })
  const urlOf = (root: string): string => {
    const sc = ws.scopes.find(s => sameFile(s.dir, root))
    const base = server.resolvedUrls?.local?.[0] ?? 'http://localhost/'
    return new URL(sc ? scopeRoute(ws, sc) : '/', base).href
  }
  // every folder and project gets one, rewritten when the routes change; another worktree keeps its own session's
  const writeAll = () => {
    for (const root of new Set([...ws.folders, ...ws.scopes.map(s => s.dir)])) {
      if (otherWorktree(first, root)) continue
      const file = devJsonOf(root)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(infoFor(root, urlOf(root)), null, 2) + '\n', { mode: 0o600 })
      chmodSync(file, 0o600)
      written.add(root)
    }
  }

  const served = (root: string) => ws.folders.some(f => sameFile(f, root)) || !!scopeOf(ws.scopes, root)
  const attach = async (dir: string) => {
    const root = real(dir)
    if (!existsSync(root) || served(root)) return
    const added = findConfig(root) ? addToWorkspace(ws, [], [{ dir: root }]) : addToWorkspace(ws, [root])
    for (const sc of added) if (sc.configFile) server.watcher.add(sc.configFile)
    server.config.server.fs.allow.push(root)
    writeAll()
    state.announce?.()
    state.clients?.ready()
    state.clients?.relay('pcbjs:ide:scopes', scopesInfo(ws))
    log(`[pcbjs] attached ${root}${added.length ? `: ${added.map(s => s.rel || s.slug).join(', ')}` : ''}`)
  }
  state.session.attach = attach
  /** Stop serving a folder `attach` added and every scope in it; the first folder stays. */
  const detach = async (dir: string) => {
    const root = real(dir)
    const inside = (p: string) => under(p, root)
    if (inside(first)) return
    const gone = ws.scopes.filter(s => inside(s.dir))
    const keep = ws.scopes.find(s => !inside(s.dir))
    if (!gone.length && !ws.folders.some(inside)) return
    if (ws.recent && gone.includes(ws.recent) && keep) await state.show?.(keep)
    for (const sc of gone) {
      void state.drop?.(sc)
      server.watcher.unwatch([sc.configFile, ...sc.files].filter(f => f && inside(f)))
      ws.scopes.splice(ws.scopes.indexOf(sc), 1)
    }
    for (const list of [ws.folders, server.config.server.fs.allow]) list.splice(0, list.length, ...list.filter(f => !inside(f)))
    writeAll()
    state.announce?.()
    state.clients?.ready()
    state.clients?.relay('pcbjs:ide:scopes', scopesInfo(ws))
    log(`[pcbjs] detached ${root}`)
  }

  const listener = await listenSocket(socket, conn => {
    const c = state.clients!.add({
      kind: 'socket',
      loopback: true,
      send: (head, tail) => {
        if (conn.destroyed) return false
        conn.write(head)
        if (tail) conn.write(tail)
        conn.write('\n')
        return true
      },
      close: () => conn.end(),
    })
    conn.on(
      'data',
      lineReader(
        m => c.receive(m),
        () => conn.destroy(),
      ),
    )
    conn.on('close', () => c.closed())
    conn.on('error', () => c.closed())
  })
  writeAll()
  const key = sessionKey(first)
  const recordFile = repoRecordOf(key)
  if (!(await repoSession(first))) writeFileSync(recordFile, JSON.stringify({ session: id, pid: process.pid, socket, root: first } satisfies RepoRecord) + '\n', { mode: 0o600 })

  const grace = (o.grace ?? GRACE_S) * 1000
  let idleSince: number | null = Date.now()
  const attached = () => state.clients!.size() + server.ws.clients.size + (state.inflight ?? 0)
  changed = () => {
    idleSince = attached() ? null : (idleSince ?? Date.now())
  }
  let stopping: Promise<void> | null = null
  let shots: RenderWorker | null = null
  let finish!: (reason: string) => void
  const done = new Promise<string>(r => (finish = r))
  let ticks = 0
  const tick = setInterval(() => {
    changed()
    if (idleSince !== null && Date.now() - idleSince >= grace) void stop(`idle for ${Math.round(grace / 1000)} s`)
    if (++ticks % (POLL_MS / TICK_MS) === 0) {
      const gone = goneReason(first)
      if (gone) void stop(gone)
    }
  }, TICK_MS)

  const stop = (reason: string): Promise<void> =>
    (stopping ??= (async () => {
      clearInterval(tick)
      log(`[pcbjs] session ${id} stopping: ${reason}`)
      state.clients?.broadcast('pcbjs:ide:bye', { reason })
      // let the byes leave before the sockets close
      await new Promise(r => setTimeout(r, 50))
      await server.close().catch(() => {})
      await shots?.close()
      await new Promise<void>(r => listener.close(() => r()))
      cleanup()
      process.off('exit', cleanup)
      finish(reason)
    })())

  const info = () => infoFor(first, urlOf(first))
  const viewed =
    <M extends ViewMethod>(m: M): Handler<M> =>
    (p, c) => {
      const v = state.session.views
      if (!v) throw new Error('this session serves no project yet')
      return v[m](p, c)
    }
  state.session.handlers = {
    'session/status': (_p, c) => ({
      ...info(),
      ...(c.transport.kind === 'tcp' ? { token: undefined } : {}),
      folders: ws.folders,
      projects: state.projects?.() ?? [],
      log: logOf(first),
      grace: grace / 1000,
      idle: idleSince === null ? null : Math.round((Date.now() - idleSince) / 1000),
      clients: state.clients!.list().map(c => ({ ...c.by(), ...c.about, ...(c.hello?.project ? { root: c.hello.project } : {}), kind: c.transport.kind, mode: c.mode })),
      ready: state.ready?.() ?? null,
    }),
    'session/stop': () => {
      setImmediate(() => void stop('session stop'))
      return { stopping: id }
    },
    'session/attach': async p => {
      for (const f of folderList(p)) await attach(f)
      return { session: id, projects: state.projects?.() ?? [] }
    },
    'session/detach': async p => {
      for (const f of folderList(p)) await detach(f)
      return { session: id, projects: state.projects?.() ?? [] }
    },
    ...queryMethods({
      api: () => state.api,
      events: () => state.events,
      feed: () => state.feed,
      snapshots: p => ({ cur: state.snapshots?.current(p) ?? null, prev: state.snapshots?.previous(p) ?? null }),
      wake: () => state.wake?.(),
      renderer: () => (shots ??= new RenderWorker({ log })),
      clients: () => state.clients,
    }),
    ...agentMethods({ api: () => state.api, events: () => state.events, feed: () => state.feed, clients: () => state.clients }),
    'session/layout': viewed('session/layout'),
    'session/select': viewed('session/select'),
    'session/observe': viewed('session/observe'),
    'session/resync': viewed('session/resync'),
    'session/hover': viewed('session/hover'),
    'session/clients': viewed('session/clients'),
    'session/edit/lock': viewed('session/edit/lock'),
    'session/edit/begin': viewed('session/edit/begin'),
    'session/edit/update': viewed('session/edit/update'),
    'session/edit/commit': viewed('session/edit/commit'),
    'session/edit/cancel': viewed('session/edit/cancel'),
    'session/edit/undo': viewed('session/edit/undo'),
    'session/edit/redo': viewed('session/edit/redo'),
  }

  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(sig, () => void stop(sig))
  // Vite exits on SIGTERM itself, which may come first
  const cleanup = () => {
    for (const root of written) removeOwn(devJsonOf(root))
    if (process.platform !== 'win32') rmSync(socket, { force: true })
    removeOwn(recordFile)
  }
  process.on('exit', cleanup)
  log(`[pcbjs] session ${id}, pid ${process.pid}, socket ${socket}, edit ${edit}, idle grace ${grace / 1000} s`)
  if (ws.scopes.length === 1) void state.show?.(ws.scopes[0])
  return { id, info, server, workspace: ws, stop, done }
}

/** `session.edit` of the first project's config; a config that fails to load fails again, with its message, when its scope loads. */
async function configEdit(root: string): Promise<unknown> {
  if (!findConfig(root)) return undefined
  try {
    return (await loadUserConfig('serve', undefined, root)).user.session?.edit
  } catch {
    return undefined
  }
}

/** Why the session must end: the first folder or its dev.json gone or naming another pid. */
function goneReason(first: string): string | null {
  if (!existsSync(first)) return `${first} is gone`
  try {
    const info = JSON.parse(readFileSync(devJsonOf(first), 'utf8'))
    return info?.pid === process.pid ? null : `${devJsonOf(first)} names another session`
  } catch {
    return `${devJsonOf(first)} is gone`
  }
}

/** A file of this process only: another session may have written it since. */
function removeOwn(file: string): void {
  try {
    if (JSON.parse(readFileSync(file, 'utf8')).pid === process.pid) unlinkSync(file)
  } catch {}
}

/** False when a session answers there; a socket that refuses connections is a crashed one's and goes. */
async function freeSocket(socket: string): Promise<boolean> {
  if (process.platform === 'win32') return !(await probe(socket, 500))
  if (!existsSync(socket)) return true
  if (await probe(socket, 500)) return false
  rmSync(socket, { force: true })
  return true
}

/** The socket at mode 0600, bound under umask 0177 so no other user can connect between bind and chmod. */
function listenSocket(path: string, onConn: (s: Socket) => void): Promise<Server> {
  return new Promise((ok, fail) => {
    const srv = createServer(onConn)
    srv.once('error', fail)
    if (process.platform !== 'win32') mkdirSync(dirname(path), { recursive: true })
    const mask = process.platform === 'win32' ? null : process.umask(0o177)
    srv.listen(path, () => {
      if (mask !== null) process.umask(mask)
      if (process.platform !== 'win32') chmodSync(path, 0o600)
      srv.off('error', fail)
      ok(srv)
    })
    if (mask !== null) srv.once('error', () => process.umask(mask))
  })
}
