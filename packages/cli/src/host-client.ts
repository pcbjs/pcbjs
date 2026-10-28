// `pcbjs dev --ide=<url>` dials the editor's WebSocket; `{ event, data }` frames both ways. docs/ide-bridge.md has the protocol.
import WebSocket from 'ws'

/** Additive, the same number as @pcbjs/lsp's PROTOCOL. */
export const IDE_PROTOCOL = 2
/** Bumped only by a change an older peer cannot survive. */
export const IDE_MAJOR = 1

export interface HostHello {
  name: string
  version: string
  protocol: number
  major: number
  capabilities: string[] | null
}
export interface HostCursor {
  file: string
  line: number
  col: number
}
export interface HostFocus {
  file: string
}

export interface HostClientOptions {
  /** `ws://127.0.0.1:<port>/<token>`, already checked with parseIdeUrl */
  url: string
  onHello?(hello: HostHello): void
  onCursor?(cursor: HostCursor): void
  onFocus?(focus: HostFocus): void
  onClose?(close: HostFocus): void
  onBye?(): void
  onRpc?(msg: unknown): void
  /** once per connection and once per run of failed attempts */
  onStatus?(status: 'connected' | 'disconnected' | 'unreachable', detail?: string): void
  /** ms, doubled per failed attempt up to maxDelay */
  minDelay?: number
  maxDelay?: number
}

export interface HostClient {
  /** False while disconnected; STICKY events are sent again on every reconnect. */
  send(event: string, data: unknown): boolean
  sendRpc(msg: unknown): boolean
  connected(): boolean
  hello(): HostHello | null
  close(): void
}

export const STICKY = ['pcbjs:ide:ready', 'pcbjs:ide:scopes', 'pcbjs:ide:scope', 'pcbjs:ide:boards'] as const

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** Throws a message for the CLI unless ws or wss and loopback, or allowRemote. */
export function parseIdeUrl(url: string, allowRemote = false): URL {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new Error(`--ide needs a WebSocket URL such as ws://127.0.0.1:<port>/<token>, got ${JSON.stringify(url)}`)
  }
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') throw new Error(`--ide needs a ws:// or wss:// URL, got ${u.protocol}`)
  if (!allowRemote && !LOOPBACK.has(u.hostname)) throw new Error(`--ide only dials 127.0.0.1, localhost or [::1], got ${u.hostname}; pass --ide-allow-remote to dial another host`)
  return u
}

/** Without path and query, so the token never reaches the terminal. */
export const redactUrl = (url: string): string => {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return 'the ide host'
  }
}

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)
const int = (v: unknown, d: number) => (Number.isInteger(v) ? (v as number) : d)

/** What `ready` offers: the events it takes, and `lsp` when @pcbjs/lsp resolves. */
export function serverCapabilities(): string[] {
  const caps = ['cursor', 'focus', 'close', 'bye']
  try {
    import.meta.resolve('@pcbjs/lsp')
    caps.push('lsp')
  } catch {}
  return caps
}

export const readyProtocol = () => ({ protocol: IDE_PROTOCOL, major: IDE_MAJOR, capabilities: serverCapabilities() })

/** A hello without `protocol` comes from a protocol 1 editor. */
export function parseHello(d: any): HostHello {
  return {
    name: str(d?.name, 'ide'),
    version: str(d?.version),
    protocol: int(d?.protocol, 1),
    major: int(d?.major, 1),
    capabilities: Array.isArray(d?.capabilities) ? d.capabilities.filter((c: unknown) => typeof c === 'string') : null,
  }
}

/** Null unless the editor's protocol major is older than this server's. */
export function helloWarning(h: HostHello): string | null {
  if (h.major >= IDE_MAJOR) return null
  return `[pcbjs] the editor extension ${h.name} ${h.version} speaks IDE protocol major ${h.major}, this pcbjs needs ${IDE_MAJOR}: run \`pcbjs ide install\` in this project for the matching extension`
}

/** Keeps dialling with a backoff until close(). */
export function connectHost(opts: HostClientOptions): HostClient {
  const minDelay = opts.minDelay ?? 500,
    maxDelay = opts.maxDelay ?? 10_000
  const sticky = new Map<string, string>()
  let ws: WebSocket | null = null
  let open = false
  let closed = false
  let delay = minDelay
  let timer: NodeJS.Timeout | null = null
  let hello: HostHello | null = null
  let failing = false

  const frame = (event: string, data: unknown) => JSON.stringify({ event, data })

  const onMessage = (raw: WebSocket.RawData) => {
    let msg: any
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (msg?.jsonrpc === '2.0') {
      opts.onRpc?.(msg)
      return
    }
    const d = msg?.data
    switch (msg?.event) {
      case 'pcbjs:ide:hello':
        hello = parseHello(d)
        opts.onHello?.(hello)
        break
      case 'pcbjs:ide:cursor':
        if (typeof d?.file === 'string' && d.file) opts.onCursor?.({ file: d.file, line: Number(d.line), col: Number(d.col) })
        break
      case 'pcbjs:ide:focus':
        if (typeof d?.file === 'string' && d.file) opts.onFocus?.({ file: d.file })
        break
      case 'pcbjs:ide:close':
        if (typeof d?.file === 'string' && d.file) opts.onClose?.({ file: d.file })
        break
      case 'pcbjs:ide:bye':
        hello = null
        opts.onBye?.()
        break
    }
  }

  const schedule = () => {
    if (closed || timer) return
    timer = setTimeout(() => {
      timer = null
      dial()
    }, delay)
    timer.unref?.()
    delay = Math.min(delay * 2, maxDelay)
  }

  function dial() {
    if (closed) return
    const sock = new WebSocket(opts.url, { handshakeTimeout: 5000 })
    ws = sock
    sock.on('open', () => {
      if (ws !== sock) return
      open = true
      failing = false
      delay = minDelay
      opts.onStatus?.('connected')
      for (const e of STICKY) {
        const f = sticky.get(e)
        if (f) sock.send(f)
      }
    })
    sock.on('message', onMessage)
    sock.on('error', (e: Error) => {
      if (ws !== sock || open || failing) return
      failing = true
      opts.onStatus?.('unreachable', e.message)
    })
    sock.on('close', () => {
      if (ws !== sock) return
      const was = open
      open = false
      ws = null
      hello = null
      if (was) opts.onStatus?.('disconnected')
      schedule()
    })
  }

  dial()

  return {
    send(event, data) {
      const f = frame(event, data)
      if ((STICKY as readonly string[]).includes(event)) sticky.set(event, f)
      if (!open || !ws) return false
      ws.send(f)
      return true
    },
    sendRpc(msg) {
      if (!open || !ws) return false
      ws.send(JSON.stringify(msg))
      return true
    },
    connected: () => open,
    hello: () => hello,
    close() {
      closed = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      const s = ws
      ws = null
      open = false
      if (s) {
        s.close()
        if (s.readyState !== WebSocket.CLOSED) setTimeout(() => s.terminate(), 1000).unref?.()
      }
    },
  }
}
