// The connections of a server: socket, pipe and the WebSocket at /__pcbjs/session, editors, agents, the CLI and viewer pages alike. Each
// says hello, gets ready with its mode, and sends `session/*` requests, answered here, or LSP, one language server per connection.
import { timingSafeEqual } from 'node:crypto'
import { WRITE, compat, type By, type Events, type Hello, type Method, type Mode, type Observe, type Params, type Ready, type Result, type Run } from '@pcbjs/core/protocol'
import type { LspHub } from './lsp.js'
import { RPC_ERRORS, isRequest, isRpc, parseSessionHello, type EditMode } from './frames.js'
import { NO_HELLO, STICKY, helloWarning } from './ide-protocol.js'

export interface Transport {
  kind: 'socket' | 'tcp'
  /** a socket or pipe is the user's own; a TCP peer on 127.0.0.1 or ::1 */
  loopback: boolean
  /** the token in the WebSocket URL's `?token=` */
  token?: string
  /** one frame: `head`, then `tail` when the frame was encoded once for every connection */
  send(head: string, tail?: Buffer): boolean
  close(): void
}

/** An event encoded once for every connection: its JSON after the opening brace, which each connection's `{"seq":n,` precedes. */
export interface Encoded<E extends keyof Events = keyof Events> {
  event: E
  data: Events[E]
  tail: Buffer
}
export const encode = <E extends keyof Events>(event: E, data: Events[E]): Encoded<E> => ({ event, data, tail: Buffer.from(JSON.stringify({ event, data }).slice(1)) })

/** One frame in a viewer's timeline: never its data. */
export interface Sent {
  t: number
  event: string
  seq: number
  run?: Run
  facet?: string
  board?: string
  hash?: string
}
/** ms of frames kept per viewer for an incident */
export const TIMELINE_MS = 60_000

export interface Client {
  readonly id: string
  readonly transport: Transport
  readonly hello: Hello | null
  readonly mode: Mode
  readonly at: number
  /** the frames sent so far; each carries its number as `seq` */
  readonly seq: number
  /** what the agent said it does through `session/describe` */
  about: About
  /** what a viewer shows, from `session/observe`; null before it said */
  observe: Observe | null
  /** a viewer's frames of the last minute, for an incident */
  readonly sent: readonly Sent[]
  by(): By
  send(msg: unknown): boolean
  event<E extends keyof Events>(name: E, data: Events[E]): boolean
  /** an event encoded once, its `seq` spliced in */
  post(e: Encoded): boolean
  /** a frame from the peer */
  receive(msg: unknown): void
  /** the transport closed */
  closed(): void
  /** runs once the connection closes, at once when it has */
  onClose(fn: () => void): void
}

/** An agent's own account of its work: one line of task, up to five of plan, the last progress line. */
export interface About {
  task?: string
  plan?: string[]
  progress?: string
}

/** A method's handler; its params come off the wire as the client sent them, so it checks what it reads. */
export type Handler<M extends Method> = (params: Params<M>, client: Client) => Result<M> | Promise<Result<M>>
/** Every method answered, none extra: `tsc -b` fails on either. */
export type Handlers = { [M in Method]: Handler<M> }

export interface ClientsOptions {
  /** the session's id, edit mode and token; an id of '' outside a session */
  info(): { session: string; edit: EditMode; token?: string }
  ready(): Omit<Ready, 'mode' | 'session'> | null
  hub(): LspHub | null
  /** undefined until the session made them */
  methods(): Handlers | undefined
  /** a hello naming a root no project holds attaches it */
  attach?(root: string): Promise<void> | void
  /** a connection said hello and got ready */
  greeted?(c: Client): void
  log(line: string): void
  onChange?(): void
}

export interface Clients {
  add(t: Transport): Client
  list(): Client[]
  get(id: string): Client | undefined
  size(): number
  /** an event to every connection */
  broadcast<E extends keyof Events>(name: E, data: Events[E]): void
  /** an editor event to every connection whose hello takes it, `boards` for `pcbjs:ide:boards`; a sticky one goes again to each later hello */
  relay<E extends keyof Events>(name: E, data: Events[E]): void
  /** ready again to every connection that said hello, as the projects changed */
  ready(): void
  close(): void
}

/** Methods a socket or pipe may call even when every connection is read-only. */
const LOCAL_METHODS: ReadonlySet<string> = new Set<Method>(['session/stop', 'session/attach', 'session/detach'])

const sameToken = (a: string | undefined, b: string | undefined): boolean => {
  if (!a || !b) return false
  const x = Buffer.from(a),
    y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** localhost: socket, pipe and loopback read-write; all: beyond loopback with the token; none: nobody. */
export function modeOf(t: Pick<Transport, 'kind' | 'loopback'>, edit: EditMode, token: string | undefined, given: string | undefined): Mode {
  if (edit === 'none') return 'ro'
  if (t.kind === 'socket' || t.loopback) return 'rw'
  return edit === 'all' && sameToken(token, given) ? 'rw' : 'ro'
}

export function clientsOf(o: ClientsOptions): Clients {
  const all = new Map<string, Client>()
  const sticky = new Map<keyof Events, unknown>()
  let seq = 0
  const takes = (c: Client, name: string) => !!c.hello?.capabilities.includes(name.slice(name.lastIndexOf(':') + 1))

  // a notification, sent without an id, gets no answer
  const reply = (c: Client, id: number | string | undefined, result: unknown) => id != null && c.send({ jsonrpc: '2.0', id, result: result ?? null })
  const fail = (c: Client, id: number | string | undefined, code: number, message: string) => id != null && c.send({ jsonrpc: '2.0', id, error: { code, message } })
  const viewer = (c: Client) => c.hello?.role === 'viewer'

  const request = async (c: Client, m: { id?: number | string; method: string; params?: any }) => {
    if (compat(c.hello) === 'incompatible' && !(c.transport.kind === 'socket' && (m.method === 'session/status' || m.method === 'session/stop')))
      return fail(c, m.id, RPC_ERRORS.invalid, 'A compatible pcbjs hello is required before session requests; update the client or restart the server.')
    const local = LOCAL_METHODS.has(m.method)
    if (c.mode === 'ro' && ((WRITE as ReadonlySet<string>).has(m.method) || (local && c.transport.kind !== 'socket')))
      return fail(c, m.id, RPC_ERRORS.readOnly, `${m.method} needs a read-write connection; this one is read-only, see pcbjs docs session`)
    const all = o.methods()
    const fn = all && Object.hasOwn(all, m.method) ? (all[m.method as Method] as (p: unknown, c: Client) => unknown) : undefined
    // what any connection synced before the request counts for it
    await o.hub()?.flushAll()
    if (!fn) return fail(c, m.id, RPC_ERRORS.notFound, `no method ${m.method} in this session`)
    try {
      reply(c, m.id, await fn(m.params ?? {}, c))
    } catch (e: any) {
      fail(c, m.id, RPC_ERRORS.failed, String(e?.message ?? e))
    }
  }

  const add = (t: Transport): Client => {
    const id = `c${++seq}`
    let hello: Hello | null = null
    let mode = modeOf(t, o.info().edit, o.info().token, t.token)
    let open = true
    let sent = 0
    const timeline: Sent[] = []
    const closers: (() => void)[] = []
    const note = (seq: number, event: string | undefined, d: any) => {
      if (!event || !viewer(c)) return
      const t = Date.now()
      timeline.push({ t, event, seq, ...(d?.run ? { run: d.run } : {}), ...(d?.facet ? { facet: d.facet, board: d.board, hash: d.hash } : {}) })
      while (timeline.length && timeline[0].t < t - TIMELINE_MS) timeline.shift()
    }
    const c: Client = {
      id,
      transport: t,
      at: Date.now(),
      get hello() {
        return hello
      },
      about: {},
      observe: null,
      sent: timeline,
      get mode() {
        return mode
      },
      by: () => ({
        client: id,
        name: hello?.name ?? (t.kind === 'socket' ? 'socket' : 'tcp'),
        ...(hello?.role ? { role: hello.role } : {}),
        ...(c.about.task ? { task: c.about.task } : {}),
      }),
      get seq() {
        return sent
      },
      // gapless per connection, so a view can tell it missed a frame
      send(msg: any) {
        if (!open) return false
        note(++sent, msg?.event, msg?.data)
        return t.send(JSON.stringify({ ...msg, seq: sent }))
      },
      event: (name, data) => c.send({ event: name, data }),
      post(e) {
        if (!open) return false
        note(++sent, e.event, e.data)
        return t.send(`{"seq":${sent},`, e.tail)
      },
      receive(msg: any) {
        if (!open) return
        if (isRpc(msg)) {
          if (typeof msg.method === 'string' && msg.method.startsWith('session/') && (isRequest(msg) || msg.id === undefined)) void request(c, msg)
          else o.hub()?.message(c, msg, m => c.send(m))
          return
        }
        if (msg?.event === 'pcbjs:ide:hello') void greet(msg.data)
      },
      onClose(fn) {
        if (open) closers.push(fn)
        else fn()
      },
      closed() {
        if (!open) return
        open = false
        all.delete(id)
        for (const fn of closers.splice(0)) fn()
        o.hub()?.drop(c)
        if (hello && !viewer(c)) o.log(`${c.by().name} detached`)
        o.onChange?.()
      },
    }
    const greet = async (data: unknown) => {
      const h = parseSessionHello(data)
      if (!h) {
        c.event('pcbjs:ide:log', { level: 'warn', text: NO_HELLO })
        return
      }
      const old = helloWarning(h)
      if (old) c.event('pcbjs:ide:log', { level: 'warn', text: old })
      const first = !hello
      hello = h
      mode = modeOf(t, o.info().edit, o.info().token, h.token ?? t.token)
      if (mode === 'rw' && compat(h) !== 'incompatible' && h.project) await o.attach?.(h.project)
      const r = o.ready()
      if (r) c.event('pcbjs:ide:ready', { ...r, session: o.info().session, mode } satisfies Ready)
      for (const name of STICKY) if (sticky.has(name) && takes(c, name)) c.event(name, sticky.get(name) as Events[typeof name])
      if (first && !viewer(c)) o.log(`${h.name}${h.role ? ` (${h.role})` : ''} attached, ${mode === 'rw' ? 'read-write' : 'read-only'}`)
      if (first) o.greeted?.(c)
      o.onChange?.()
    }
    all.set(id, c)
    o.onChange?.()
    return c
  }

  return {
    add,
    list: () => [...all.values()],
    get: id => all.get(id),
    size: () => all.size,
    broadcast(name, data) {
      for (const c of all.values()) c.event(name, data)
    },
    ready() {
      const r = o.ready()
      if (r) for (const c of all.values()) if (c.hello) c.event('pcbjs:ide:ready', { ...r, session: o.info().session, mode: c.mode } satisfies Ready)
    },
    relay(name, data) {
      if ((STICKY as readonly string[]).includes(name)) sticky.set(name, data)
      for (const c of all.values()) if (takes(c, name)) c.event(name, data)
    },
    close() {
      for (const c of [...all.values()]) c.transport.close()
    },
  }
}
