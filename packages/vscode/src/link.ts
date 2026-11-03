// One connection to a session: its socket or pipe, else the WebSocket at /__pcbjs/session; events, the language client's JSON-RPC
// and the extension's own `session/*` requests on it. docs/session.md has the frames.

import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'
import WebSocket from 'ws'
import type { IdeBoardsMsg, LogMsg, Method, Params, Ready, Result, ScopeMsg, ScopesMsg } from '@pcbjs/core/protocol'
import { EVENTS, hello, parseEnvelope, parseRpc, mismatch, validBoards, validReady } from './protocol'
import type { DocPeer, PcbjsSession } from './lsp-client'

/** `.pcbjs/dev.json` of a project a session serves. */
export interface DevInfo {
  session: string
  pid: number
  root: string
  url: string
  socket: string
  token?: string
  checkout?: string
}

export const devJsonOf = (root: string): string => path.join(root, '.pcbjs', 'dev.json')

export function readDevInfo(root: string, read: (p: string) => string = p => fs.readFileSync(p, 'utf8')): DevInfo | undefined {
  try {
    const d = JSON.parse(read(devJsonOf(root)))
    return typeof d?.session === 'string' && typeof d.pid === 'number' && typeof d.root === 'string' ? d : undefined
  } catch {
    return undefined
  }
}

export const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e: any) {
    return e?.code === 'EPERM'
  }
}

/** The extension's request ids, never a number, so the language client's replies and its own never meet. */
const ID = 'pcbjs:'

/** The language client over a link, once it answered `initialize`. */
export interface Lsp {
  readonly session: PcbjsSession
  /** what the document handoff opens and closes documents on */
  readonly peer: DocPeer
  dispose(): Promise<void>
}

export interface LinkEvents {
  onReady?(info: Ready, link: SessionLink): void
  onBoards?(data: IdeBoardsMsg, link: SessionLink): void
  onScopes?(data: ScopesMsg, link: SessionLink): void
  onScope?(data: ScopeMsg, link: SessionLink): void
  onLog?(data: LogMsg): void
  /** any other event, `session/event`, `session/message`, `session/state` */
  onEvent?(event: string, data: any, link: SessionLink): void
  onMismatch?(notice: string): void
}

export interface LinkOptions extends LinkEvents {
  name: string
  version: string
  /** the root the connection's requests default to */
  project?: string
  timeoutMs?: number
  signal?: AbortSignal
}

/** A connected session, ready said. */
export class SessionLink {
  info: Ready | undefined
  boards: IdeBoardsMsg | undefined
  scopes: ScopesMsg | undefined
  /** the project the session shows */
  scope: ScopeMsg | undefined
  /** its language client while it runs */
  lsp: Lsp | undefined
  /** the session said bye: it ended on purpose */
  saidBye = false
  private nextId = 1
  private readonly pending = new Map<string, { ok(v: unknown): void; fail(e: Error): void }>()
  private readonly rpcListeners = new Set<(msg: unknown) => void>()
  private readonly closeListeners = new Set<() => void>()
  private closed = false
  readonly events: LinkEvents

  private constructor(
    readonly dev: DevInfo,
    private readonly write: (text: string) => boolean,
    private readonly end: () => void,
    o: LinkOptions,
  ) {
    this.events = o
  }

  /** Over the socket or pipe dev.json names, else the WebSocket of its URL; resolves on ready. */
  static connect(dev: DevInfo, o: LinkOptions): Promise<SessionLink> {
    return dev.socket && (process.platform === 'win32' || fs.existsSync(dev.socket)) ? socketLink(dev, o) : wsLink(dev, o)
  }

  get open(): boolean {
    return !this.closed
  }

  get root(): string | undefined {
    return this.info?.root
  }

  get session(): string {
    return this.info?.session ?? this.dev.session
  }

  /** Every root the session serves: its folders and projects. */
  get roots(): string[] {
    const i = this.info
    if (!i) return [this.dev.root]
    return [i.root, ...(i.folders ?? []), ...(i.projects ?? []).map(p => p.root)]
  }

  send(event: string, data?: unknown): boolean {
    return this.frame(data === undefined ? { event } : { event, data })
  }

  sendRpc(msg: unknown): boolean {
    return this.frame(msg)
  }

  onRpc(cb: (msg: unknown) => void): () => void {
    this.rpcListeners.add(cb)
    return () => this.rpcListeners.delete(cb)
  }

  onClose(cb: () => void): () => void {
    if (this.closed) cb()
    else this.closeListeners.add(cb)
    return () => this.closeListeners.delete(cb)
  }

  request<M extends Method>(method: M, params?: Params<M>, timeoutMs = 30000): Promise<Result<M>> {
    const id = `${ID}${this.nextId++}`
    return new Promise<Result<M>>((ok, fail) => {
      const t = setTimeout(() => {
        this.pending.delete(id)
        fail(new Error(`${method} timed out`))
      }, timeoutMs)
      t.unref?.()
      this.pending.set(id, {
        ok: v => (clearTimeout(t), ok(v as Result<M>)),
        fail: e => (clearTimeout(t), fail(e)),
      })
      if (!this.frame({ jsonrpc: '2.0', id, method, params: params ?? {} })) {
        this.pending.delete(id)
        clearTimeout(t)
        fail(new Error('the session connection is closed'))
      }
    })
  }

  /** Disconnect: the session sees the connection close and keeps serving its other clients. */
  close(): void {
    if (this.closed) return
    try { this.end() } finally { this.closed_() }
  }

  private frame(msg: unknown): boolean {
    if (this.closed) return false
    try {
      return this.write(JSON.stringify(msg))
    } catch {
      return false
    }
  }

  /** @internal a frame from the session */
  receive(raw: unknown, ready: (link: SessionLink) => void): void {
    if (this.closed) return
    const rpc = parseRpc(raw) as { id?: unknown; result?: unknown; error?: { message: string } } | undefined
    if (rpc) {
      const p = typeof rpc.id === 'string' && rpc.id.startsWith(ID) ? this.pending.get(rpc.id) : undefined
      if (p) {
        this.pending.delete(rpc.id as string)
        if (rpc.error) p.fail(new Error(rpc.error.message))
        else p.ok(rpc.result)
        return
      }
      for (const cb of [...this.rpcListeners]) cb(rpc)
      return
    }
    const msg = parseEnvelope(raw)
    if (!msg) return
    const e = this.events
    switch (msg.event) {
      case EVENTS.ready:
        if (!validReady(msg.data)) return
        if (!this.info) {
          const notice = mismatch(msg.data)
          if (notice) e.onMismatch?.(notice)
        }
        this.info = msg.data
        ready(this)
        e.onReady?.(msg.data, this)
        return
      case EVENTS.boards:
        if (!validBoards(msg.data)) return
        this.boards = msg.data
        e.onBoards?.(msg.data, this)
        return
      case EVENTS.scopes:
        if (!msg.data || !Array.isArray(msg.data.scopes)) return
        this.scopes = msg.data
        e.onScopes?.(msg.data, this)
        return
      case EVENTS.scope:
        if (!msg.data || typeof msg.data.scope !== 'string') return
        this.scope = msg.data
        e.onScope?.(msg.data, this)
        return
      case EVENTS.log:
        e.onLog?.({ level: String(msg.data?.level ?? 'info'), text: String(msg.data?.text ?? '') })
        return
      case EVENTS.bye:
        this.saidBye = true
        return
      default:
        e.onEvent?.(msg.event, msg.data, this)
    }
  }

  /** @internal the transport closed */
  closed_(): void {
    if (this.closed) return
    this.closed = true
    for (const p of this.pending.values()) p.fail(new Error('the session closed the connection'))
    this.pending.clear()
    for (const cb of [...this.closeListeners]) cb()
    this.closeListeners.clear()
    this.rpcListeners.clear()
  }

  /** @internal */
  static make(dev: DevInfo, write: (text: string) => boolean, end: () => void, o: LinkOptions): SessionLink {
    return new SessionLink(dev, write, end, o)
  }
}

const helloFrame = (o: LinkOptions, token?: string) =>
  JSON.stringify({ event: EVENTS.hello, data: { ...hello(o.name, o.version), role: 'editor', ...(o.project ? { project: o.project } : {}), ...(token ? { token } : {}) } })

/** Settles once: ready, or the first failure before it. */
function handshake(o: LinkOptions, dev: DevInfo, start: (settle: { ready(l: SessionLink): void; fail(e: Error): void }) => () => void): Promise<SessionLink> {
  return new Promise((ok, fail) => {
    let done = false
    let cancel: (() => void) | undefined, failed = false
    const t = setTimeout(() => settle.fail(new Error(`the session at ${dev.socket || dev.url} did not answer hello`)), o.timeoutMs ?? 10000)
    const settle = {
      ready(l: SessionLink) {
        if (done) return
        done = true
        clearTimeout(t)
        o.signal?.removeEventListener('abort', abort)
        ok(l)
      },
      fail(e: Error) {
        if (done) return
        done = true
        failed = true
        clearTimeout(t)
        o.signal?.removeEventListener('abort', abort)
        cancel?.()
        fail(e)
      },
    }
    const abort = () => settle.fail(new Error('the session connection was cancelled'))
    if (o.signal?.aborted) return abort()
    o.signal?.addEventListener('abort', abort, { once: true })
    try {
      cancel = start(settle)
      if (failed) cancel()
    } catch (e) { settle.fail(e as Error) }
  })
}

function socketLink(dev: DevInfo, o: LinkOptions): Promise<SessionLink> {
  return handshake(o, dev, settle => {
    const s = net.connect(dev.socket)
    const link = SessionLink.make(
      dev,
      text => (s.destroyed ? false : s.write(text + '\n') || true),
      () => s.destroy(),
      o,
    )
    let rest = ''
    s.on('data', chunk => {
      rest += chunk.toString()
      let nl: number
      while ((nl = rest.indexOf('\n')) >= 0) {
        const line = rest.slice(0, nl)
        rest = rest.slice(nl + 1)
        if (line.trim()) link.receive(line, settle.ready)
      }
    })
    s.once('connect', () => s.write(helloFrame(o, dev.token) + '\n'))
    s.once('error', e => settle.fail(e))
    s.once('close', () => {
      settle.fail(new Error('the session closed the connection'))
      link.closed_()
    })
    return () => link.close()
  })
}

function wsLink(dev: DevInfo, o: LinkOptions): Promise<SessionLink> {
  return handshake(o, dev, settle => {
    const u = new URL('/__pcbjs/session', dev.url)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    if (dev.token) u.searchParams.set('token', dev.token)
    const ws = new WebSocket(u, { maxPayload: 16 * 1024 * 1024 })
    const link = SessionLink.make(
      dev,
      text => {
        if (ws.readyState !== WebSocket.OPEN) return false
        ws.send(text)
        return true
      },
      () => ws.terminate(),
      o,
    )
    ws.on('open', () => ws.send(helloFrame(o, dev.token)))
    ws.on('message', raw => link.receive(raw, settle.ready))
    ws.on('error', e => settle.fail(e))
    ws.on('close', () => {
      settle.fail(new Error('the session closed the connection'))
      link.closed_()
    })
    return () => link.close()
  })
}
