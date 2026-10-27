// @pcbjs/lsp loads on the first LSP initialize, so a run no editor asks never loads it; docs/ide-bridge.md has the protocol.
import { readFileSync } from 'node:fs'
import { resolveFile, scopeInject } from '@pcbjs/compile/scope'
import type { Inject, LanguageServer, MessageChannel, PreviewParams, Provider, SelectRange } from '@pcbjs/lsp'

type LspModule = typeof import('@pcbjs/lsp')
type RpcMessage = Parameters<MessageChannel['push']>[0]

interface Session {
  pending: RpcMessage[]
  channel: MessageChannel | null
  server: LanguageServer | null
  closed: boolean
}

export interface LspHub {
  /** one JSON-RPC message from the channel `key`; `send` writes one back on that channel */
  message(key: unknown, msg: unknown, send: (msg: unknown) => boolean | void): void
  /** the channel closed or reconnected: its session ends */
  drop(key: unknown): void
  /** send `pcbjs/select` on that channel; false when it has no session that takes it */
  select(key: unknown, sel: SelectRange): boolean
  /** the channels whose session takes `pcbjs/select` */
  keys(): unknown[]
  /** where the code connects a pad, from the first session that knows */
  padSource(board: string, ref: string, num: string): SelectRange | undefined
  /** send `pcbjs/preview` on every channel */
  preview(p: PreviewParams | null): void
  /** the boards changed: findings, lenses and hints again */
  refresh(): void
  dispose(): void
}

let loading: Promise<LspModule> | null = null
/** The one dynamic import of @pcbjs/lsp. */
export const loadLsp = (): Promise<LspModule> => (loading ??= import('@pcbjs/lsp'))

const isInitialize = (msg: unknown): msg is RpcMessage & { id: number | string } =>
  !!msg && typeof msg === 'object' && (msg as any).jsonrpc === '2.0' && (msg as any).method === 'initialize'
const isRequest = (msg: unknown): msg is { id: number | string; method: string } =>
  !!msg && typeof msg === 'object' && (msg as any).jsonrpc === '2.0' && typeof (msg as any).method === 'string' && (msg as any).id !== undefined

/** The bare names of a schematic namespace as the compiler injects them, the modules read as the editor has them. */
const inject: Inject = (file, text, read) => {
  const r = scopeInject(text, (spec, from) => { const m = resolveFile(spec, from); return m && { file: m.file, source: read(m.file) ?? m.source } }, file)
  return r && { text: r.code, at: r.at, length: r.text.length }
}

export function lspHub(provider: Provider): LspHub {
  provider = { inject, ...provider }
  const sessions = new Map<unknown, Session>()

  const start = (key: unknown, s: Session, send: (msg: unknown) => boolean | void) => {
    loadLsp().then(mod => {
      if (s.closed) return
      s.channel = mod.messageChannel(m => send(m))
      s.server = mod.startLanguageServer(s.channel, provider)
      for (const m of s.pending.splice(0)) s.channel.push(m)
    }, (e: any) => {
      // the language server is not installed: answer the requests that wait, and forget the session
      provider.log?.(`the language server could not load: ${String(e?.message ?? e).split('\n')[0]}; install @pcbjs/lsp, which @pcbjs/pcbjs brings`)
      for (const m of s.pending) if (isRequest(m)) send({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: '@pcbjs/lsp is not installed' } })
      if (sessions.get(key) === s) sessions.delete(key)
    })
  }

  return {
    message(key, msg, send) {
      let s = sessions.get(key)
      if (isInitialize(msg)) {
        // a second initialize on the same channel is a new client: the old session ends
        if (s) this.drop(key)
        s = { pending: [msg], channel: null, server: null, closed: false }
        sessions.set(key, s)
        start(key, s, send)
        return
      }
      if (!s) {
        // nothing before initialize, as the protocol says
        if (isRequest(msg)) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32002, message: 'the server is not initialized' } })
        return
      }
      if (s.channel) s.channel.push(msg as RpcMessage)
      else s.pending.push(msg as RpcMessage)
    },
    drop(key) {
      const s = sessions.get(key)
      if (!s) return
      sessions.delete(key)
      s.closed = true
      s.server?.dispose()
      s.channel?.close()
    },
    select(key, sel) {
      return sessions.get(key)?.server?.select(sel) ?? false
    },
    padSource(board, ref, num) {
      for (const s of sessions.values()) { const r = s.server?.padSource(board, ref, num); if (r) return r }
      return undefined
    },
    keys() {
      return [...sessions].filter(([, s]) => s.server?.initialized && s.server.pcbjsClient).map(([k]) => k)
    },
    preview(p) {
      if (p) for (const s of sessions.values()) s.server?.preview(p)
    },
    refresh() {
      for (const s of sessions.values()) s.server?.refresh()
    },
    dispose() {
      for (const k of [...sessions.keys()]) this.drop(k)
    },
  }
}

/** The pcbjs version the language server reports in its handshake. */
export const LSP_VERSION: string = (() => {
  try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version } catch { return '0.0.0' }
})()
