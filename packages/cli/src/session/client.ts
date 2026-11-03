// A connection to a session's socket or pipe: hello, ready, `session/*` requests and the events it sends.
import { connect, type Socket } from 'node:net'
import { VERSION } from '../server/listen.js'
import { MAJOR, PROTOCOL, type Events, type Method, type Params, type Ready, type Result, type Role } from '@pcbjs/core/protocol'
import { frameLine, lineReader } from './frames.js'

export interface SessionConn {
  readonly ready: Ready
  request<M extends Method>(method: M, params?: Params<M>, timeoutMs?: number): Promise<Result<M>>
  onEvent(fn: <E extends keyof Events>(event: E, data: Events[E]) => void): void
  /** every JSON-RPC frame that answers none of this connection's requests: the language server's, `seq` left out */
  onRpc(fn: (msg: Record<string, unknown>) => void): void
  /** one raw frame, such as an LSP message for the connection's language server */
  send(msg: unknown): void
  /** resolves once the connection closed, from either side */
  readonly done: Promise<void>
  close(): void
}

/** Connected or not within `ms`. */
export function probe(socket: string, ms = 1000): Promise<boolean> {
  return new Promise(done => {
    const s = connect(socket)
    const t = setTimeout(() => finish(false), ms)
    const finish = (ok: boolean) => {
      clearTimeout(t)
      s.destroy()
      done(ok)
    }
    s.once('connect', () => finish(true))
    s.once('error', () => finish(false))
  })
}

export interface ConnectOptions {
  name?: string
  role?: Role
  project?: string
  token?: string
  timeoutMs?: number
  /** `findings` makes the connection an observer: an edit compiles while it is attached */
  capabilities?: string[]
}

export function connectSession(socket: string, o: ConnectOptions = {}): Promise<SessionConn> {
  return new Promise((ok, fail) => {
    const s: Socket = connect(socket)
    const pending = new Map<string, { ok(v: unknown): void; fail(e: Error): void }>()
    const listeners: ((event: string, data: unknown) => void)[] = []
    const rpcs: ((msg: Record<string, unknown>) => void)[] = []
    let seq = 0
    let ready: Ready | null = null
    let closed!: () => void
    const done = new Promise<void>(r => (closed = r))
    const timer = setTimeout(() => {
      s.destroy()
      fail(new Error(`the session at ${socket} did not answer hello`))
    }, o.timeoutMs ?? 10_000)
    const send = (msg: unknown) => {
      if (!s.destroyed) s.write(frameLine(msg))
    }
    const conn: SessionConn = {
      get ready() {
        return ready!
      },
      request(method, params, timeoutMs = 30_000) {
        // never a number, so an LSP client's ids on the same connection cannot meet these
        const id = `pcbjs-${++seq}`
        return new Promise((res, rej) => {
          const t = setTimeout(() => {
            pending.delete(id)
            rej(new Error(`${method} timed out`))
          }, timeoutMs)
          pending.set(id, {
            ok: v => {
              clearTimeout(t)
              res(v as any)
            },
            fail: e => {
              clearTimeout(t)
              rej(e)
            },
          })
          send({ jsonrpc: '2.0', id, method, params: params ?? {} })
        })
      },
      onEvent: fn => void listeners.push(fn as (event: string, data: unknown) => void),
      onRpc: fn => void rpcs.push(fn),
      send,
      done,
      close: () => void s.end(),
    }
    s.on(
      'data',
      lineReader(
        (m: any) => {
          if (m?.jsonrpc === '2.0' && pending.has(m.id)) {
            const p = pending.get(m.id)!
            pending.delete(m.id)
            if (m.error) p.fail(Object.assign(new Error(m.error.message), { code: m.error.code }))
            else p.ok(m.result)
            return
          }
          if (m?.jsonrpc === '2.0') {
            const { seq: _, ...rest } = m
            for (const fn of rpcs) fn(rest)
            return
          }
          if (typeof m?.event !== 'string') return
          if (m.event === 'pcbjs:ide:ready' && !ready) {
            ready = m.data
            clearTimeout(timer)
            ok(conn)
          }
          for (const l of listeners) l(m.event, m.data)
        },
        () => s.destroy(),
      ),
    )
    s.once('connect', () =>
      send({
        event: 'pcbjs:ide:hello',
        data: {
          name: o.name ?? 'pcbjs',
          version: VERSION,
          protocol: PROTOCOL,
          major: MAJOR,
          capabilities: o.capabilities ?? [],
          role: o.role ?? 'cli',
          ...(o.project ? { project: o.project } : {}),
          ...(o.token ? { token: o.token } : {}),
        },
      }),
    )
    s.once('error', e => {
      clearTimeout(timer)
      if (!ready) fail(e)
    })
    s.once('close', () => {
      for (const p of pending.values()) p.fail(new Error('the session closed the connection'))
      pending.clear()
      closed()
    })
  })
}
