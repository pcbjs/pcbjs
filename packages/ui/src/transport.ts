// A viewer page's one channel to its session, free of Vue and the DOM so Node imports it in the tests: the WebSocket at
// /__pcbjs/session, a hello as a viewer, `session/*` methods answered by id and the events the session numbers per connection.
import { MAJOR, PROTOCOL, type Events, type Hello, type Method, type Params, type Result } from '@pcbjs/core/protocol'

/** Every frame as it comes: the connection's gapless `seq`, an event's name and data, or an answer's id. */
export interface Frame {
  seq?: number
  event?: string
  data?: any
  id?: number
  result?: unknown
  error?: { message: string }
}

/** What a page speaks to its session through; the session socket in dev, a fake in the tests. */
export interface Transport {
  request<M extends Method>(method: M, params: Params<M>): Promise<Result<M>>
  /** a method nothing answers */
  notify<M extends Method>(method: M, params: Params<M>): void
  on<E extends keyof Events>(event: E, fn: (data: Events[E]) => void): void
  /** every frame, before the handlers of its event */
  frames(fn: (f: Frame) => void): void
  /** the connection went, the server with it */
  closed(fn: () => void): void
  /** connect, once every handler is on, so no event of the first frames goes unheard */
  open(): void
}

/** The hello a viewer page says. */
export const viewerHello = (): Hello => ({ name: 'pcbjs viewer', version: '', protocol: PROTOCOL, major: MAJOR, capabilities: [], role: 'viewer' })

/** The session socket of the page's own server; frames sent before it opens wait, its hello first. */
export function sessionSocket(url: string, socket: (url: string) => WebSocket = u => new WebSocket(u)): Transport {
  let ws: WebSocket | null = null
  const waits = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>()
  const handlers = new Map<string, ((d: any) => void)[]>()
  const watchers: ((f: Frame) => void)[] = []
  const closers: (() => void)[] = []
  const queue: string[] = [JSON.stringify({ event: 'pcbjs:ide:hello', data: viewerHello() })]
  let id = 0
  const send = (m: object) => {
    const text = JSON.stringify(m)
    if (ws?.readyState === 1) ws.send(text)
    else queue.push(text)
  }
  const message = (e: MessageEvent) => {
    let f: Frame
    try {
      f = JSON.parse(String(e.data))
    } catch {
      return
    }
    for (const fn of watchers) fn(f)
    if (f.event) for (const fn of handlers.get(f.event) ?? []) fn(f.data)
    const w = f.id !== undefined ? waits.get(f.id) : undefined
    if (!w) return
    waits.delete(f.id!)
    if (f.error) w.fail(new Error(f.error.message))
    else w.ok(f.result)
  }
  const close = () => {
    for (const w of waits.values()) w.fail(new Error('the session closed'))
    waits.clear()
    for (const fn of closers) fn()
  }
  return {
    request: (method, params) =>
      new Promise((ok, fail) => {
        waits.set(++id, { ok, fail })
        send({ jsonrpc: '2.0', id, method, params })
      }),
    notify: (method, params) => send({ jsonrpc: '2.0', method, params }),
    on(event, fn) {
      const list = handlers.get(event) ?? []
      handlers.set(event, [...list, fn as (d: any) => void])
    },
    frames: fn => void watchers.push(fn),
    closed: fn => void closers.push(fn),
    open() {
      if (ws) return
      const w = (ws = socket(url))
      w.onopen = () => {
        for (const t of queue.splice(0)) w.send(t)
      }
      w.onmessage = message
      w.onclose = close
    },
  }
}

/** The session socket's URL from a page's own location. */
export const sessionUrl = (loc: Pick<Location, 'protocol' | 'host'>): string => `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/__pcbjs/session`
