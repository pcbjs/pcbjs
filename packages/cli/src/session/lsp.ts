// @pcbjs/lsp loads on the first LSP initialize, so a run no editor asks never loads it; docs/ide-bridge.md has the protocol.
import { readFileSync } from 'node:fs'
import { resolveFile, scopeInject } from '@pcbjs/compile/internal/scope'
import type { DocRole, DocumentStore, EditorEvents, Host, Inject, LanguageServer, MessageChannel, Projects, SelectRange } from '@pcbjs/lsp'
import { METHODS, type PreviewParams } from '@pcbjs/core/protocol'

type LspModule = typeof import('@pcbjs/lsp')
type RpcMessage = Parameters<MessageChannel['push']>[0]

interface Session {
  pending: RpcMessage[]
  channel: MessageChannel | null
  server: LanguageServer | null
  closed: boolean
  /** the flushes waiting for their answer, by request id */
  flushes: Map<string, () => void>
}

export interface LspHub {
  /** one JSON-RPC message from the channel `key`; `send` writes one back on that channel */
  message(key: unknown, msg: unknown, send: (msg: unknown) => boolean | void): void
  /** the channel closed or reconnected: its session ends */
  drop(key: unknown): void
  /** send `pcbjs/select` with these ranges on that channel, the first the primary, `focus` for an Open; false when it has no session that takes it */
  select(key: unknown, ranges: SelectRange[], reveal: boolean, focus?: boolean): boolean
  /** the channels whose session takes `pcbjs/select` */
  keys(): unknown[]
  /** resolves once the channel's server handled every message it got before, as a query must see what it synced first */
  flush(key: unknown): Promise<void>
  /** the same for every channel, so a query sees what any connection synced before it */
  flushAll(): Promise<void>
  /** the channel whose language server holds documents as `id` */
  keyOf(holder: string): unknown
  /** every running language server with its channel */
  servers(): { key: unknown; server: LanguageServer }[]
  /** the offset of the first type error of `file` within `[start, end]` from a language server that reads `text`, null when none or none reads it */
  typeError(file: string, text: string, start: number, end: number): number | null
  /** the open documents of every channel, null until the first initialize loads the language server */
  store(): DocumentStore | null
  /** where the code connects a pad, from the first session that knows */
  padSource(board: string, ref: string, num: string): SelectRange | undefined
  /** send `pcbjs/preview` on every channel */
  preview(p: PreviewParams | null): void
  /** the boards of a project root changed, of every one without: findings, lenses and hints again */
  refresh(root?: string): void
  dispose(): void
}

export interface HubOptions {
  /** each channel's own editor events, so focus and cursor name the connection */
  eventsOf?: (key: unknown) => EditorEvents
  /** how a channel's documents reach the store, and the name it holds them by */
  roleOf?: (key: unknown) => { role: DocRole; name?: string }
  /** the store every channel syncs into, made from the language server's own */
  wrap?: (store: DocumentStore) => DocumentStore
  /** the store exists: once, when the language server loads */
  onStore?: (store: DocumentStore) => void
  /** every LSP notification a channel sends, before its server handles it */
  onNotify?: (key: unknown, msg: { method: string; params?: any }) => void
  log?: (message: string) => void
}

/** ms a query waits for a language server to catch up */
const FLUSH_MS = 2000
let flushes = 0

let loading: Promise<LspModule> | null = null
/** The one dynamic import of @pcbjs/lsp. */
export const loadLsp = (): Promise<LspModule> => (loading ??= import('@pcbjs/lsp'))

const isInitialize = (msg: unknown): msg is RpcMessage & { id: number | string } =>
  !!msg && typeof msg === 'object' && (msg as any).jsonrpc === '2.0' && (msg as any).method === 'initialize'
const isRequest = (msg: unknown): msg is { id: number | string; method: string } =>
  !!msg && typeof msg === 'object' && (msg as any).jsonrpc === '2.0' && typeof (msg as any).method === 'string' && (msg as any).id !== undefined

const isNotification = (msg: unknown): msg is { method: string; params?: any } =>
  !!msg && typeof msg === 'object' && (msg as any).jsonrpc === '2.0' && typeof (msg as any).method === 'string' && (msg as any).id === undefined

/** The bare names of a schematic namespace as the compiler injects them, the modules read as the editor has them. */
const inject: Inject = (file, text, read) => {
  const r = scopeInject(
    text,
    (spec, from) => {
      const m = resolveFile(spec, from)
      return m && { file: m.file, source: read(m.file) ?? m.source }
    },
    file,
  )
  return r
}

/** One store for every channel: the editor's open text is the session's. */
export function lspHub(host: Host, o: HubOptions = {}): LspHub {
  const own = (key: unknown): Host => ({ inject, ...host, events: o.eventsOf?.(key) ?? host.events })
  const sessions = new Map<unknown, Session>()
  let store: DocumentStore | null = null
  // one program for every connection whose text is the store's
  let code: Projects | null = null

  const start = (key: unknown, s: Session, send: (msg: unknown) => boolean | void) => {
    loadLsp().then(
      mod => {
        if (!store) {
          store = o.wrap ? o.wrap(mod.documentStore()) : mod.documentStore()
          code = mod.sessionProjects(store, inject)
          o.onStore?.(store)
        }
        if (s.closed) return
        const who = o.roleOf?.(key) ?? { role: 'editor' }
        // the answer to a flush stays here
        s.channel = mod.messageChannel(m => {
          const done = s.flushes.get(String((m as { id?: unknown }).id))
          return done ? done() : send(m)
        })
        s.server = mod.startLanguageServer(s.channel, own(key), store, code!, who.role, who.name)
        for (const m of s.pending.splice(0)) s.channel.push(m)
      },
      (e: any) => {
        // the language server is not installed: answer the requests that wait, and forget the session
        o.log?.(`the language server could not load: ${String(e?.message ?? e).split('\n')[0]}; install @pcbjs/lsp, which @pcbjs/pcbjs brings`)
        for (const m of s.pending) if (isRequest(m)) send({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: '@pcbjs/lsp is not installed' } })
        if (sessions.get(key) === s) sessions.delete(key)
      },
    )
  }

  return {
    message(key, msg, send) {
      let s = sessions.get(key)
      if (isNotification(msg)) o.onNotify?.(key, msg)
      if (isInitialize(msg)) {
        // a second initialize on the same channel is a new client: the old session ends
        if (s) this.drop(key)
        s = { pending: [msg], channel: null, server: null, closed: false, flushes: new Map() }
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
      for (const done of s.flushes.values()) done()
      s.server?.dispose()
      s.channel?.close()
    },
    select(key, ranges, reveal, focus) {
      return sessions.get(key)?.server?.select(ranges, reveal, focus) ?? false
    },
    padSource(board, ref, num) {
      for (const s of sessions.values()) {
        const r = s.server?.padSource(board, ref, num)
        if (r) return r
      }
      return undefined
    },
    typeError(file, text, start, end) {
      if (code && store?.get(file)?.text === text) {
        try {
          return code.typeError(file, start, end)
        } catch {}
      }
      for (const s of sessions.values()) {
        const r = s.server?.typeError(file, text, start, end)
        if (r !== undefined) return r
      }
      return null
    },
    keys() {
      return [...sessions].filter(([, s]) => s.server?.initialized && s.server.pcbjsClient).map(([k]) => k)
    },
    flush(key) {
      const s = sessions.get(key)
      if (!s || s.closed) return Promise.resolve()
      const id = `pcbjs-flush-${++flushes}`
      return new Promise<void>(done => {
        // a server that never answers holds no query up for long
        const t = setTimeout(() => s.flushes.get(id)?.(), FLUSH_MS)
        s.flushes.set(id, () => {
          clearTimeout(t)
          s.flushes.delete(id)
          done()
        })
        const msg = { jsonrpc: '2.0', id, method: METHODS.flush } as RpcMessage
        if (s.channel) s.channel.push(msg)
        else s.pending.push(msg)
      })
    },
    flushAll() {
      return Promise.all([...sessions.keys()].map(k => this.flush(k))).then(() => {})
    },
    keyOf(holder) {
      for (const [k, s] of sessions) if (s.server?.holder.id === holder) return k
      return undefined
    },
    servers() {
      return [...sessions].filter(([, s]) => s.server).map(([key, s]) => ({ key, server: s.server! }))
    },
    store: () => store,
    preview(p) {
      if (p) for (const s of sessions.values()) s.server?.preview(p)
    },
    refresh(root) {
      for (const s of sessions.values()) s.server?.refresh(root)
    },
    dispose() {
      for (const k of [...sessions.keys()]) this.drop(k)
      code?.dispose()
      code = null
    },
  }
}

/** The pcbjs version the language server reports in its handshake. */
export const LSP_VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version
  } catch {
    return '0.0.0'
  }
})()
