// free of Vue and the DOM, written as erasable TypeScript so Node imports it in the tests: the agents a viewer may send its selection to
import type { AgentInfo, SendRequest } from '@pcbjs/core/protocol'

/** The last agent chosen, kept per viewer. */
export interface LastAgent {
  client: string
  name: string
}

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/** The agents of a `pcbjs:agents` event; anything malformed is left out. */
export function parseAgents(d: unknown): AgentInfo[] {
  const list = (d as { agents?: unknown } | null)?.agents
  if (!Array.isArray(list)) return []
  return list.flatMap(a =>
    a && str(a.client) && str(a.name)
      ? [{ client: a.client, name: a.name, ...(str(a.task) ? { task: a.task } : {}), ...(str(a.since) ? { since: a.since } : {}), ...(str(a.root) ? { root: a.root } : {}) }]
      : [],
  )
}

/** The agents with the default first: the last one chosen while attached, else one of its name, else the list as given. */
export function agentChoices(list: readonly AgentInfo[], last: LastAgent | null): AgentInfo[] {
  const first = (last && (list.find(a => a.client === last.client) ?? list.find(a => a.name === last.name))) || null
  return first ? [first, ...list.filter(a => a !== first)] : [...list]
}

/** `12 s ago`, `3 min ago`, `2 h ago`, as the extension's picker says it. */
export function agentAge(since: string | undefined, now: number): string {
  const at = since ? Date.parse(since) : NaN
  if (Number.isNaN(at)) return ''
  const s = Math.max(0, Math.round((now - at) / 1000))
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}

/** One line per agent for the picker: name, then its task or folder, then how long it has been attached. */
export function agentLabel(a: AgentInfo, now: number): string {
  return [a.name, a.task ?? a.root, agentAge(a.since, now)].filter(Boolean).join(' · ')
}

/** What a send carries from a viewer: the members in joining order with the anchor first, and the board and target they are on. */

export function sendRequest(board: string, target: string | null, sel: { refs: readonly string[]; anchor: string | null }): SendRequest {
  const refs = sel.anchor ? [sel.anchor, ...sel.refs.filter(r => r !== sel.anchor)] : [...sel.refs]
  return { board, target, refs }
}

/** What became of a send as the toast says it: its answer or error, then its `delivered` event, read or returned. */
export function sendNotice(m: { name?: unknown; error?: unknown; returned?: unknown; read?: unknown }): { text: string; err: boolean } | null {
  if (str(m.error)) return { text: `Cannot send: ${m.error}`, err: true }
  if (!str(m.name)) return null
  if (m.returned) return { text: `Returned: ${m.name} left before reading it`, err: true }
  return { text: m.read ? `Read by ${m.name}` : `Sent to ${m.name}`, err: false }
}
