// The session's frames over TCP: a WebSocket at /__pcbjs/session on the dev server, one frame per message.
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import type { Clients } from './clients.js'
import { MAX_FRAME } from './frames.js'

export const SESSION_PATH = '/__pcbjs/session'

export { isLoopback, sameOrigin } from '../server/access.js'
import { localRequest, sameOrigin } from '../server/access.js'

export function sessionEndpoint(clients: Clients): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME })
  return (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname !== SESSION_PATH) return
    if (!sameOrigin(req)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    wss.handleUpgrade(req, socket, head, ws => {
      const c = clients.add({
        kind: 'tcp',
        loopback: localRequest(req),
        token: url.searchParams.get('token') ?? undefined,
        send: (head, tail) => {
          if (ws.readyState !== ws.OPEN) return false
          // the shared tail goes as the message's second fragment, so no connection copies it
          if (tail) {
            ws.send(head, { fin: false })
            ws.send(tail, { binary: false, fin: true })
          } else ws.send(head)
          return true
        },
        close: () => ws.close(),
      })
      ws.on('message', raw => {
        let msg: unknown
        try {
          msg = JSON.parse(raw.toString())
        } catch {
          return
        }
        c.receive(msg)
      })
      ws.on('close', () => c.closed())
      ws.on('error', () => c.closed())
    })
  }
}

const proxied = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME })
/** A page of another dev server on the session socket of the server at `url`, each message passed through whole, either side closing both. */
export function proxySession(req: IncomingMessage, socket: Duplex, head: Buffer, url: string): void {
  proxied.handleUpgrade(req, socket, head, page => {
    const target = new URL(SESSION_PATH, url.replace(/^http/, 'ws'))
    const token = new URL(req.url ?? '/', 'http://local').searchParams.get('token')
    if (token) target.searchParams.set('token', token)
    const up = new WebSocket(target, localRequest(req) ? {} : { headers: { 'x-forwarded-for': req.socket.remoteAddress ?? 'unknown' } })
    const waiting: Buffer[] = []
    page.on('message', raw => (up.readyState === up.OPEN ? up.send(raw, { binary: false }) : waiting.push(raw as Buffer)))
    up.on('open', () => waiting.splice(0).forEach(m => up.send(m, { binary: false })))
    up.on('message', raw => page.readyState === page.OPEN && page.send(raw, { binary: false }))
    const close = () => {
      page.close()
      up.close()
    }
    page.on('close', close)
    up.on('close', close)
    up.on('error', close)
  })
}
