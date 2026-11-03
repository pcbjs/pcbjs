// The Agent activity view without vscode: each agent the session lists, its task, plan and progress from `session/describe`, the files
// it changed and the findings delta since its first edit, all from `session/clients` and the events log.

import * as path from 'node:path'
import type { ClientInfo, SessionEvent } from '@pcbjs/core/protocol'
import type { Node } from './tree-data'

export interface Counts {
  errors: number
  warnings: number
}

/** A note the editor sent the agent: `sent` until its `delivered`, `returned` when the agent left without reading it. */
export interface Note {
  id: string
  comment: string
  at: number
  state: 'sent' | 'read' | 'returned'
}

export interface Agent {
  client: string
  name: string
  project?: string
  task?: string
  plan?: string[]
  progress?: string
  /** newest first, absolute paths */
  files: { file: string; at: number }[]
  /** newest first */
  notes: Note[]
  /** the findings of its project when it first edited, and now */
  before?: Counts
  now?: Counts
  attached: boolean
}

const FILES = 5
const NOTES = 5

export class Activity {
  private readonly agents = new Map<string, Agent>()
  /** the last findings event per board and target */
  private readonly findings = new Map<string, { project: string } & Counts>()
  private readonly seen = new Set<string>()

  /** The agents attached now; one that left stays, marked, until the view is cleared. */
  clients(list: ClientInfo[]): void {
    const now = new Set<string>()
    for (const c of list) {
      if (c.role !== 'agent') continue
      now.add(c.client)
      const a = this.agent(c.client, c.name)
      a.name = c.name
      a.attached = true
      if (c.root) a.project = c.root
      if (c.task) a.task = c.task
      if (c.plan) a.plan = c.plan
      if (c.progress) a.progress = c.progress
    }
    for (const a of this.agents.values()) if (!now.has(a.client)) a.attached = false
  }

  /** One event; each id counts once. */
  event(e: SessionEvent): boolean {
    if (this.seen.has(e.id)) return false
    this.seen.add(e.id)
    if (e.kind === 'findings') {
      const d = e.data
      this.findings.set(`${e.project}|${d.board}|${d.target ?? ''}`, { project: e.project, errors: d.errors ?? 0, warnings: d.warnings ?? 0 })
      for (const a of this.agents.values()) if (a.files.length && a.project === e.project) a.now = this.totals(e.project)
      for (const a of this.agents.values()) if (a.files.length && !a.before && a.project === e.project) a.before = a.now
      return true
    }
    if (e.kind === 'message' && e.data?.from === 'editor') return this.sent(e)
    if (e.kind === 'delivered') return this.delivered(e)
    const by = e.by
    if (!by || by.role !== 'agent') return false
    const a = this.agent(by.client, by.name)
    a.project ??= e.project
    if (by.task) a.task = by.task
    if (e.kind === 'edit' || e.kind === 'save') {
      if (!a.files.length) {
        const t = this.totals(e.project)
        if (t) a.before = a.now = t
      }
      const file = path.resolve(e.project, e.data.file)
      a.files = [{ file, at: e.t }, ...a.files.filter(f => f.file !== file)].slice(0, FILES)
    } else if (e.kind === 'message' && e.data?.to === 'editor') {
      if (e.data.task) a.task = e.data.task
      if (e.data.plan) a.plan = e.data.plan
      if (e.data.progress) a.progress = e.data.progress
    }
    return true
  }

  private sent(e: SessionEvent<'message'>): boolean {
    const a = this.agents.get(e.data.to)
    if (!a) return false
    a.notes = [{ id: e.id, comment: e.data.comment ?? '', at: e.t, state: 'sent' as const }, ...a.notes].slice(0, NOTES)
    return true
  }

  private delivered(e: SessionEvent<'delivered'>): boolean {
    const note = this.agents.get(e.data?.to)?.notes.find(n => n.id === e.data.message)
    if (!note) return false
    note.state = e.data.returned ? 'returned' : 'read'
    return true
  }

  list(): Agent[] {
    return [...this.agents.values()]
  }

  get(client: string): Agent | undefined {
    return this.agents.get(client)
  }

  /** Errors and warnings up or down since the first edit. */
  delta(a: Agent): Counts | undefined {
    if (!a.before || !a.now) return undefined
    return { errors: a.now.errors - a.before.errors, warnings: a.now.warnings - a.before.warnings }
  }

  private agent(client: string, name: string): Agent {
    let a = this.agents.get(client)
    if (!a) this.agents.set(client, (a = { client, name, files: [], notes: [], attached: true }))
    return a
  }

  private totals(project: string): Counts | undefined {
    const rows = [...this.findings.values()].filter(f => f.project === project)
    if (!rows.length) return undefined
    return { errors: rows.reduce((n, r) => n + r.errors, 0), warnings: rows.reduce((n, r) => n + r.warnings, 0) }
  }
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

/** `12 s ago`, `3 min ago`, `2 h ago`. */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}

/** One node per agent, attached first: progress, plan, the findings delta and the files it changed, each file opening. */
export function agentNodes(activity: Activity, now = Date.now()): Node[] {
  return activity
    .list()
    .sort((a, b) => Number(b.attached) - Number(a.attached))
    .map(a => {
      const d = activity.delta(a)
      const delta = d ? `errors ${signed(d.errors)}, warnings ${signed(d.warnings)}` : undefined
      const children: Node[] = [
        ...(a.progress ? [{ id: `agent:${a.client}:progress`, label: a.progress, icon: 'pulse' }] : []),
        ...(a.plan ?? []).map((l, i) => ({ id: `agent:${a.client}:plan:${i}`, label: l, icon: 'checklist' })),
        ...(delta
          ? [{ id: `agent:${a.client}:delta`, label: delta, description: 'since its first edit', icon: d!.errors > 0 ? 'error' : d!.warnings > 0 ? 'warning' : 'pass' }]
          : []),
        ...a.notes.map(n => ({
          id: `agent:${a.client}:note:${n.id}`,
          label: n.comment || 'selection',
          description: `${n.state === 'sent' ? 'Sent to' : n.state === 'read' ? 'Read by' : 'Returned unread by'} ${a.name}, ${ago(n.at, now)}`,
          icon: n.state === 'sent' ? 'mail' : n.state === 'read' ? 'mail-read' : 'reply',
        })),
        ...a.files.map(f => ({
          id: `agent:${a.client}:file:${f.file}`,
          label: path.basename(f.file),
          description: ago(f.at, now),
          tooltip: f.file,
          icon: 'file',
          action: { kind: 'source' as const, source: { file: f.file, line: 1, col: 1, endLine: 1, endCol: 1 } },
        })),
      ]
      return {
        id: `agent:${a.client}`,
        label: a.name,
        description: [a.attached ? '' : 'left', a.task ?? '', delta ?? ''].filter(Boolean).join(' · ') || undefined,
        tooltip: [a.name, a.task, a.project, ...(a.plan ?? []).map(l => `- ${l}`)].filter(Boolean).join('\n'),
        icon: a.attached ? 'hubot' : 'debug-disconnect',
        context: a.attached ? 'agent' : undefined,
        agent: a.client,
        children,
        expanded: a.attached,
      }
    })
}
