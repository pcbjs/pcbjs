// The session's frames: the hosted kinds, an event `{ event, data }` or JSON-RPC 2.0, one JSON object per line on the socket and the pipe.
import type { Hello, Role } from '@pcbjs/core/protocol'
import type { DevInfo } from '../server/listen.js'

/** As IdeHost allows. */
export const MAX_FRAME = 16 * 1024 * 1024

export const ROLES: readonly Role[] = ['editor', 'agent', 'viewer', 'cli']
export type EditMode = 'localhost' | 'all' | 'none'
export const EDIT_MODES: readonly EditMode[] = ['localhost', 'all', 'none']

/** `.pcbjs/dev.json` of a project a session serves. */
export interface SessionInfo extends DevInfo {
  /** 8 base32 characters per start */
  session: string
  /** the path of the UNIX socket or the name of the pipe */
  socket: string
  edit: EditMode
  /** the checkout of its first folder: a one-shot in another worktree of the repository starts its own */
  checkout?: string
  /** only under edit `all` with a non-loopback host */
  token?: string
}

export const RPC_ERRORS = { readOnly: -32001, notFound: -32601, invalid: -32602, failed: -32603 } as const

export const isRpc = (m: any): boolean => !!m && typeof m === 'object' && m.jsonrpc === '2.0'
export const isRequest = (m: any): m is { jsonrpc: '2.0'; id: number | string; method: string; params?: any } =>
  isRpc(m) && typeof m.method === 'string' && m.id !== undefined && m.id !== null

/** Null unless every field of the hosted hello is there; role, project and token checked when given. */
export function parseSessionHello(d: any): Hello | null {
  if (!d || typeof d !== 'object' || !Number.isInteger(d.protocol) || !Number.isInteger(d.major) || !Array.isArray(d.capabilities)) return null
  return {
    name: typeof d.name === 'string' && d.name ? d.name : 'client',
    version: typeof d.version === 'string' ? d.version : '',
    protocol: d.protocol,
    major: d.major,
    capabilities: d.capabilities.filter((c: unknown) => typeof c === 'string'),
    ...(ROLES.includes(d.role) ? { role: d.role as Role } : {}),
    ...(typeof d.project === 'string' && d.project ? { project: d.project } : {}),
    ...(typeof d.token === 'string' && d.token ? { token: d.token } : {}),
  }
}

/** Splits a byte stream into JSON frames, one per line; a line past MAX_FRAME calls `tooLong`. */
export function lineReader(onFrame: (msg: unknown) => void, tooLong: () => void): (chunk: Buffer | string) => void {
  let rest = ''
  return chunk => {
    rest += chunk.toString()
    let nl: number
    while ((nl = rest.indexOf('\n')) >= 0) {
      const line = rest.slice(0, nl).trim()
      rest = rest.slice(nl + 1)
      if (!line) continue
      let msg: unknown
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      onFrame(msg)
    }
    if (rest.length > MAX_FRAME) {
      rest = ''
      tooLong()
    }
  }
}

export const frameLine = (msg: unknown): string => JSON.stringify(msg) + '\n'

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

/** 8 base32 characters from 40 random bits. */
export function sessionId(bytes: Uint8Array): string {
  let bits = 0n
  for (const b of bytes.slice(0, 5)) bits = (bits << 8n) | BigInt(b)
  let out = ''
  for (let i = 7; i >= 0; i--) out += BASE32[Number((bits >> BigInt(i * 5)) & 31n)]
  return out
}
