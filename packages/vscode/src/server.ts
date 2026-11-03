// The sessions serving the workspace: each found through .pcbjs/dev.json and dialled, one started with `pcbjs session serve` from
// the project's own pcbjs for the folders no live session serves. docs/session.md has the session.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn as nodeSpawn } from 'node:child_process'
import type { IdeBoardsMsg, LogMsg, Method, Params, Ready, Result, ScopeMsg, ScopesMsg } from '@pcbjs/core/protocol'
import { devUrl, isUnder, pathOf } from './protocol'
import { SessionLink, alive, readDevInfo, type DevInfo, type LinkOptions } from './link'
import { DETACHED, connected, running, type Phase } from './phase'
import { ownerOf, type Owner } from './owner'

export type Scope = ScopesMsg['scopes'][number]

type Optional = 'onChange' | 'output' | 'env' | 'candidates' | 'onScope' | 'onGlobal' | 'onLink' | 'onEvent' | 'onMismatch'

export interface ChildLike {
  readonly pid?: number
  readonly stdout?: NodeJS.ReadableStream | null
  readonly stderr?: NodeJS.ReadableStream | null
  on(event: 'exit', cb: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  on(event: 'error', cb: (err: NodeJS.ErrnoException) => void): unknown
  unref?(): void
}

export interface SpawnOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  shell?: boolean
  /** its own process group, so closing the window never ends it */
  detached?: boolean
  /** stdin ignored, stdout and stderr to the session log; piped when absent */
  stdio?: ['ignore', number, number]
}

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildLike

export interface ServerOptions {
  /** the first holds the log of a session started here */
  folders(): string[]
  /** the projects found in the workspace, searched for a pcbjs before the folders */
  candidates?(): string[]
  /** the hello's name and version */
  name?: string
  version?: string
  nodePath?(): string
  spawn?: SpawnFn
  /** the live session dev.json of a folder names */
  devInfo?(root: string): DevInfo | undefined
  connect?(dev: DevInfo, o: LinkOptions): Promise<SessionLink>
  exists?(p: string): boolean
  realpath?(p: string): string
  readFile?(p: string): string
  env?: NodeJS.ProcessEnv
  output?(line: string): void
  /** the phase moved, or the same phase twice for new boards, scopes or a scope */
  onChange?(prev: Phase, next: Phase): void
  /** the project the first folder's session shows changed */
  onScope?(scope: ScopeMsg, link: SessionLink): void
  /** no project has pcbjs installed and a global one runs instead */
  onGlobal?(bin: string): void
  /** a link said ready: the extension starts its language client on it */
  onLink?(link: SessionLink): void
  /** `session/event`, `session/message`, `session/state` */
  onEvent?(link: SessionLink, event: string, data: any): void
  onMismatch?(notice: string): void
  backoffMinMs?: number
  backoffMaxMs?: number
  /** connections lost in a row without a ready before giving up */
  maxRestarts?: number
  readyTimeoutMs?: number
}

const BIN_NAME = process.platform === 'win32' ? 'pcbjs.cmd' : 'pcbjs'
export const LOCAL_BINS = [path.join('node_modules', '.bin', BIN_NAME), path.join('node_modules', '@pcbjs', 'pcbjs', 'bin', 'pcbjs.js')]
export const INSTALL_HINT = 'npm install --save-dev @pcbjs/pcbjs'

/** The project's own pcbjs, in the folder or the nearest ancestor. */
export function findBinary(folder: string, exists: (p: string) => boolean = fs.existsSync): string | undefined {
  let dir = path.resolve(folder)
  for (;;) {
    for (const rel of LOCAL_BINS) if (exists(path.join(dir, rel))) return path.join(dir, rel)
    const up = path.dirname(dir)
    if (up === dir) return undefined
    dir = up
  }
}

export function findGlobal(env: NodeJS.ProcessEnv, exists: (p: string) => boolean = fs.existsSync): string | undefined {
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)) {
    const bin = path.join(dir, BIN_NAME)
    if (exists(bin)) return bin
  }
  return undefined
}

/** A bin that resolves to a script runs under the chosen node, so pcbjs.nodePath holds; a shell shim runs as it is. */
export function launcher(bin: string, node: string, realpath: (p: string) => string = fs.realpathSync): { command: string; args: string[]; shell: boolean } {
  let real = bin
  try {
    real = realpath(bin)
  } catch {}
  if (/\.[cm]?js$/.test(real)) return { command: node, args: [real], shell: false }
  return { command: bin, args: [], shell: /\.cmd$/i.test(bin) }
}

/** `session serve` for the folders, on a free port of loopback as the extension's own server ran. */
export const serveArgs = (folders: string[]): string[] => ['session', 'serve', '--workspace', ...folders, '--port', '0', '--host', '127.0.0.1']

export const sessionLog = (root: string): string => path.join(root, '.pcbjs', 'log', 'session.log')

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g

const defaultSpawn: SpawnFn = (command, args, options) => nodeSpawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options, windowsHide: true })

/** The live session a folder's dev.json names. */
export const liveDevInfo = (root: string): DevInfo | undefined => {
  const d = readDevInfo(root)
  return d && alive(d.pid) ? d : undefined
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** One per window: a connection lost without the session's bye connects again after a backoff, failed after maxRestarts losses or no session in readyTimeoutMs. */
export class PcbjsServer {
  state: Phase = DETACHED
  /** the path the panes show of the first folder's session, from `pcbjs/preview` or its scope */
  page: string | undefined
  /** one per session serving the workspace */
  readonly links: SessionLink[] = []
  /** the pcbjs binary of the last start */
  bin: string | undefined
  /** the last 400 */
  readonly lines: string[] = []
  readonly logs: LogMsg[] = []
  private readonly scopeWaiters = new Set<(cancel?: boolean) => void>()
  private losses = 0
  private disposed = false
  private generation = 0
  private attachAbort?: AbortController
  private retryTimer: NodeJS.Timeout | undefined
  private waiters: { ok(url: string): void; fail(err: Error): void }[] = []
  private readonly o: Required<Omit<ServerOptions, Optional>> & Pick<ServerOptions, Optional>

  constructor(options: ServerOptions) {
    this.o = {
      name: 'vscode-pcbjs',
      version: '0.0.0',
      nodePath: () => 'node',
      spawn: defaultSpawn,
      devInfo: liveDevInfo,
      connect: (dev, o) => SessionLink.connect(dev, o),
      exists: fs.existsSync,
      realpath: fs.realpathSync,
      readFile: p => fs.readFileSync(p, 'utf8'),
      backoffMinMs: 500,
      backoffMaxMs: 10000,
      maxRestarts: 5,
      readyTimeoutMs: 60000,
      ...options,
    }
  }

  get root(): string {
    return this.o.folders()[0] ?? ''
  }

  get folders(): string[] {
    return this.o.folders()
  }

  get name(): string {
    return path.basename(this.root)
  }

  /** the link of the first folder's session, else the first */
  get client(): SessionLink | undefined {
    return this.links.find(l => l.roots.includes(this.root)) ?? this.links[0]
  }

  /** what the first folder's session sent */
  get boards(): IdeBoardsMsg | undefined {
    return this.client?.boards
  }

  get scopes(): ScopesMsg | undefined {
    return this.client?.scopes
  }

  get scope(): ScopeMsg | undefined {
    return this.client?.scope
  }

  /** the session's, once running */
  get pid(): number | undefined {
    return this.state.kind === 'running' ? this.state.info.pid : undefined
  }

  get session(): string | undefined {
    return this.state.kind === 'running' ? this.state.info.session : undefined
  }

  get url(): string | undefined {
    return this.state.kind === 'running' ? this.state.url : undefined
  }

  get active(): boolean {
    return connected(this.state)
  }

  /** The log of the session serving the first folder. */
  get logFile(): string {
    return sessionLog(this.client?.dev.root ?? this.root)
  }

  /** The session that serves the file, see ownerOf. */
  owner(file: string): Owner<SessionLink> | undefined {
    return ownerOf(file, this.o.folders(), this.links)
  }

  /** The owner's link, else the first folder's. */
  linkOf(file?: string): SessionLink | undefined {
    return (file && this.owner(file)?.link) || this.client
  }

  /** The first scope `pick` accepts, now or once a compile event of the session has one; undefined after `ms`. */
  whenScope(pick: (s: Scope) => boolean, ms = 120_000, link = this.client): Promise<Scope | undefined> {
    if (this.disposed) return Promise.resolve(undefined)
    return new Promise(done => {
      const check = (cancel = false) => {
        const hit = cancel ? undefined : link?.scopes?.scopes.find(pick)
        if (!cancel && !hit) return
        clearTimeout(timer)
        this.scopeWaiters.delete(check)
        done(hit)
      }
      const timer = setTimeout(() => {
        this.scopeWaiters.delete(check)
        done(undefined)
      }, ms)
      timer.unref?.()
      this.scopeWaiters.add(check)
      check()
    })
  }

  async start(): Promise<void> {
    if (this.disposed || this.active) return
    clearTimeout(this.retryTimer)
    this.losses = 0
    this.setState({ kind: 'attaching', attempt: 0 })
    await this.attach()
  }

  /** Disconnect: every session keeps serving its other clients for its idle grace. */
  async stop(): Promise<void> {
    this.detach()
    this.setState(DETACHED)
    this.rejectWaiters(new Error('the pcbjs session was detached'))
  }

  /** A replaced window owner cannot be restarted by a late preview callback. */
  dispose(): Promise<void> {
    this.disposed = true
    return this.stop()
  }

  /** Every link closed and no retry pending, the phase left as it is. */
  private detach(): void {
    this.generation++
    this.attachAbort?.abort()
    clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    for (const l of this.links.splice(0)) l.close()
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  /** Ends the session process itself through session/stop, waits for it to go, and starts a fresh one. */
  async restartServer(): Promise<void> {
    this.setState({ kind: 'restarting', clearing: false })
    await this.endSession()
    await this.start()
  }

  /** restartServer with `pcbjs cache clear --models` over every folder the sessions served between the end and the start; the CLI's exit code, null when it could not run. */
  async restartClean(): Promise<number | null> {
    const dirs = this.served
    this.setState({ kind: 'restarting', clearing: true })
    await this.endSession()
    const code = await this.clearCaches(dirs)
    await this.start()
    return code
  }

  /** The roots of every attached session and the workspace folders. */
  get served(): string[] {
    return [...new Set([...this.links.flatMap(l => [l.dev.root, ...l.roots]), ...this.o.folders()])]
  }

  /** session/stop on every link while it is open, then the links closed; resolves once the first folder's session is gone. */
  private async endSession(): Promise<void> {
    await Promise.all(this.links.map(l => l.request('session/stop', undefined, 5000).catch(() => undefined)))
    this.detach()
    for (let i = 0; i < 100; i++) {
      const info = readDevInfo(this.root)
      if (!info || !alive(info.pid)) return
      await sleep(100)
    }
  }

  /** `pcbjs cache clear --models <dirs>` from the pcbjs a start runs, each line of its output to the output. */
  private async clearCaches(dirs: string[]): Promise<number | null> {
    const found = this.binary()
    if (!found) {
      this.push(`cannot clear the caches: pcbjs is not installed in ${this.root}. Run ${INSTALL_HINT}.`)
      return null
    }
    const run = launcher(found.bin, this.o.nodePath(), this.o.realpath)
    const args = [...run.args, 'cache', 'clear', '--models', ...dirs]
    this.push(`$ ${run.command} ${args.join(' ')}`)
    try {
      const child = this.o.spawn(run.command, args, { cwd: dirs[0] ?? this.root, env: { ...(this.o.env ?? process.env), NO_COLOR: '1' }, ...(run.shell ? { shell: true } : {}) })
      const streams = [child.stdout, child.stderr].filter((s): s is NodeJS.ReadableStream => !!s)
      const ended = streams.map(
        s =>
          new Promise<void>(done => {
            let rest = ''
            s.on('data', (d: Buffer | string) => {
              const lines = (rest + d).split(/\r?\n/)
              rest = lines.pop() ?? ''
              for (const l of lines) if (l) this.push(l.replace(ANSI, ''))
            })
            s.on('end', () => {
              if (rest) this.push(rest.replace(ANSI, ''))
              done()
            })
          }),
      )
      const code = await new Promise<number | null>(done => {
        child.on('exit', c => done(c ?? 1))
        child.on('error', err => {
          this.push(`cannot run ${run.command}: ${err.message}`)
          done(null)
        })
      })
      await Promise.race([Promise.all(ended), sleep(1000)])
      return code
    } catch (err) {
      this.push(`cannot run ${run.command}: ${(err as Error).message}`)
      return null
    }
  }

  /** The project's own pcbjs, else a global one. */
  private binary(): { bin: string; global: boolean } | undefined {
    for (const dir of [...(this.o.candidates?.() ?? []), ...this.o.folders()]) {
      const bin = findBinary(dir, this.o.exists)
      if (bin) return { bin, global: false }
    }
    const bin = findGlobal(this.o.env ?? process.env, this.o.exists)
    return bin ? { bin, global: true } : undefined
  }

  whenReady(): Promise<string> {
    if (this.disposed) return Promise.reject(new Error('the window connection was disposed'))
    if (this.state.kind === 'running') return Promise.resolve(this.state.url)
    if (this.state.kind === 'failed') return Promise.reject(new Error(this.state.reason))
    return new Promise((ok, fail) => this.waiters.push({ ok, fail }))
  }

  recent(n = 40): string[] {
    return this.lines.slice(-n)
  }

  /** The last lines of the session log, for a failure. */
  logTail(n = 10): string[] {
    try {
      return this.o
        .readFile(this.logFile)
        .trimEnd()
        .split(/\r?\n/)
        .slice(-n)
        .map(l => l.replace(ANSI, ''))
    } catch {
      return []
    }
  }

  /** `session/*` on the link of the file, else the first folder's. */
  request<M extends Method>(method: M, params?: Params<M>, file?: string): Promise<Result<M>> {
    const l = this.linkOf(file)
    return l ? l.request(method, params) : Promise.reject(new Error('no session is attached'))
  }

  /** Connect to every live session of the folders and the projects; start one for the folders no session serves. */
  private async attach(): Promise<void> {
    if (this.disposed) return
    const gen = ++this.generation
    this.attachAbort?.abort()
    this.attachAbort = new AbortController()
    const folders = this.o.folders()
    const candidates = (this.o.candidates?.() ?? []).filter(d => !folders.includes(d))
    const live = new Map<string, DevInfo>()
    for (const d of [...folders, ...candidates]) {
      const info = this.o.devInfo(d)
      if (info) live.set(info.session, info)
    }
    const served = [...live.values()]
    const bare = folders.filter(f => !served.some(s => s.root === f || isUnder(f, s.root)))
    const left = candidates.filter(d => !this.o.devInfo(d))
    const alone = left.filter(d => !served.some(s => isUnder(s.root, d)))
    if (bare.length || alone.length) {
      const started = await this.spawn(bare.length ? bare : alone, gen)
      if (!started || gen !== this.generation) return
      live.set(started.session, started)
    }
    for (const dev of live.values()) {
      if (gen !== this.generation) return
      if (this.links.some(l => l.session === dev.session && l.open)) continue
      try {
        await this.link(dev, gen)
      } catch (err) {
        this.push(`cannot connect to session ${dev.session} at ${dev.socket || dev.url}: ${(err as Error).message}`)
      }
    }
    if (gen !== this.generation) return
    if (!this.links.length) return this.lost(`no session of ${folders.join(', ')} answered`)
    if (bare.length || left.length) await this.client?.request('session/attach', { folders: [...bare, ...left] }).catch(() => undefined)
  }

  private async link(dev: DevInfo, gen: number): Promise<void> {
    const link = await this.o.connect(dev, {
      name: this.o.name,
      version: this.o.version,
      project: dev.root,
      signal: this.attachAbort?.signal,
      onReady: (info, l) => this.onReady(l, info),
      onBoards: () => this.changed(),
      onScopes: () => this.changed(),
      onScope: (_data, l) => {
        if (this.links.includes(l)) this.follow(l)
        this.changed()
      },
      onLog: ev => {
        this.logs.push(ev)
        if (this.logs.length > 200) this.logs.splice(0, this.logs.length - 200)
      },
      onEvent: (event, data, l) => {
        // a compile event follows the scopes it changed, so a waiter reads them current
        if (event === 'session/event' && data?.kind === 'compile') for (const check of [...this.scopeWaiters]) check()
        this.o.onEvent?.(l, event, data)
      },
      onMismatch: notice => this.o.onMismatch?.(notice),
    })
    if (gen !== this.generation) return link.close()
    this.links.push(link)
    link.onClose(() => this.onClosed(link))
    this.push(`session ${link.session}, pid ${dev.pid}, serves ${dev.root}`)
    if (link.info) this.onReady(link, link.info)
    this.o.onLink?.(link)
  }

  private onReady(link: SessionLink, info: Ready): void {
    if (!this.active) return
    this.follow(link)
    if (link !== this.client) return
    this.losses = 0
    const url = devUrl(info)
    this.setState(running(url, info))
    const waiters = this.waiters
    this.waiters = []
    for (const w of waiters) w.ok(url)
  }

  /** A session that said bye ended on purpose; one lost without it is connected again, or started again when gone. */
  private onClosed(link: SessionLink): void {
    const i = this.links.indexOf(link)
    if (i < 0) return
    this.links.splice(i, 1)
    if (!this.active) return this.changed()
    if (!link.saidBye) return this.lost(`the connection to session ${link.session} was lost`)
    this.push(`session ${link.session} ended`)
    const next = this.client
    if (next?.info) this.onReady(next, next.info)
    else this.setState(DETACHED)
  }

  private lost(why: string): void {
    this.losses++
    if (this.losses > this.o.maxRestarts) return this.fail(`${why}, ${this.losses} times in a row`)
    const delay = Math.min(this.o.backoffMinMs * 2 ** (this.losses - 1), this.o.backoffMaxMs)
    this.push(`${why}; connecting again in ${delay} ms`)
    this.setState({ kind: 'reconnecting', attempt: this.losses })
    const gen = this.generation
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      if (gen === this.generation && this.state.kind === 'reconnecting') void this.attach()
    }, delay)
    this.retryTimer.unref?.()
  }

  /** `pcbjs session serve` detached, its output in the first folder's session log; the dev.json it writes, once its pid lives. */
  private async spawn(dirs: string[], gen: number): Promise<DevInfo | undefined> {
    const found = this.binary()
    if (!found) {
      this.fail(`pcbjs is not installed in ${this.root} or above it, nor in a project of the workspace. Run ${INSTALL_HINT}.`, 'install')
      return undefined
    }
    const bin = found.bin
    if (found.global && this.bin !== bin) this.o.onGlobal?.(bin)
    this.bin = bin
    const run = launcher(bin, this.o.nodePath(), this.o.realpath)
    const args = [...run.args, ...serveArgs(dirs)]
    this.push(`$ ${run.command} ${args.join(' ')}`)
    const log = sessionLog(dirs[0])
    let fd: number
    try {
      fs.mkdirSync(path.dirname(log), { recursive: true })
      fd = fs.openSync(log, 'a', 0o600)
    } catch (err) {
      this.fail(`cannot write ${log}: ${(err as Error).message}`)
      return undefined
    }
    let exit: number | null = null
    let error: NodeJS.ErrnoException | undefined
    try {
      const child = this.o.spawn(run.command, args, {
        cwd: dirs[0],
        env: { ...(this.o.env ?? process.env), NO_COLOR: '1' },
        detached: true,
        stdio: ['ignore', fd, fd],
        ...(run.shell ? { shell: true } : {}),
      })
      child.on('exit', code => (exit = code ?? 1))
      child.on('error', err => (error = err))
      child.unref?.()
    } catch (err) {
      this.fail(`cannot run ${run.command}: ${(err as Error).message}`, 'node')
      return undefined
    } finally {
      fs.closeSync(fd)
    }
    const deadline = Date.now() + this.o.readyTimeoutMs
    while (gen === this.generation) {
      const info = this.o.devInfo(dirs[0])
      if (info) return info
      if (error) {
        this.fail(`cannot run ${run.command}: ${error.message}`, error.code === 'ENOENT' ? 'node' : undefined)
        return undefined
      }
      // 0 found another session, whose dev.json follows
      if (exit !== null && exit !== 0) {
        this.fail(`pcbjs session serve exited with code ${exit}`)
        return undefined
      }
      if (Date.now() > deadline) {
        this.fail(`no session came up within ${Math.round(this.o.readyTimeoutMs / 1000)} s. Is the installed pcbjs new enough for pcbjs session serve?`)
        return undefined
      }
      await sleep(100)
    }
    return undefined
  }

  private fail(reason: string, hint?: 'install' | 'node'): void {
    this.generation++
    this.attachAbort?.abort()
    clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    this.push(reason)
    const log = hint ? [] : this.logTail()
    for (const l of log) this.push(`  ${l}`)
    this.setState({ kind: 'failed', reason, ...(hint ? { hint } : {}), ...(log.length ? { log } : {}) })
    this.rejectWaiters(new Error(reason))
  }

  private rejectWaiters(err: Error): void {
    for (const check of [...this.scopeWaiters]) check(true)
    const waiters = this.waiters
    this.waiters = []
    for (const w of waiters) w.fail(err)
  }

  private push(line: string): void {
    this.lines.push(line)
    if (this.lines.length > 400) this.lines.splice(0, this.lines.length - 400)
    this.o.output?.(line)
  }

  private setState(next: Phase): void {
    const prev = this.state
    this.state = next
    this.o.onChange?.(prev, next)
  }

  /** The page the client's scope shows, a scope that came before its link was the client included. */
  private follow(link: SessionLink): void {
    const scope = link.scope
    if (!scope) return
    if (link === this.client && scope.url) this.page = pathOf(scope.url)
    this.o.onScope?.(scope, link)
  }

  private changed(): void {
    this.o.onChange?.(this.state, this.state)
  }
}
