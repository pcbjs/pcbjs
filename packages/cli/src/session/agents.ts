// What agents ask of the session beside the queries: describe their work, read and write source, the findings, and the messages a
// human sends them, queued per connection until acknowledged. docs/mcp.md has the tools over them.
import { under } from '../project/files.js'
import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ProjectsApi } from './plugin.js'
import type { Client, Clients, Handlers } from './clients.js'
import type { By, Message, SessionEvent, TextEdit } from '@pcbjs/core/protocol'
import type { EventLog } from './events.js'
import type { Feed } from './feed.js'
import { againstOf } from './sources.js'
import { textDoc } from '@pcbjs/core/internal/textdoc'
import { scopeOf } from './scope.js'
import { boardKey } from './snapshots.js'
import { pickBoards, snapshotBoards } from '../project/query.js'
import { TIMEOUT_S } from './queries.js'

/** lines of plan an agent may post */
const PLAN_MAX = 5
/** characters of a task or progress line */
const LINE_MAX = 200

export interface AgentHooks {
  api(): ProjectsApi | undefined
  events(): EventLog | undefined
  feed(): Feed | undefined
  clients(): Clients | undefined
}

/** A content-anchored edit: `old` must occur exactly once in the file's current text. */
export interface Replace {
  old: string
  new: string
}

const real = (f: string) => {
  try {
    return realpathSync.native(f)
  } catch {
    return f
  }
}
const line = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().split('\n')[0].slice(0, LINE_MAX) : undefined)
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

const isAgent = (c: Client) => c.hello?.role === 'agent'
/** `Claude Code` and `claude-code` are one harness */
const norm = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The text edits of content-anchored replacements; throws naming the first `old` found no or several times. */
export function anchored(text: string, list: Replace[]): TextEdit[] {
  const doc = textDoc(text)
  return list.map((r, i) => {
    if (typeof r?.old !== 'string' || !r.old || typeof r.new !== 'string') throw new Error(`edits[${i}] needs old and new strings`)
    const at = text.indexOf(r.old)
    if (at < 0) throw new Error(`edits[${i}].old is not in the file; read it again`)
    if (text.indexOf(r.old, at + 1) >= 0) throw new Error(`edits[${i}].old occurs more than once; give more context`)
    return doc.edit({ start: at, end: at + r.old.length, newText: r.new })
  })
}

export type AgentMethod =
  'session/edited' | 'session/claiming' | 'session/describe' | 'session/send' | 'session/ack' | 'session/inbox' | 'session/read' | 'session/write' | 'session/findings'

export function agentMethods(h: AgentHooks): Pick<Handlers, AgentMethod> {
  // per target connection, the message events it has not acknowledged
  const inbox = new Map<string, SessionEvent<'message'>[]>()

  const projectOf = async (c: Client, at?: unknown) => {
    const p = await h.api()?.find(str(at) ?? c.hello?.project)
    if (!p) throw new Error('this session serves no project')
    return p
  }
  const fileOf = (c: Client, f: unknown) => {
    if (typeof f !== 'string' || !f) throw new Error('needs { file }')
    return real(isAbsolute(f) ? f : resolve(c.hello?.project ?? process.cwd(), f))
  }
  const sourceOf = (file: string) => h.api()?.sources().read(file) ?? null
  const deliver = (target: Client, e: SessionEvent<'message'>) => {
    const q = inbox.get(target.id) ?? []
    if (!inbox.has(target.id)) {
      inbox.set(target.id, q)
      // what the agent never read goes back to its sender
      target.onClose(() => {
        for (const m of inbox.get(target.id) ?? []) h.events()?.push('delivered', m.project, { message: m.id, to: target.id, returned: true }, null)
        inbox.delete(target.id)
      })
    }
    q.push(e)
    target.event('session/message', e)
  }
  /** `by` acknowledges for the agent, as its harness hook does; the agent's connection then forgets them too. */
  const ack = (c: Client, ids: string[] | null, by?: By) => {
    const q = inbox.get(c.id) ?? []
    const done = q.filter(m => !ids || ids.includes(m.id))
    inbox.set(
      c.id,
      q.filter(m => !done.includes(m)),
    )
    for (const m of done) h.events()?.push('delivered', m.project, { message: m.id, to: c.id }, by ?? c.by())
    return done
  }
  /** The agents a hook speaks for: by client id, else by harness name and the folder it works in. */
  const agentsFor = (p: any): Client[] => {
    const all = (h.clients()?.list() ?? []).filter(isAgent)
    if (str(p?.client)) return all.filter(c => c.id === p.client)
    const root = str(p?.root) && real(p.root)
    return all.filter(c => (!str(p?.name) || norm(c.hello?.name ?? '') === norm(p.name)) && (!root || !c.hello?.project || under(root, real(c.hello.project))))
  }

  const describe = async (p: any, c: Client) => {
    const plan = Array.isArray(p?.plan) ? p.plan.map(line).filter(Boolean).slice(0, PLAN_MAX) : typeof p?.plan === 'string' ? [line(p.plan)!].filter(Boolean) : undefined
    const next = { task: line(p?.task), plan, progress: line(p?.progress) }
    if (!next.task && !next.plan?.length && !next.progress) throw new Error('session/describe needs task, plan or progress')
    if (next.task) c.about.task = next.task
    if (next.plan?.length) c.about.plan = next.plan
    if (next.progress) c.about.progress = next.progress
    const prj = await projectOf(c).catch(() => null)
    const data: Message = { to: 'editor', from: c.id, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && (!Array.isArray(v) || v.length))) }
    const e = prj && h.events()?.push('message', prj.root, data, c.by())
    return { by: c.by(), ...(c.about.plan ? { plan: c.about.plan } : {}), ...(c.about.progress ? { progress: c.about.progress } : {}), ...(e ? { event: e.id } : {}) }
  }

  const send = async (p: any, c: Client) => {
    const agents = (h.clients()?.list() ?? []).filter(isAgent)
    const target = str(p?.to) ? agents.find(a => a.id === p.to) : agents.length === 1 ? agents[0] : undefined
    if (!target) throw new Error(agents.length ? `name the agent: ${agents.map(a => `${a.id} ${a.by().name}`).join(', ')}` : 'no agent is attached')
    const prj = await projectOf(target)
    const data: Message = {
      to: target.id,
      from: isAgent(c) ? c.id : 'editor',
      ...(Array.isArray(p?.refs) ? { refs: p.refs.map(String) } : {}),
      ...(Array.isArray(p?.ranges) ? { ranges: p.ranges } : {}),
      ...(str(p?.finding) ? { finding: p.finding } : {}),
      ...(typeof p?.comment === 'string' ? { comment: p.comment } : {}),
      ...(str(p?.board) ? { board: p.board } : {}),
      ...(p?.target !== undefined ? { target: p.target ?? null } : {}),
      ...(str(p?.snapshot) ? { snapshot: p.snapshot } : {}),
    }
    const e = h.events()?.push('message', prj.root, data, c.by())
    if (!e) throw new Error('this server keeps no events log')
    deliver(target, e)
    return { id: e.id, to: target.by() }
  }

  const inboxOf = (p: any) => {
    const list = agentsFor(p).flatMap(a => {
      if (!p?.ack) return inbox.get(a.id) ?? []
      const done = ack(a, null, a.by())
      if (done.length) a.event('session/acked', { ids: done.map(m => m.id) })
      return done
    })
    return { messages: list }
  }

  const read = async (p: any, c: Client) => {
    const file = fileOf(c, p?.file)
    if (c.transport.kind === 'tcp' && c.mode === 'ro') {
      const project = await projectOf(c)
      const rel = relative(real(project.root), file).replace(/\\/g, '/')
      if (!under(file, real(project.root)) || rel.split('/').some(part => part.startsWith('.'))) throw new Error('Read-only source access is limited to non-hidden project files')
    }
    const got = sourceOf(file)
    if (!got) throw new Error(`no file ${file}`)
    return { file, text: got.text, authority: got.authority, version: got.version }
  }

  const write = async (p: any, c: Client) => {
    const file = fileOf(c, p?.file)
    const prj = await projectOf(c, file)
    if (!under(file, prj.root)) throw new Error(`${file} is outside the project ${prj.root}`)
    const sources = h.api()?.sources()
    if (!sources) throw new Error('this session serves no project')
    const got = sources.read(file)
    if (typeof p?.text === 'string') {
      if (got || existsSync(file)) throw new Error(`${file} exists: change it with edits, never by writing it whole`)
      const edits = textDoc('').edit({ start: 0, end: 0, newText: p.text })
      const [w] = await sources.write([{ file, edits: [edits], create: true }], c.by())
      return w.applied ? { ...w, created: true as const } : w
    }
    if (!got) throw new Error(`no file ${file}; give text to create it`)
    if (!Array.isArray(p?.edits) || !p.edits.length) throw new Error('session/write needs edits [{ old, new }] or text for a new file')
    const a = againstOf(got)
    const [w] = await sources.write([{ file, edits: anchored(got.text, p.edits), ...(a ? { against: a } : {}) }], c.by())
    return w
  }

  const findings = async (p: any, c: Client) => {
    const prj = await projectOf(c, p?.project)
    const { snap, stale } = await prj.settle(TIMEOUT_S * 1000)
    if (!snap) throw new Error(`no compile of ${prj.root} finished`)
    const scope = Array.isArray(p?.scope) && p.scope.length ? scopeOf(p.scope.map(String)) : typeof p?.scope === 'string' && p.scope ? scopeOf([p.scope]) : null
    const all = snapshotBoards(snap.slots, snap.id, snap.project, b => snap.findings.get(boardKey(b)) ?? [])
    const boards = pickBoards(all, { board: str(p?.board), target: str(p?.target) }).map(b => ({
      board: b.name,
      target: b.target,
      findings: b.findings.filter(f => !scope || scope.test({ refs: [f.id, ...f.refs, ...f.refs.map(r => r.split('/')[0])], files: [] })),
    }))
    return { snapshot: snap.id, stale, boards }
  }

  /** `session/edited`: an agent's own tool wrote the file; the watcher's event for it within 2 s names that agent. */
  const edited = (p: any, c: Client) => {
    const file = fileOf(c, p?.file)
    const named = claimant(h.clients()?.list() ?? [], p ?? {})
    const by = named ?? (str(p?.client) || str(p?.name) ? { client: p.client ?? p.name, name: p.name ?? p.client, role: 'agent' as const } : c.by())
    h.feed()?.claim(file, by)
    return { file, by }
  }

  return {
    'session/edited': edited,
    'session/claiming': () => {
      h.feed()?.expectClaims()
      return {}
    },
    'session/describe': describe,
    'session/send': send,
    'session/ack': (p, c) => ({ acknowledged: ack(c, Array.isArray(p?.ids) ? p.ids.map(String) : null).map(m => m.id) }),
    'session/inbox': p => inboxOf(p),
    'session/read': read,
    'session/write': write,
    'session/findings': findings,
  }
}

/** The agent a claim names: a connected agent by client id, else by harness name inside the folder; null when none matches. */
export function claimant(clients: Client[], p: { client?: unknown; name?: unknown; root?: unknown }): By | null {
  const agents = clients.filter(isAgent)
  const byId = agents.find(c => c.id === p.client)
  if (byId) return byId.by()
  const root = str(p.root) && real(p.root as string)
  const want = norm(str(p.name) ?? str(p.client) ?? '')
  const named = agents.filter(c => want === norm(c.hello?.name ?? '') && (!root || !c.hello?.project || under(root, real(c.hello.project))))
  return named[0]?.by() ?? null
}
