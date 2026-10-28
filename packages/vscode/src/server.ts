// One `pcbjs dev --workspace` for the workspace, run from the project's own pcbjs.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn as nodeSpawn } from 'node:child_process'
import type { HostTarget, HostedClient } from './host'
import { BoardsInfo, LogEvent, ReadyInfo, ScopeInfo, ScopesInfo, devUrl, isUnder, samePath } from './protocol'

export type ServerState =
  { kind: 'stopped' } | { kind: 'starting'; attempt: number } | { kind: 'running'; url: string; info: ReadyInfo } | { kind: 'failed'; reason: string; hint?: 'install' | 'node' }

type Optional = 'onChange' | 'output' | 'env' | 'candidates' | 'onScope' | 'onGlobal'

export interface ChildLike {
  readonly pid?: number
  readonly stdout: NodeJS.ReadableStream | null
  readonly stderr: NodeJS.ReadableStream | null
  kill(signal?: NodeJS.Signals | number): boolean
  on(event: 'exit', cb: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  on(event: 'error', cb: (err: NodeJS.ErrnoException) => void): unknown
}

export interface SpawnOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  shell?: boolean
}

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildLike

export interface ServerOptions {
  /** the first is the child's cwd and the root its ready names */
  folders(): string[]
  /** the projects found in the workspace, searched for a pcbjs before the folders */
  candidates?(): string[]
  ideUrl(): string | Promise<string>
  nodePath?(): string
  spawn?: SpawnFn
  exists?(p: string): boolean
  realpath?(p: string): string
  env?: NodeJS.ProcessEnv
  output?(line: string): void
  onChange?(): void
  onScope?(scope: ScopeInfo): void
  /** no project has pcbjs installed and a global one runs instead */
  onGlobal?(bin: string): void
  backoffMinMs?: number
  backoffMaxMs?: number
  /** crashes in a row without a ready before giving up */
  maxRestarts?: number
  readyTimeoutMs?: number
  killTimeoutMs?: number
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

export function devArgs(folders: string[], ideUrl: string): string[] {
  return ['dev', '--workspace', ...folders, `--ide=${ideUrl}`, '--port', '0', '--host', '127.0.0.1']
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g

const defaultSpawn: SpawnFn = (command, args, options) => nodeSpawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

/** stopped, starting, running; a crash restarts after a backoff, failed after maxRestarts crashes or no ready in readyTimeoutMs. */
export class PcbjsServer implements HostTarget {
  state: ServerState = { kind: 'stopped' }
  boards: BoardsInfo | undefined
  scopes: ScopesInfo | undefined
  scope: ScopeInfo | undefined
  /** from `pcbjs/preview`, ahead of the scope's URL */
  previewUrl: string | undefined
  client: HostedClient | undefined
  /** the pcbjs binary of the last launch */
  bin: string | undefined
  /** the last 400 */
  readonly lines: string[] = []
  /** mirror stdout, which reaches the output channel already */
  readonly logs: LogEvent[] = []
  private child: ChildLike | undefined
  private crashes = 0
  private generation = 0
  private restartTimer: NodeJS.Timeout | undefined
  private readyTimer: NodeJS.Timeout | undefined
  private waiters: { ok(url: string): void; fail(err: Error): void }[] = []
  private exited: (() => void)[] = []
  private readonly o: Required<Omit<ServerOptions, Optional>> & Pick<ServerOptions, Optional>

  constructor(options: ServerOptions) {
    this.o = {
      nodePath: () => 'node',
      spawn: defaultSpawn,
      exists: fs.existsSync,
      realpath: fs.realpathSync,
      backoffMinMs: 500,
      backoffMaxMs: 30000,
      maxRestarts: 5,
      readyTimeoutMs: 60000,
      killTimeoutMs: 3000,
      ...options,
    }
  }

  get root(): string {
    return this.o.folders()[0] ?? ''
  }

  get folders(): string[] {
    return this.o.folders()
  }

  contains(file: string): boolean {
    return this.o.folders().some(f => isUnder(f, file))
  }

  get name(): string {
    return path.basename(this.root)
  }

  get pid(): number | undefined {
    return this.child?.pid
  }

  get url(): string | undefined {
    return this.state.kind === 'running' ? this.state.url : undefined
  }

  /** owns its root, so the dev.json fallback leaves it alone */
  get active(): boolean {
    return this.state.kind === 'starting' || this.state.kind === 'running'
  }

  owns(info: ReadyInfo): boolean {
    return (this.child?.pid !== undefined && info.pid === this.child.pid) || samePath(info.root, this.root)
  }

  /** A dev.json of this server or of a project it serves. */
  covers(info: { pid?: number; root: string }): boolean {
    if (!this.active) return false
    return (this.child?.pid !== undefined && info.pid === this.child.pid) || this.folders.some(f => samePath(f, info.root)) || this.contains(info.root)
  }

  async start(): Promise<void> {
    if (this.active) return
    clearTimeout(this.restartTimer)
    this.crashes = 0
    this.setState({ kind: 'starting', attempt: 0 })
    await this.launch()
  }

  /** SIGKILL after killTimeoutMs. */
  async stop(): Promise<void> {
    this.generation++
    clearTimeout(this.restartTimer)
    clearTimeout(this.readyTimer)
    this.restartTimer = this.readyTimer = undefined
    const child = this.child
    this.setState({ kind: 'stopped' })
    this.rejectWaiters(new Error('the pcbjs dev server was stopped'))
    if (child) await this.kill(child)
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  whenReady(): Promise<string> {
    if (this.state.kind === 'running') return Promise.resolve(this.state.url)
    if (this.state.kind === 'failed') return Promise.reject(new Error(this.state.reason))
    return new Promise((ok, fail) => this.waiters.push({ ok, fail }))
  }

  recent(n = 40): string[] {
    return this.lines.slice(-n)
  }

  send(event: string, data?: unknown): boolean {
    return !!this.client?.send(event, data)
  }

  onReady(info: ReadyInfo, client: HostedClient): void {
    if (!this.active) return
    this.client = client
    this.crashes = 0
    clearTimeout(this.readyTimer)
    this.readyTimer = undefined
    const url = devUrl(info)
    // a page of an earlier server, on another port, is gone
    if (this.previewUrl && !sameOrigin(this.previewUrl, url)) this.previewUrl = undefined
    this.setState({ kind: 'running', url, info })
    const waiters = this.waiters
    this.waiters = []
    for (const w of waiters) w.ok(url)
  }

  onBoards(data: BoardsInfo): void {
    this.boards = data
    this.o.onChange?.()
  }

  onScopes(data: ScopesInfo): void {
    this.scopes = data
    this.o.onChange?.()
  }

  onScope(data: ScopeInfo): void {
    this.scope = data
    if (data.url) this.previewUrl = data.url
    this.o.onScope?.(data)
    this.o.onChange?.()
  }

  onLog(ev: LogEvent): void {
    this.logs.push(ev)
    if (this.logs.length > 200) this.logs.splice(0, this.logs.length - 200)
  }

  onClosed(client: HostedClient): void {
    if (this.client !== client) return
    this.client = undefined
    this.o.onChange?.()
  }

  private async launch(): Promise<void> {
    const gen = ++this.generation
    const folders = this.o.folders()
    let bin: string | undefined
    for (const dir of [...(this.o.candidates?.() ?? []), ...folders]) if ((bin = findBinary(dir, this.o.exists))) break
    const global = !bin && findGlobal(this.o.env ?? process.env, this.o.exists)
    if (global) {
      bin = global
      if (this.bin !== bin) this.o.onGlobal?.(bin)
    }
    if (!bin) return this.fail(`pcbjs is not installed in ${this.root} or above it, nor in a project of the workspace. Run ${INSTALL_HINT}.`, 'install')
    this.bin = bin
    let url: string
    try {
      url = await this.o.ideUrl()
    } catch (err) {
      if (gen === this.generation) this.fail((err as Error).message)
      return
    }
    if (gen !== this.generation) return
    const run = launcher(bin, this.o.nodePath(), this.o.realpath)
    const node = run.command
    const args = [...run.args, ...devArgs(folders, url)]
    this.push(`$ ${node} ${args.map(a => (a.startsWith('--ide=') ? '--ide=<host>' : a)).join(' ')}`)
    let child: ChildLike
    try {
      child = this.o.spawn(node, args, { cwd: this.root, env: { ...(this.o.env ?? process.env), NO_COLOR: '1' }, ...(run.shell ? { shell: true } : {}) })
    } catch (err) {
      return this.fail(`cannot run ${node}: ${(err as Error).message}`, 'node')
    }
    this.child = child
    this.pipe(child.stdout)
    this.pipe(child.stderr)
    child.on('error', err => {
      if (gen !== this.generation) return
      this.child = undefined
      this.fail(`cannot run ${node}: ${err.message}`, err.code === 'ENOENT' ? 'node' : undefined)
    })
    child.on('exit', (code, signal) => this.exit(gen, child, code, signal))
    clearTimeout(this.readyTimer)
    this.readyTimer = setTimeout(() => {
      if (gen !== this.generation || this.state.kind !== 'starting') return
      this.fail(`the dev server did not report ready within ${Math.round(this.o.readyTimeoutMs / 1000)} s. Is the installed pcbjs new enough to support --ide and --workspace?`)
    }, this.o.readyTimeoutMs)
  }

  private exit(gen: number, child: ChildLike, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child === child) this.child = undefined
    const done = this.exited
    this.exited = []
    for (const d of done) d()
    if (gen !== this.generation || !this.active) return
    this.push(`pcbjs dev exited with ${signal ? `signal ${signal}` : `code ${code}`}`)
    clearTimeout(this.readyTimer)
    this.client = undefined
    this.crashes++
    if (this.crashes > this.o.maxRestarts) {
      this.fail(`pcbjs dev exited ${this.crashes} times in a row, last with ${signal ? `signal ${signal}` : `code ${code}`}`)
      return
    }
    const delay = Math.min(this.o.backoffMinMs * 2 ** (this.crashes - 1), this.o.backoffMaxMs)
    this.push(`restarting in ${delay} ms`)
    this.setState({ kind: 'starting', attempt: this.crashes })
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      if (gen === this.generation && this.state.kind === 'starting') void this.launch()
    }, delay)
  }

  private fail(reason: string, hint?: 'install' | 'node'): void {
    this.generation++
    clearTimeout(this.restartTimer)
    clearTimeout(this.readyTimer)
    this.restartTimer = this.readyTimer = undefined
    this.push(reason)
    const child = this.child
    this.setState(hint ? { kind: 'failed', reason, hint } : { kind: 'failed', reason })
    this.rejectWaiters(new Error(reason))
    if (child) void this.kill(child)
  }

  private kill(child: ChildLike): Promise<void> {
    return new Promise(done => {
      if (this.child !== child) return done()
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {}
        setTimeout(finish, 200)
      }, this.o.killTimeoutMs)
      const finish = () => {
        clearTimeout(timer)
        if (this.child === child) this.child = undefined
        done()
      }
      this.exited.push(finish)
      try {
        child.kill('SIGTERM')
      } catch {
        finish()
      }
    })
  }

  private rejectWaiters(err: Error): void {
    const waiters = this.waiters
    this.waiters = []
    for (const w of waiters) w.fail(err)
  }

  private pipe(stream: NodeJS.ReadableStream | null): void {
    if (!stream) return
    let rest = ''
    stream.on('data', (chunk: Buffer | string) => {
      const text = rest + chunk.toString()
      const parts = text.split(/\r?\n/)
      rest = parts.pop() ?? ''
      for (const line of parts) this.push(line.replace(ANSI, ''))
    })
    stream.on('end', () => {
      if (rest) this.push(rest.replace(ANSI, ''))
      rest = ''
    })
  }

  private push(line: string): void {
    this.lines.push(line)
    if (this.lines.length > 400) this.lines.splice(0, this.lines.length - 400)
    this.o.output?.(line)
  }

  private setState(state: ServerState): void {
    this.state = state
    this.o.onChange?.()
  }
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}
