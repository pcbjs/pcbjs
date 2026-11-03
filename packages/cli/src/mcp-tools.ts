// The tools of `pcbjs mcp`, each a thin call of the session; the descriptions stay short and point at `pcbjs docs`. docs/mcp.md lists them.
import { docsDir, grepDocs, topicOf, topicTable, topics } from './docs.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Envelope, Method, Params, Result } from '@pcbjs/core/protocol'

export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

export interface ToolResult {
  content: Content[]
  isError?: boolean
}

export interface ToolContext {
  root: string
  ask<M extends Method>(method: M, params?: Params<M>, timeoutMs?: number): Promise<Result<M>>
  /** the cursor `events` continues from */
  cursor: { next: string | null }
}

interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run(args: any, cx: ToolContext): Promise<ToolResult>
}

const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] })
const json = (v: unknown): ToolResult => text(JSON.stringify(v, null, 2))
const strings = { type: 'array', items: { type: 'string' } }
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
})
const head = (e: Pick<Envelope<unknown>, 'snapshot' | 'stale' | 'overlay'>) =>
  `snapshot ${e.snapshot}${e.stale ? `, stale: ${e.stale.reason}${e.stale.current ? `, now ${e.stale.current}` : ''}` : ''}${e.overlay.length ? `, unsaved text of ${e.overlay.join(', ')}` : ''}`

/** s a check may take */
const CHECK_S = 600

const RENDER_SPEC = {
  view: { enum: ['2d', '3d', 'sch'] },
  entry: { type: 'string' },
  target: { type: 'string' },
  camera: { description: 'iso, top, bottom, front, or a camera object' },
  frame: { type: 'string', description: 'a reference, finding id, net, group path or x0,y0,x1,y1 in mm' },
  margin: { type: 'number' },
  highlight: strings,
  dim: { type: 'number' },
  opacity: { type: 'object', additionalProperties: { type: 'number' } },
  layers: strings,
  side: { enum: ['F', 'B'] },
  mirror: { type: 'boolean' },
  explode: { type: 'number' },
  theme: { enum: ['light', 'dark', 'hc'] },
  size: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
  quality: { type: 'number' },
  findings: strings,
  marks: { type: 'array', items: { type: 'object' } },
}

export const TOOLS: Tool[] = [
  {
    name: 'check',
    description: 'Compile, route and run DRC and ERC on the boards, as `pcbjs check` prints it, with the type check. pcbjs docs check reads the output.',
    inputSchema: obj({ entries: { ...strings, description: 'entries of pcb.config.ts, all by default' } }),
    async run(a, cx) {
      const e = await cx.ask('session/check', { project: cx.root, entries: a.entries ?? [] }, CHECK_S * 1000)
      return text(`${e.value.stdout}exit ${e.value.exitCode}; ${head(e)}`)
    },
  },
  {
    name: 'inspect',
    description: 'Absolute positions of parts, nets and pads, or route lengths, as `pcbjs inspect` prints them. pcbjs docs inspect.',
    inputSchema: obj({
      entry: { type: 'string' },
      refs: { ...strings, description: 'R1, net:VCC, U1/3; none for the whole board' },
      lengths: { type: ['boolean', 'string'] },
      target: { type: 'string' },
    }),
    async run(a, cx) {
      const refs: string[] = a.refs ?? []
      const lengths = a.lengths === true ? [{ lengths: true }] : typeof a.lengths === 'string' && a.lengths ? [{ query: a.lengths, lengths: true }] : []
      const requests = [...refs.map(q => ({ query: q })), ...lengths]
      const e = await cx.ask('session/inspect', {
        project: cx.root,
        entry: a.entry,
        target: a.target,
        requests: requests.length ? requests : [{}],
      })
      return { ...text(`${e.value.stdout}${e.value.stderr}${head(e)}`), ...(e.value.exitCode ? { isError: true } : {}) }
    },
  },
  {
    name: 'query',
    description: 'The full record of one reference: R1, CH2/R01/2, net:VCC, route:3, a finding id such as drc:clearance:7f3a. pcbjs docs queries.',
    inputSchema: obj({ reference: { type: 'string' }, board: { type: 'string' }, target: { type: 'string' } }, ['reference']),
    async run(a, cx) {
      const e = await cx.ask('session/q', { project: cx.root, reference: a.reference, board: a.board, target: a.target })
      return { ...json(e), ...(e.value.exit ? { isError: true } : {}) }
    },
  },
  {
    name: 'render',
    description: 'A PNG of the 2D, 3D or schematic view with a one-line legend: frame a reference, highlight, layers, side, explode, marks. pcbjs docs render.',
    inputSchema: obj(RENDER_SPEC),
    async run(a, cx) {
      const e = await cx.ask('session/render', { project: cx.root, spec: a }, 120_000)
      return {
        content: [
          { type: 'image', data: e.value.png, mimeType: 'image/png' },
          { type: 'text', text: e.value.legend },
        ],
      }
    },
  },
  {
    name: 'script',
    description: 'Evaluate a read-only expression against the compiled board: board.part, net, finding, items.near, distance, clearance. pcbjs docs queries.',
    inputSchema: obj({ code: { type: 'string' }, board: { type: 'string' }, target: { type: 'string' }, timeout: { type: 'number', description: 'ms, default 2000' } }, ['code']),
    async run(a, cx) {
      const e = await cx.ask('session/script', { project: cx.root, code: a.code, board: a.board, target: a.target, timeout: a.timeout })
      const v = e.value as { exit: number; output?: string; error?: string }
      return { ...text(`${v.exit ? v.error : (v.output ?? '')}\n${head(e)}`), ...(v.exit ? { isError: true } : {}) }
    },
  },
  {
    name: 'docs',
    description: 'The pcbjs docs: no arguments lists the topics, topic prints one, grep searches every line.',
    inputSchema: obj({ topic: { type: 'string' }, grep: { type: 'string' } }),
    async run(a) {
      const dir = docsDir()
      if (!dir) return { ...text('the docs are not in this installation of pcbjs'), isError: true }
      const t = a.topic ? topicOf(dir, a.topic) : null
      if (a.topic && !t) return { ...text(`no topic ${a.topic}; topics: ${topics(dir).join(', ')}`), isError: true }
      if (a.grep) return text(grepDocs(dir, a.grep, t ? [t] : undefined).join('\n') || `no line matches ${a.grep}`)
      return text(t ? readFileSync(join(dir, `${t}.md`), 'utf8') : topicTable(dir).join('\n'))
    },
  },
  {
    name: 'read',
    description: "A source file as the session compiles it: the editor's unsaved text when open, else disk. Lines from 1.",
    inputSchema: obj({ file: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' } }, ['file']),
    async run(a, cx) {
      const r = await cx.ask('session/read', { file: a.file })
      const lines = r.text.split('\n')
      const s = Math.max(1, a.start ?? 1),
        e = Math.min(lines.length, a.end ?? lines.length)
      return text(
        `${r.file} from ${r.authority === 'restored' ? 'disk, the editor holds a restored buffer' : r.authority}, lines ${s}-${e} of ${lines.length}\n${lines.slice(s - 1, e).join('\n')}`,
      )
    },
  },
  {
    name: 'write',
    description: 'Change a source file through the editor when one is open, else on disk: edits replace each old string, found exactly once, by new; text creates a new file only.',
    inputSchema: obj(
      { file: { type: 'string' }, edits: { type: 'array', items: obj({ old: { type: 'string' }, new: { type: 'string' } }, ['old', 'new']) }, text: { type: 'string' } },
      ['file'],
    ),
    async run(a, cx) {
      const w = await cx.ask('session/write', { file: a.file, edits: a.edits, text: a.text })
      return { ...text(`${w.applied ? 'wrote' : 'the editor refused'} ${w.file} via ${w.via}`), ...(w.applied ? {} : { isError: true }) }
    },
  },
  {
    name: 'events',
    description:
      'What happened since the last call: edits with who made them, compiles, findings deltas, selections, messages. wait blocks for the kinds in for. pcbjs docs queries.',
    inputSchema: obj({
      since: { type: 'string' },
      wait: { type: 'boolean' },
      for: strings,
      timeout: { type: 'number', description: 's' },
      kind: strings,
      scope: { ...strings, description: 'CH2/*, net:VCC, route:*, a file' },
    }),
    async run(a, cx) {
      const since = a.since ?? cx.cursor.next
      const r = await cx.ask(
        'session/events',
        { project: cx.root, since, kind: a.kind, scope: a.scope, ...(a.wait ? { wait: true, for: a.for, timeout: a.timeout ?? 60 } : {}) },
        ((a.timeout ?? 60) + 30) * 1000,
      )
      cx.cursor.next = r.next
      const lines = [
        ...(r.reset ? [JSON.stringify({ reset: r.reset })] : []),
        ...r.events.map(e => JSON.stringify(e)),
        JSON.stringify({ next: r.next, ...(r.timeout ? { timeout: true } : {}) }),
      ]
      return text(lines.join('\n'))
    },
  },
  {
    name: 'session',
    description: 'Say what you do, before your first edit and as it changes: task one line, plan up to five lines, progress one line. Returns the session and its clients.',
    inputSchema: obj({ task: { type: 'string' }, plan: strings, progress: { type: 'string' } }),
    async run(a, cx) {
      const said = a.task || a.plan || a.progress ? await cx.ask('session/describe', { task: a.task, plan: a.plan, progress: a.progress }) : null
      const st = await cx.ask('session/status')
      const clients = await cx.ask('session/clients')
      return json({ ...(said ? { described: said } : {}), session: st.session, pid: st.pid, version: st.version, projects: st.projects, clients })
    },
  },
]

/** What the server's instructions ask of every agent. */
export const INSTRUCTIONS = [
  'pcbjs designs printed circuit boards as TypeScript and JSX; this server is a client of the pcbjs session that compiles them.',
  'Before your first edit call session with your task and a plan of up to five lines, and update progress as you go, so the human can redirect you early.',
  'Use check after each change, query and inspect for detail, render to look. Change source with write, edits anchored on text you read; never overwrite an existing file whole.',
  'Messages from the human arrive at the top of a tool result; act on them first. The docs tool holds the detail: start with docs topic basics.',
].join('\n')
