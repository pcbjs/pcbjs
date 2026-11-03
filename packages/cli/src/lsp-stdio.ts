// `pcbjs lsp --stdio`: the language server for any editor, LSP's Content-Length framing on stdio relayed to one connection of the session,
// which runs the server; a session that goes away is replaced and the open documents sent again. docs/lsp.md has the editor setups.
import { fileURLToPath } from 'node:url'
import type { SessionConn } from './session/client.js'
import { attachSession } from './session/starter.js'
import type { Role } from '@pcbjs/core/protocol'
import { real } from './session/paths.js'

type Msg = Record<string, any>

/** The id of the initialize sent again after a reconnect, whose answer the editor already had. */
const REPLAY = 'pcbjs-replay'

/** Splits LSP's base protocol, headers then a body of Content-Length bytes, into messages. */
export function lspReader(onMessage: (m: Msg) => void): (chunk: Buffer) => void {
  let buf = Buffer.alloc(0)
  return chunk => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      const end = buf.indexOf('\r\n\r\n')
      if (end < 0) return
      const len = Number(/content-length:\s*(\d+)/i.exec(buf.subarray(0, end).toString('ascii'))?.[1])
      if (!Number.isFinite(len)) {
        buf = buf.subarray(end + 4)
        continue
      }
      if (buf.length < end + 4 + len) return
      const body = buf.subarray(end + 4, end + 4 + len).toString('utf8')
      buf = buf.subarray(end + 4 + len)
      try {
        onMessage(JSON.parse(body))
      } catch {}
    }
  }
}

export const lspFrame = (m: unknown): Buffer => {
  const body = Buffer.from(JSON.stringify(m), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])
}

const rootOf = (p: any): string => {
  const uri = p?.workspaceFolders?.[0]?.uri ?? p?.rootUri
  try {
    if (typeof uri === 'string' && uri.startsWith('file:')) return real(fileURLToPath(uri))
  } catch {}
  return real(typeof p?.rootPath === 'string' && p.rootPath ? p.rootPath : process.cwd())
}

export async function lspStdio(o: { role?: Role } = {}): Promise<number> {
  const role = o.role ?? 'editor'
  const log = (l: string) => process.stderr.write(`[pcbjs lsp] ${l}\n`)
  const write = (m: unknown) => process.stdout.write(lspFrame(m))
  let init: Msg | null = null
  let conn: SessionConn | null = null
  let waiting: Msg[] = []
  let ended = false
  // the open documents, full sync, for a replacement session
  const docs = new Map<string, { languageId: string; version: number; text: string }>()

  const track = (m: Msg) => {
    const td = m.params?.textDocument
    if (m.method === 'textDocument/didOpen') docs.set(td.uri, { languageId: td.languageId, version: td.version, text: td.text })
    else if (m.method === 'textDocument/didChange') {
      const d = docs.get(td.uri)
      const last = m.params.contentChanges?.at(-1)
      if (d && last && !last.range) Object.assign(d, { version: td.version, text: last.text })
    } else if (m.method === 'textDocument/didClose') docs.delete(td.uri)
  }

  const attach = async (replay: boolean) => {
    const c = await attachSession(rootOf(init!.params), { name: init!.params?.clientInfo?.name ?? 'pcbjs lsp', role, capabilities: ['lsp', 'findings'], log })
    c.onRpc(m => (m.id === REPLAY ? undefined : write(m)))
    if (replay) {
      c.send({ ...init, id: REPLAY })
      c.send({ jsonrpc: '2.0', method: 'initialized', params: {} })
      for (const [uri, d] of docs) c.send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, ...d } } })
    }
    conn = c
    for (const m of waiting.splice(0)) c.send(m)
    void c.done.then(() => {
      conn = null
      if (ended) return
      log('the session went away; attaching to the next one')
      attach(true).catch(fail)
    })
  }
  const fail = (e: any) => {
    log(String(e?.message ?? e).split('\n')[0])
    if (init?.id !== undefined && !conn) write({ jsonrpc: '2.0', id: init.id, error: { code: -32603, message: `pcbjs: ${String(e?.message ?? e)}` } })
    process.exit(1)
  }

  const receive = (m: Msg) => {
    if (m?.jsonrpc !== '2.0') return
    track(m)
    if (m.method === 'exit') return process.exit(0)
    if (m.method === 'initialize' && !init) {
      init = m
      waiting.push(m)
      attach(false).catch(fail)
      return
    }
    if (conn) conn.send(m)
    else waiting.push(m)
  }

  process.stdin.on('data', lspReader(receive))
  return new Promise(done =>
    process.stdin.once('end', () => {
      ended = true
      conn?.close()
      done(0)
    }),
  )
}
