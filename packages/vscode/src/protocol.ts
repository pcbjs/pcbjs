// The session protocol as the extension speaks it, without vscode. docs/ide-bridge.md describes it; anything not named here is ignored.

import * as path from 'node:path'
import { MAJOR, PROTOCOL, compat, type Events, type Hello, type IdeBoardsMsg, type Ready, type Sends, type ViewName } from '@pcbjs/core/protocol'

/** What this extension handles: the events it takes and `lsp` for a language client. */
export const CAPABILITIES = ['ready', 'boards', 'scopes', 'scope', 'log', 'lsp', 'finding'] as const

export interface Envelope {
  event: string
  data: any
}

export const hello = (name: string, version: string): Hello => ({ name, version, protocol: PROTOCOL, major: MAJOR, capabilities: [...CAPABILITIES] })

/** 1-based, `endCol` inclusive. */
export interface SelectRequest {
  file: string
  line: number
  col: number
  endLine: number
  endCol: number
}

export const EVENTS = {
  ready: 'pcbjs:ide:ready',
  boards: 'pcbjs:ide:boards',
  scopes: 'pcbjs:ide:scopes',
  scope: 'pcbjs:ide:scope',
  log: 'pcbjs:ide:log',
  hello: 'pcbjs:ide:hello',
  bye: 'pcbjs:ide:bye',
} as const satisfies Record<string, keyof Events | keyof Sends>

/** Whether the server offers a capability. */
export const offers = (info: Pick<Ready, 'capabilities'>, cap: string): boolean => info.capabilities.includes(cap)

/** The notice for a session this extension cannot use: one of a newer major needs a newer extension, an older one misses methods and frames the extension sends, so it is restarted rather than half used. */
export function mismatch(info: Pick<Ready, 'protocol' | 'major' | 'version' | 'root'>): string | undefined {
  const c = compat(info)
  if (c === 'same' || c === 'newer') return undefined
  if (c === 'incompatible' && info.major > MAJOR)
    return `pcbjs ${info.version} in ${info.root} speaks IDE protocol ${info.major}, this extension ${MAJOR}. Run \`pcbjs ide install\` in the project to install the extension that matches it.`
  return `session ${info.version} in ${info.root} is older than the extension, restart it: pcbjs session stop, then pcbjs dev.`
}

export function encode(event: string, data?: unknown): string {
  return JSON.stringify(data === undefined ? { event } : { event, data })
}

const frameText = (raw: unknown): string =>
  typeof raw === 'string'
    ? raw
    : Buffer.isBuffer(raw)
      ? raw.toString('utf8')
      : Array.isArray(raw)
        ? Buffer.concat(raw).toString('utf8')
        : raw instanceof ArrayBuffer
          ? Buffer.from(raw).toString('utf8')
          : String(raw)

/** A JSON-RPC message of the language server, undefined for anything else. */
export function parseRpc(raw: unknown): object | undefined {
  let text: string
  try {
    text = frameText(raw)
  } catch {
    return undefined
  }
  if (!text.includes('"jsonrpc"')) return undefined
  try {
    const msg = JSON.parse(text)
    return msg && typeof msg === 'object' && !Array.isArray(msg) && msg.jsonrpc === '2.0' ? msg : undefined
  } catch {
    return undefined
  }
}

export function parseEnvelope(raw: unknown): Envelope | undefined {
  let msg: any
  try {
    msg = JSON.parse(frameText(raw))
  } catch {
    return undefined
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.event !== 'string' || !msg.event) return undefined
  return { event: msg.event, data: msg.data }
}

export function validSelect(d: any): d is SelectRequest {
  return !!d && typeof d.file === 'string' && [d.line, d.col, d.endLine, d.endCol].every(n => Number.isInteger(n) && n >= 1)
}

export function validReady(d: any): d is Ready {
  return !!d && typeof d.root === 'string' && Number.isInteger(d.port) && d.port > 0 && Number.isInteger(d.protocol) && Number.isInteger(d.major) && Array.isArray(d.capabilities)
}

export function validBoards(d: any): d is IdeBoardsMsg {
  return !!d && Array.isArray(d.boards)
}

/** True when `file` lies strictly inside `root`. */
export function isUnder(root: string, file: string): boolean {
  const rel = path.relative(root, file)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export function samePath(a: string, b: string): boolean {
  const ra = path.resolve(a)
  const rb = path.resolve(b)
  return process.platform === 'win32' || process.platform === 'darwin' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb
}

/** The first loopback URL, else the first URL, else host and port. */
export function devUrl(info: Ready): string {
  const urls = Array.isArray(info.urls) ? info.urls.filter(u => typeof u === 'string') : []
  const loop = urls.find(u => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(u))
  if (loop ?? urls[0]) return (loop ?? urls[0]) as string
  let host = info.host || '127.0.0.1'
  if (host === '0.0.0.0' || host === '::') host = '127.0.0.1'
  if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`
  return `http://${host}:${info.port}/`
}

/** The path, query and hash of a page, which a pane keeps and resolves against the session it shows when it paints. */
export function pathOf(page: string): string {
  const u = new URL(page, 'http://localhost/')
  return u.pathname + u.search + u.hash
}

export type ThemeName = 'dark' | 'light' | 'hc'

/** vscode.ColorThemeKind: 1 Light, 2 Dark, 3 HighContrast, 4 HighContrastLight. */
export function themeName(kind: number): ThemeName {
  return kind === 1 ? 'light' : kind === 3 || kind === 4 ? 'hc' : 'dark'
}

/** With a view: that view, and `panel=0` since the sidebar shows findings, nets and BOM. */
export function viewerUrl(url: string, theme: ThemeName, view?: ViewName): string {
  const u = new URL(url)
  u.searchParams.set('ide', '1')
  u.searchParams.set('theme', theme)
  if (view) {
    u.searchParams.set('view', view)
    u.searchParams.set('panel', '0')
  }
  return u.toString()
}
