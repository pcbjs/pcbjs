// `pcbjs mcp`: an MCP server on stdio, newline-delimited JSON-RPC, that is a thin client of the session; an `agent` connection named by the
// harness's initialize. Messages a human sends arrive at the top of the next tool result. docs/mcp.md has the tools and resources.
import { VERSION } from './server/listen.js'
import { connectSession, type SessionConn } from './session/client.js'
import { lineReader } from './session/frames.js'
import { attachSession } from './session/starter.js'
import { liveSession } from './session/start.js'
import type { Params, SessionEvent } from '@pcbjs/core/protocol'
import { real } from './session/paths.js'
import { INSTRUCTIONS, TOOLS, type Content, type ToolContext } from './mcp-tools.js'

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
const LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency']
/** ms between attempts to rejoin an available session while the harness keeps stdin open */
const RETRY_MS = 2000

type Rpc = { jsonrpc: '2.0'; id?: number | string; method?: string; params?: any }

const RESOURCE = /^pcbjs:\/\/([^/?]+)\/(findings|board|watch)(?:\?(.*))?$/

/** The board, kind and query of a resource URI. */
export function parseUri(uri: string): { board: string; kind: 'findings' | 'board' | 'watch'; query: URLSearchParams } | null {
  const m = RESOURCE.exec(uri)
  return m ? { board: decodeURIComponent(m[1]), kind: m[2] as 'findings', query: new URLSearchParams(m[3] ?? '') } : null
}

/** One human message as the agent reads it. */
export function messageText(e: SessionEvent<'message'>): string {
  const d = e.data
  const from = e.by?.name ?? d.from
  return [
    `pcbjs message ${e.id} from ${from}${d.comment ? `: ${d.comment}` : ''}`,
    ...(d.refs?.length ? [`  refs: ${d.refs.join(', ')}`] : []),
    ...(d.finding ? [`  finding: ${d.finding}`] : []),
    ...(d.ranges ?? []).map(r => `  range: ${r.file}:${r.line}:${r.col}-${r.endLine}:${r.endCol}`),
    ...(d.board ? [`  board: ${d.board}${d.target ? ` [${d.target}]` : ''}${d.snapshot ? `, snapshot ${d.snapshot}` : ''}`] : []),
  ].join('\n')
}

export async function mcp(o: { cwd?: string } = {}): Promise<number> {
  const root = real(o.cwd ?? process.cwd())
  const out = (m: unknown) => process.stdout.write(JSON.stringify(m) + '\n')
  const log = (l: string) => process.stderr.write(`[pcbjs mcp] ${l}\n`)
  let name = 'pcbjs mcp'
  let level = LEVELS.indexOf('info')
  let conn: Promise<SessionConn> | null = null
  let generation = 0
  let following = false
  let initialized = false
  let closing = false
  let retry: ReturnType<typeof setTimeout> | undefined
  let about: Params<'session/describe'> = {}
  const pending: SessionEvent<'message'>[] = []
  const subs = new Map<string, string>()
  const cursor: ToolContext['cursor'] = { next: null }

  const notify = (method: string, params: unknown) => out({ jsonrpc: '2.0', method, params })
  const logMessage = (lvl: string, data: string) => LEVELS.indexOf(lvl) >= level && notify('notifications/message', { level: lvl, logger: 'pcbjs', data })

  const reconnect = () => {
    if (closing || !initialized || retry) return
    retry = setTimeout(() => {
      retry = undefined
      void connect(false)
        .then(async () => {
          if (subs.size) await follow()
        })
        .catch(() => reconnect())
    }, RETRY_MS)
    retry.unref()
  }

  const connect = (start = true): Promise<SessionConn> => {
    if (conn) return conn
    const attempt = ++generation
    return (conn = (async () => {
      if (closing) throw new Error('the MCP transport is closing')
      const options = { name, role: 'agent' as const, capabilities: ['findings'], log }
      const info = start ? null : await liveSession(root)
      if (!start && !info) throw new Error('waiting for the pcbjs session to return')
      const c = info ? await connectSession(info.socket, { ...options, project: root, token: info.token }) : await attachSession(root, options)
      if (closing) {
        c.close()
        throw new Error('the MCP transport is closing')
      }
      c.onEvent((event, data: any) => {
        if (event === 'session/message') {
          pending.push(data)
          logMessage('notice', messageText(data))
        } else if (event === 'session/acked') {
          // a harness hook showed them already
          const shown = new Set<string>(data?.ids ?? [])
          pending.splice(0, pending.length, ...pending.filter(m => !shown.has(m.id)))
        } else if (event === 'session/event' && data?.kind === 'findings') void refresh(data.data.board)
      })
      void c.done.then(() => {
        if (attempt !== generation) return
        conn = null
        following = false
        reconnect()
      })
      try {
        cursor.next ??= (await c.request('session/events', { project: root })).next
        if (Object.keys(about).length) await c.request('session/describe', about)
      } catch (e) {
        c.close()
        throw e
      }
      return c
    })().catch(e => {
      if (attempt === generation) conn = null
      throw e
    }))
  }
  const ask: ToolContext['ask'] = async (method, params, ms) => {
    const result = await (await connect()).request(method, params, ms)
    if (method === 'session/describe') {
      for (const key of ['task', 'plan', 'progress'] as const) if (params && (params as any)[key] !== undefined) about = { ...about, [key]: (params as any)[key] }
    }
    return result
  }
  const cx: ToolContext = { root, ask, cursor }

  const follow = async () => {
    if (following) return
    await ask('session/events', { project: root, follow: true, kind: ['findings'] })
    following = true
  }

  const entryOf = async (board: string): Promise<string | undefined> => {
    const e = await ask('session/boards', { project: root })
    return e.value.boards.find((b: { name?: string }) => b.name === board)?.entry
  }
  /** What a resource holds now, without the snapshot id so a recompile that changed nothing reads the same. */
  const readResource = async (uri: string): Promise<{ text: string; mimeType: string; body: string }> => {
    const r = parseUri(uri)
    if (!r) throw new Error(`no resource ${uri}`)
    if (r.kind === 'findings') {
      const scope = r.query.getAll('scope')
      const v = await ask('session/findings', { project: root, board: r.board, scope })
      const body = JSON.stringify(v.boards, null, 2)
      return { text: JSON.stringify({ snapshot: v.snapshot, stale: v.stale, boards: v.boards }, null, 2), mimeType: 'application/json', body }
    }
    if (r.kind === 'watch') {
      const code = r.query.get('script')
      if (!code) throw new Error(`${uri} needs ?script=<expression>`)
      const e = await ask('session/script', { project: root, code, board: r.board })
      const body = e.value.exit ? `error: ${e.value.error}` : (e.value.output ?? '')
      return { text: body, mimeType: 'text/plain', body }
    }
    const e = await ask('session/inspect', { project: root, entry: await entryOf(r.board), requests: [{}] })
    return { text: e.value.stdout + e.value.stderr, mimeType: 'text/plain', body: e.value.stdout + e.value.stderr }
  }
  let refreshing = Promise.resolve()
  const refresh = (board: string) =>
    (refreshing = refreshing.then(async () => {
      for (const [uri, last] of [...subs]) {
        if (parseUri(uri)?.board !== board) continue
        const now = await readResource(uri).then(
          r => r.body,
          e => `error: ${e?.message ?? e}`,
        )
        if (now === last || !subs.has(uri)) continue
        subs.set(uri, now)
        notify('notifications/resources/updated', { uri })
      }
    }))

  /** The messages that came since the last tool result, acknowledged as they go out. */
  const inbox = async (): Promise<Content[]> => {
    const list = pending.splice(0)
    if (!list.length) return []
    await ask('session/ack', { ids: list.map(m => m.id) }).catch(() => {})
    return [{ type: 'text', text: list.map(messageText).join('\n\n') }]
  }

  const methods: Record<string, (p: any) => unknown> = {
    initialize: async p => {
      if (typeof p?.clientInfo?.name === 'string' && p.clientInfo.name) name = p.clientInfo.name
      await connect()
      initialized = true
      return {
        protocolVersion: PROTOCOLS.includes(p?.protocolVersion) ? p.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: {}, resources: { subscribe: true }, logging: {} },
        serverInfo: { name: 'pcbjs', version: VERSION },
        instructions: INSTRUCTIONS,
      }
    },
    ping: () => ({}),
    'logging/setLevel': p => {
      if (LEVELS.includes(p?.level)) level = LEVELS.indexOf(p.level)
      return {}
    },
    'tools/list': () => ({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }),
    'tools/call': async p => {
      const tool = TOOLS.find(t => t.name === p?.name)
      if (!tool) throw Object.assign(new Error(`no tool ${p?.name}`), { code: -32602 })
      let r
      try {
        r = await tool.run(p.arguments ?? {}, cx)
      } catch (e: any) {
        r = { content: [{ type: 'text' as const, text: String(e?.message ?? e) }], isError: true }
      }
      const top = await inbox().catch(() => [])
      return { ...r, content: [...top, ...r.content] }
    },
    'resources/list': async () => {
      const e = await ask('session/boards', { project: root })
      const names: string[] = [...new Set<string>(e.value.boards.flatMap(b => (b.name ? [b.name] : [])))]
      return {
        resources: names.flatMap(n => [
          { uri: `pcbjs://${encodeURIComponent(n)}/board`, name: n, description: `${n}: parts, nets and positions`, mimeType: 'text/plain' },
          { uri: `pcbjs://${encodeURIComponent(n)}/findings`, name: `${n} findings`, description: `${n}: every DRC and ERC finding with its id`, mimeType: 'application/json' },
        ]),
      }
    },
    'resources/templates/list': () => ({
      resourceTemplates: [
        {
          uriTemplate: 'pcbjs://{board}/findings{?scope}',
          name: 'findings in a scope',
          description: 'findings touching a reference pattern such as CH2/* or net:VCC',
          mimeType: 'application/json',
        },
        { uriTemplate: 'pcbjs://{board}/watch{?script}', name: 'a standing query', description: 'a script expression, updated when its value changes', mimeType: 'text/plain' },
      ],
    }),
    'resources/read': async p => {
      const r = await readResource(String(p?.uri))
      return { contents: [{ uri: p.uri, mimeType: r.mimeType, text: r.text }] }
    },
    'resources/subscribe': async p => {
      const uri = String(p?.uri)
      if (!parseUri(uri)) throw Object.assign(new Error(`no resource ${uri}`), { code: -32602 })
      subs.set(uri, (await readResource(uri)).body)
      await follow()
      return {}
    },
    'resources/unsubscribe': p => {
      subs.delete(String(p?.uri))
      return {}
    },
  }

  const handle = async (m: Rpc) => {
    if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return
    const fn = methods[m.method]
    if (m.id === undefined) return
    if (!fn) return out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `no method ${m.method}` } })
    try {
      out({ jsonrpc: '2.0', id: m.id, result: await fn(m.params) })
    } catch (e: any) {
      out({ jsonrpc: '2.0', id: m.id, error: { code: typeof e?.code === 'number' ? e.code : -32603, message: String(e?.message ?? e) } })
    }
  }

  process.stdin.on(
    'data',
    lineReader(
      m => void handle(m as Rpc),
      () => log('a frame past 16 MB was dropped'),
    ),
  )
  return new Promise(done =>
    process.stdin.once('end', async () => {
      closing = true
      clearTimeout(retry)
      const c = await conn?.catch(() => null)
      c?.close()
      done(0)
    }),
  )
}
