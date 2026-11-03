// `pcbjs hook prompt|edited`: the agent harness hooks `pcbjs skills install` writes. prompt prints the events since the last turn and the
// messages waiting; edited claims a write of the harness's own tools. Both read the hook's JSON on stdin and stay silent without a session.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { connectSession } from './session/client.js'
import { liveSession, repoSession } from './session/start.js'
import { real } from './session/paths.js'
import type { SessionEvent } from '@pcbjs/core/protocol'
import { messageText } from './mcp.js'

/** lines of events a turn gets at most */
const MAX_LINES = 30

const readStdin = async (): Promise<any> => {
  let s = ''
  for await (const c of process.stdin) s += c
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

/** The events of a turn in short: who edited what, the findings of each board, the selection. */
export function turnLines(events: SessionEvent[]): string[] {
  const edits = new Map<string, number>()
  const boards = new Map<string, string>()
  let selection: string[] | null = null
  for (const e of events) {
    if (e.kind === 'edit') {
      const d = (e as SessionEvent<'edit'>).data
      const k = `${d.file} by ${e.by?.name ?? 'disk'}${e.by?.role ? ` (${e.by.role})` : ''}`
      edits.set(k, (edits.get(k) ?? 0) + 1)
    } else if (e.kind === 'findings') {
      const d = (e as SessionEvent<'findings'>).data
      const was = boards.get(d.board)?.match(/(\d+) new, (\d+) fixed/)
      const added = d.added.length + Number(was?.[1] ?? 0),
        fixed = d.resolved.length + Number(was?.[2] ?? 0)
      boards.set(d.board, `${d.board}${d.target ? ` [${d.target}]` : ''}: ${d.errors} errors, ${d.warnings} warnings, ${d.unconnected} unconnected; ${added} new, ${fixed} fixed`)
    } else if (e.kind === 'selection') selection = (e as SessionEvent<'selection'>).data.refs
  }
  return [
    ...[...edits].map(([k, n]) => `edit ${k}${n > 1 ? `, ${n} times` : ''}`),
    ...[...boards.values()].map(b => `check ${b}`),
    ...(selection?.length ? [`selected ${selection.join(', ')}`] : []),
  ].slice(0, MAX_LINES)
}

const cursorFile = (root: string, id: string) => join(root, '.pcbjs', 'agents', `${String(id).replace(/[^\w.-]/g, '_') || 'default'}.json`)

async function prompt(input: any, name: string): Promise<number> {
  const root = real(input.cwd ?? process.cwd())
  const s = (await liveSession(root)) ?? (await repoSession(root))
  if (!s) return 0
  const c = await connectSession(s.socket, { name: 'pcbjs hook', role: 'cli', project: root, token: (s as { token?: string }).token })
  try {
    // the edit hook claims this harness's writes from now on
    await c.request('session/claiming')
    const file = cursorFile(root, input.session_id ?? 'default')
    let since: string | null = null
    try {
      since = JSON.parse(readFileSync(file, 'utf8')).next
    } catch {}
    const r = await c.request('session/events', { project: root, ...(since ? { since } : {}) })
    mkdirSync(join(root, '.pcbjs', 'agents'), { recursive: true })
    writeFileSync(file, JSON.stringify({ next: r.next }) + '\n')
    const lines = turnLines(r.events)
    const inbox = await c.request('session/inbox', { name, root, ack: true })
    const out = [...(lines.length ? ['pcbjs since your last turn:', ...lines.map(l => `  ${l}`)] : []), ...inbox.messages.map(messageText)]
    if (out.length) console.log(out.join('\n'))
  } finally {
    c.close()
  }
  return 0
}

async function edited(input: any, name: string): Promise<number> {
  const root = real(input.cwd ?? process.cwd())
  const path = input.tool_input?.file_path ?? input.tool_input?.path
  if (typeof path !== 'string' || !path) return 0
  const s = (await liveSession(root)) ?? (await repoSession(root))
  if (!s) return 0
  const c = await connectSession(s.socket, { name: 'pcbjs hook', role: 'cli', project: root, token: (s as { token?: string }).token })
  try {
    await c.request('session/edited', { file: isAbsolute(path) ? path : resolve(root, path), name, root })
  } finally {
    c.close()
  }
  return 0
}

/** Never fails the harness's turn: an error goes to stderr and the exit is 0. */
export async function hook(action: string, o: { name?: string } = {}): Promise<number> {
  const name = o.name ?? 'claude-code'
  try {
    const input = await readStdin()
    if (action === 'prompt') return await prompt(input, name)
    if (action === 'edited') return await edited(input, name)
    console.error(`pcbjs hook: unknown action ${action}, use prompt or edited`)
    return 1
  } catch (e: any) {
    console.error(`pcbjs hook: ${String(e?.message ?? e).split('\n')[0]}`)
    return 0
  }
}
