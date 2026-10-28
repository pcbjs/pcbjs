// Dev servers started by hand, over Vite's HMR WebSocket.

import * as path from 'node:path'
import { SelectRequest, hello } from './protocol'

export type { SelectRequest }

export interface DevInfo {
  port: number
  host?: string | boolean | null
  urls?: string[]
  root: string
  pid?: number
  startedAt?: string | number
  /** `/<scope>/` on a workspace server with several projects */
  route?: string
  scope?: string
  url?: string
  version?: string
  protocol?: number
  major?: number
}

export interface EditorActions {
  select(req: SelectRequest): void | Promise<void>
  log?(message: string): void
}

export interface SocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number): void
  on(event: 'open', cb: () => void): unknown
  on(event: 'message', cb: (data: unknown) => void): unknown
  on(event: 'close', cb: () => void): unknown
  on(event: 'error', cb: (err: Error) => void): unknown
}

export type SocketFactory = (url: string, protocol: string) => SocketLike

export type ConnectionState = 'connecting' | 'connected' | 'disconnected'

export interface BridgeOptions {
  editor: EditorActions
  createSocket: SocketFactory
  name?: string
  version?: string
  heartbeatMs?: number
  cursorDebounceMs?: number
  reconnectMinMs?: number
  reconnectMaxMs?: number
  extensions?: string[]
  onStateChange?: () => void
}

const OPEN = 1

export function socketUrl(info: DevInfo): string {
  let host = typeof info.host === 'string' ? info.host : ''
  if (!host || host === '0.0.0.0' || host === '::' || host === '[::]') host = 'localhost'
  if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`
  return `ws://${host}:${info.port}/`
}

export function isUnder(root: string, file: string): boolean {
  const rel = path.relative(root, file)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function parseMessage(raw: unknown): any {
  try {
    const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function validSelect(d: any): d is SelectRequest {
  return d && typeof d.file === 'string' && [d.line, d.col, d.endLine, d.endCol].every(n => Number.isInteger(n) && n >= 1)
}

export class Connection {
  state: ConnectionState = 'disconnected'
  private socket: SocketLike | undefined
  private heartbeat: NodeJS.Timeout | undefined
  private retry: NodeJS.Timeout | undefined
  private delay: number
  private stopped = true

  constructor(
    readonly key: string,
    public info: DevInfo,
    private readonly opts: Required<Omit<BridgeOptions, 'onStateChange'>> & { onStateChange?: () => void },
  ) {
    this.delay = opts.reconnectMinMs
  }

  get url(): string {
    return socketUrl(this.info)
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.delay = this.opts.reconnectMinMs
    this.open()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.retry)
    this.retry = undefined
    const socket = this.socket
    if (socket && socket.readyState === OPEN) this.sendRaw({ type: 'custom', event: 'pcbjs:ide:bye', data: { name: this.opts.name } })
    this.teardown()
    try {
      socket?.close(1000)
    } catch {}
    this.setState('disconnected')
  }

  send(event: string, data: unknown): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false
    this.sendRaw({ type: 'custom', event, data })
    return true
  }

  private sendRaw(msg: unknown): void {
    try {
      this.socket?.send(JSON.stringify(msg))
    } catch (err) {
      this.log(`send failed: ${(err as Error).message}`)
    }
  }

  private hello(): void {
    this.send('pcbjs:ide:hello', hello(this.opts.name, this.opts.version))
  }

  private open(): void {
    if (this.stopped) return
    this.setState('connecting')
    let socket: SocketLike
    try {
      socket = this.opts.createSocket(this.url, 'vite-hmr')
    } catch (err) {
      this.log(`connect to ${this.url} failed: ${(err as Error).message}`)
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    socket.on('open', () => {
      if (this.socket !== socket) return
      this.delay = this.opts.reconnectMinMs
      this.setState('connected')
      this.log(`connected to ${this.url}`)
      this.hello()
      this.heartbeat = setInterval(() => this.hello(), this.opts.heartbeatMs)
    })
    socket.on('message', raw => {
      if (this.socket === socket) this.handle(parseMessage(raw))
    })
    socket.on('error', err => {
      if (this.socket === socket) this.log(`socket error on ${this.url}: ${err.message}`)
    })
    socket.on('close', () => {
      if (this.socket !== socket) return
      this.teardown()
      this.setState('disconnected')
      this.scheduleReconnect()
    })
  }

  private handle(msg: any): void {
    if (!msg || typeof msg !== 'object') return
    switch (msg.type) {
      case 'connected':
        return
      case 'ping':
        this.sendRaw({ type: 'pong' })
        return
      case 'custom':
        if (msg.event === 'pcbjs:ide:select') {
          if (!validSelect(msg.data)) {
            this.log(`ignored malformed select: ${JSON.stringify(msg.data)}`)
            return
          }
          Promise.resolve(this.opts.editor.select(msg.data)).catch(err => this.log(`select failed: ${err?.message ?? err}`))
        }
        return
      default:
        return
    }
  }

  private teardown(): void {
    clearInterval(this.heartbeat)
    this.heartbeat = undefined
    this.socket = undefined
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retry) return
    const delay = this.delay
    this.delay = Math.min(this.delay * 2, this.opts.reconnectMaxMs)
    this.retry = setTimeout(() => {
      this.retry = undefined
      this.open()
    }, delay)
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return
    this.state = state
    this.opts.onStateChange?.()
  }

  private log(message: string): void {
    this.opts.editor.log?.(message)
  }
}

/** Keyed by the path of their dev.json. */
export class Bridge {
  readonly connections = new Map<string, Connection>()
  cursorSync = true
  private readonly opts: Required<Omit<BridgeOptions, 'onStateChange'>> & { onStateChange?: () => void }
  private pending: { file: string; line: number; col: number } | undefined
  private debounce: NodeJS.Timeout | undefined

  constructor(options: BridgeOptions) {
    this.opts = {
      name: 'vscode-pcbjs',
      version: '0.0.0',
      heartbeatMs: 15000,
      cursorDebounceMs: 80,
      reconnectMinMs: 500,
      reconnectMaxMs: 10000,
      extensions: ['.ts', '.tsx'],
      ...options,
    }
  }

  /** Restarts the socket when the address changed. */
  upsert(key: string, info: DevInfo, connect = true): Connection {
    let conn = this.connections.get(key)
    if (conn) {
      const moved = conn.url !== socketUrl(info) || conn.info.pid !== info.pid || conn.info.startedAt !== info.startedAt
      conn.info = info
      if (moved) {
        conn.stop()
        if (connect) conn.start()
      } else if (connect) conn.start()
      return conn
    }
    conn = new Connection(key, info, this.opts)
    this.connections.set(key, conn)
    if (connect) conn.start()
    this.opts.onStateChange?.()
    return conn
  }

  remove(key: string): void {
    const conn = this.connections.get(key)
    if (!conn) return
    conn.stop()
    this.connections.delete(key)
    this.opts.onStateChange?.()
  }

  connectAll(): void {
    for (const conn of this.connections.values()) conn.start()
  }

  disconnectAll(): void {
    for (const conn of this.connections.values()) conn.stop()
  }

  dispose(): void {
    clearTimeout(this.debounce)
    for (const key of [...this.connections.keys()]) this.remove(key)
  }

  /** The deepest root that contains the file. */
  route(file: string): Connection | undefined {
    let best: Connection | undefined
    for (const conn of this.connections.values()) {
      if (!isUnder(conn.info.root, file)) continue
      if (!best || conn.info.root.length > best.info.root.length) best = conn
    }
    return best
  }

  accepts(file: string): boolean {
    return this.opts.extensions.includes(path.extname(file).toLowerCase())
  }

  /** 1-based; the last of a burst goes. */
  cursor(file: string, line: number, col: number): void {
    if (!this.cursorSync || !this.accepts(file)) return
    this.pending = { file, line, col }
    clearTimeout(this.debounce)
    this.debounce = setTimeout(() => this.flush(), this.opts.cursorDebounceMs)
  }

  private flush(): void {
    this.debounce = undefined
    const p = this.pending
    this.pending = undefined
    if (!p) return
    this.route(p.file)?.send('pcbjs:ide:cursor', p)
  }
}

/** pcbjs.followDevJson is on unless false; pcbjs.connect asks until pcbjs.disconnect. */
export function followsDevJson(setting: boolean | undefined, asked: boolean): boolean {
  return asked || setting !== false
}
