// Editor bridges over Vite's HMR socket and the /__pcbjs HTTP endpoints. docs/ide-bridge.md has the protocol.
import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import launch from 'launch-editor'
import type { Connect, ViteDevServer, WebSocketClient } from 'vite'
import { helloWarning, parseHello, type HostClient, type HostHello } from './host-client.js'

export interface CursorEvent {
  file: string
  line: number
  col: number
  target?: CursorTarget
}
/** What the code under the cursor names, per board, from the language server; absent without one. */
export interface CursorTarget {
  kind: string
  boards: { board: string; ids: number[]; refs: string[]; points?: [number, number][]; reference?: string; name: string }[]
}
export interface SelectEvent {
  file: string
  line: number
  col: number
  endLine: number
  endCol: number
}

/** A path as given by an editor or the viewer, absolute or relative to the root, both ways. */
export function normalizeFile(root: string, file: string): { abs: string; rel: string } {
  const abs = isAbsolute(file) ? resolve(file) : resolve(root, file)
  return { abs, rel: relative(root, abs).split(sep).join('/') }
}

const int = (v: unknown, d: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : d
}

function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        fail(new Error('body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')))
    req.on('error', fail)
  })
}

export interface IdeBridge {
  connected(): number
  middleware: Connect.NextHandleFunction
  cursor(file: string, line: unknown, col: unknown, target?: CursorTarget): void
  lastCursor(): CursorEvent | null
}

export interface BridgeOptions {
  /** gets selections ahead of the bridges while connected */
  host?: () => HostClient | null
  /** an absolute or root-relative file */
  onFocus?: (file: string) => void
  onClose?: (file: string) => void
  /** keyed 'host' or by Vite socket; a session that takes `pcbjs/select` gets it instead of `pcbjs:ide:select` */
  lsp?: { select(key: unknown, sel: SelectEvent): boolean; keys(): unknown[]; padSource?(board: string, ref: string, num: string): SelectEvent | undefined }
}

/** Register the bridge events on the server's WebSocket and return the /__pcbjs/{cursor,open,ide} middleware. */
export function ideBridge(server: ViteDevServer, rootOf: string | (() => string), opts: BridgeOptions = {}): IdeBridge {
  // a workspace dev server passes the root of the displayed scope, which changes with it
  const fixedRoot = typeof rootOf === 'string' ? rootOf : null
  const root = () => fixedRoot ?? (rootOf as () => string)()
  const bridges = new Map<WebSocketClient['socket'], { client: WebSocketClient } & HostHello>()

  let last: CursorEvent | null = null
  const broadcastCursor = (file: string, line: unknown, col: unknown, target?: CursorTarget) => {
    const data: CursorEvent = { file: normalizeFile(root(), file).rel, line: int(line, 1), col: int(col, 1), ...(target ? { target } : {}) }
    last = data
    server.ws.send({ type: 'custom', event: 'pcbjs:cursor', data })
  }

  server.ws.on('pcbjs:ide:hello', (data: any, client: WebSocketClient) => {
    const known = bridges.has(client.socket)
    const hello = parseHello(data)
    bridges.set(client.socket, { client, ...hello })
    // a repeated hello is the bridge's heartbeat
    if (!known) {
      client.socket.once('close', () => bridges.delete(client.socket))
      server.config.logger.info(`[pcbjs] ide bridge connected: ${hello.name} ${hello.version}`.trimEnd(), { timestamp: true })
      const w = helloWarning(hello)
      if (w) server.config.logger.warn(w, { timestamp: true })
    }
  })
  server.ws.on('pcbjs:ide:bye', (_data: unknown, client: WebSocketClient) => {
    bridges.delete(client.socket)
  })
  server.ws.on('pcbjs:ide:cursor', (data: any) => {
    if (data && typeof data.file === 'string') broadcastCursor(data.file, data.line, data.col)
  })
  server.ws.on('pcbjs:ide:focus', (data: any) => {
    if (data && typeof data.file === 'string' && data.file) opts.onFocus?.(data.file)
  })
  server.ws.on('pcbjs:ide:close', (data: any) => {
    if (data && typeof data.file === 'string' && data.file) opts.onClose?.(data.file)
  })

  // a file the editor may open: inside a directory Vite is allowed to serve, which holds the project root
  const allowed = (abs: string) => [root(), ...server.config.server.fs.allow].some(d => abs === d || abs.startsWith(d.endsWith(sep) ? d : d + sep))

  const middleware: Connect.NextHandleFunction = (req, res: ServerResponse, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const p = url.pathname
    if (p === '/__pcbjs/ide') {
      res.setHeader('content-type', 'application/json')
      const host = opts.host?.()
      res.end(
        JSON.stringify({
          connected: bridges.size,
          clients: [...bridges.values()].map(b => ({ name: b.name, version: b.version, protocol: b.protocol, major: b.major })),
          host: host ? { connected: host.connected(), ...(host.hello() ?? {}) } : null,
        }),
      )
      return
    }
    if (p === '/__pcbjs/cursor') {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'POST')
        res.end()
        return
      }
      readBody(req)
        .then(text => {
          const body = JSON.parse(text || '{}')
          if (typeof body.file !== 'string' || !body.file) {
            res.statusCode = 400
            res.end('file required')
            return
          }
          broadcastCursor(body.file, body.line, body.col)
          res.statusCode = 204
          res.end()
        })
        .catch(e => {
          res.statusCode = 400
          res.end(String(e?.message ?? e))
        })
      return
    }
    if (p === '/__pcbjs/open') {
      const q = url.searchParams
      const f = q.get('file')
      if (!f) {
        res.statusCode = 400
        res.end('file required')
        return
      }
      const { abs } = normalizeFile(root(), f)
      if (!allowed(abs) || !existsSync(abs)) {
        res.statusCode = 404
        res.end('not found')
        return
      }
      const line = int(q.get('line'), 1),
        col = int(q.get('col'), 1)
      // a pad goes to its key in the part's connect call when the language server finds one
      const pad = /^(.+)\.([^.]+)$/.exec(q.get('pad') ?? '')
      const sel: SelectEvent = (pad && opts.lsp?.padSource?.(q.get('board') ?? '', pad[1], pad[2])) || {
        file: abs,
        line,
        col,
        endLine: int(q.get('endLine'), line),
        endCol: int(q.get('endCol'), col),
      }
      // the editor host first, then clients on the Vite socket, then launch-editor
      const host = opts.host?.()
      const lspKeys = (opts.lsp?.keys() ?? []).filter(k => k !== 'host' && !bridges.has(k as WebSocketClient['socket']))
      if (host?.connected() && (opts.lsp?.select('host', sel) || host.send('pcbjs:ide:select', sel))) {
        res.setHeader('x-pcbjs-opened', 'host')
      } else if (bridges.size || lspKeys.length) {
        for (const b of bridges.values()) if (!opts.lsp?.select(b.client.socket, sel)) b.client.send({ type: 'custom', event: 'pcbjs:ide:select', data: sel })
        for (const k of lspKeys) opts.lsp!.select(k, sel)
        res.setHeader('x-pcbjs-opened', 'ide')
      } else {
        // as Vite's /__open-in-editor
        launch(`${abs}:${line}:${col}`, (file: string, err: string | null) => {
          server.config.logger.warn(`[pcbjs] could not open ${file} in an editor${err ? ': ' + err : ''}`, { timestamp: true })
        })
        res.setHeader('x-pcbjs-opened', 'editor')
      }
      res.statusCode = 204
      res.end()
      return
    }
    next()
  }

  return { connected: () => bridges.size, middleware, cursor: broadcastCursor, lastCursor: () => last }
}
