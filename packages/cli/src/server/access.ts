import type { IncomingMessage } from 'node:http'
import { runtimeDir } from '../project/session-paths.js'

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/
export const isLoopback = (addr: string | undefined): boolean => !!addr && LOOPBACK.test(addr)

/** Forwarded requests never inherit a proxy's loopback privilege. */
export function localRequest(req: IncomingMessage): boolean {
  if (!isLoopback(req.socket.remoteAddress)) return false
  if (Object.keys(req.headers).some(h => h === 'forwarded' || h.startsWith('x-forwarded-') || h === 'cf-connecting-ip' || h === 'x-real-ip')) return false
  try {
    const host = new URL(`http://${req.headers.host}`).hostname.replace(/^\[|\]$/g, '')
    return host === 'localhost' || isLoopback(host)
  } catch {
    return false
  }
}

/** A browser page may only connect from the server's own origin, so a site the user visits cannot drive the session. */
export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

export const sessionFileDeny = (deny: string[] = []): string[] => [
  '.env',
  '.env.*',
  '*.{crt,pem}',
  '**/.git/**',
  ...deny,
  '**/.pcbjs/dev.json',
  `${runtimeDir().replace(/\\/g, '/')}/**`,
]
