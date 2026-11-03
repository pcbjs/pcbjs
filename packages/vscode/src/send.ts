// Send to agent: the selection of the editor, a tree, or a viewer as one message to an agent the session lists, through `session/send`,
// and what became of it, Sent to, Read by or Returned, from the session's `delivered` events.

import type { ClientInfo, Method, Params, Result, SessionEvent } from '@pcbjs/core/protocol'
import * as vscode from 'vscode'
import { ago } from './agents'
import type { SelectRequest } from './protocol'
import type { Node } from './tree-data'

export const PLACEHOLDER = 'What should the agent do with this?'
/** the context key the menus enable Send to agent with */
export const AGENTS_KEY = 'pcbjs.agents'

/** What a message carries besides its comment: one refs list, the editor ranges, a finding by its exact id, and where they are. */
export interface Payload {
  refs: string[]
  ranges: SelectRequest[]
  finding?: string
  board?: string
  target?: string | null
  snapshot?: string
}

/** What the preview's frame posts for its chip's Send to agent. */
export interface ViewerSend {
  viewer: true
  board: string
  target: string | null
  refs: string[]
}

export interface LastAgent {
  client: string
  name: string
}

export interface SendDeps {
  request<M extends Method>(method: M, params?: Params<M>): Promise<Result<M>>
  /** the board the viewers show */
  board(): string | undefined
  /** the session's selection of a board, as its last `selection` event said */
  selection(board: string): string[] | undefined
  memory: { get(): LastAgent | undefined; set(v: LastAgent): unknown }
  now?(): number
}

const isNode = (v: unknown): v is Node => !!v && typeof (v as Node).id === 'string' && typeof (v as Node).label === 'string'
const isViewer = (v: unknown): v is ViewerSend => !!v && (v as ViewerSend).viewer === true && typeof (v as ViewerSend).board === 'string'
const key = (board: string, target: string | null | undefined) => `${board}|${target ?? ''}`

/** An editor selection as `session/send` takes it: 1-based, `endCol` inclusive. */
export function rangeOf(file: string, s: vscode.Selection): SelectRequest {
  const empty = s.start.line === s.end.line && s.start.character === s.end.character
  return { file, line: s.start.line + 1, col: s.start.character + 1, endLine: s.end.line + 1, endCol: empty ? s.start.character + 1 : s.end.character }
}

/** The rows of a tree, the clicked one first, as one message: every ref and finding they name, the first finding as `finding`. */
export function treePayload(nodes: readonly Node[]): Payload {
  const acts = nodes.map(n => n.action).filter(a => a?.kind === 'ref' || a?.kind === 'finding')
  const refs = [...new Set(acts.map(a => (a!.kind === 'ref' ? a!.ref : a!.kind === 'finding' ? a!.id : '')).filter(Boolean))]
  const finding = acts.find(a => a?.kind === 'finding')
  const board = acts.find(a => a && 'board' in a)
  return { refs, ranges: [], ...(finding?.kind === 'finding' ? { finding: finding.id } : {}), ...(board && 'board' in board ? { board: board.board } : {}) }
}

/** The quick pick of several agents, the last one chosen first, else one of its name; one agent is chosen at once. */
export async function pickAgent(agents: ClientInfo[], last: LastAgent | undefined, now: number): Promise<ClientInfo | undefined> {
  if (agents.length <= 1) return agents[0]
  const first = (last && (agents.find(a => a.client === last.client) ?? agents.find(a => a.name === last.name))) || undefined
  const sorted = first ? [first, ...agents.filter(a => a !== first)] : agents
  const items = sorted.map(a => ({
    label: `$(hubot) ${a.name}`,
    description: a.task ?? a.root,
    detail: a.since ? `attached ${ago(Date.parse(a.since), now)}` : undefined,
    agent: a,
  }))
  const chosen = await vscode.window.showQuickPick(items, { title: 'Send to agent', placeHolder: 'Send to which agent?', matchOnDescription: true })
  return chosen?.agent
}

export class AgentSender {
  agents: ClientInfo[] = []
  /** message id to the agent's name, until its `delivered` */
  private readonly sent = new Map<string, string>()
  /** a `delivered` that came before the answer to its send */
  private readonly early = new Map<string, boolean>()
  /** the snapshot of each board and target, from its last `findings` event, and the newest of any */
  private readonly snapshots = new Map<string, string>()
  private latest: string | undefined
  /** the context key was set once */
  private keyed = false

  constructor(private readonly deps: SendDeps) {}

  /** `session/clients`: the agents, and the context key that greys the menu item without one. */
  clients(list: readonly ClientInfo[]): void {
    const was = this.agents.length > 0
    this.agents = list.filter(c => c.role === 'agent')
    if (was !== this.agents.length > 0 || !this.keyed) void vscode.commands.executeCommand('setContext', AGENTS_KEY, this.agents.length > 0)
    this.keyed = true
  }

  /** Fetch the agents again. */
  async refresh(): Promise<ClientInfo[]> {
    this.clients(await this.deps.request('session/clients'))
    return this.agents
  }

  /** A session event: a board's snapshot, or the fate of a message sent from here. */
  event(e: SessionEvent): void {
    if (e.kind === 'findings' && e.data?.board && e.data.snapshot) {
      this.snapshots.set(key(e.data.board, e.data.target), e.data.snapshot)
      this.latest = e.data.snapshot
    }
    if (e.kind !== 'delivered' || !e.data?.message) return
    const name = this.sent.get(e.data.message)
    if (name === undefined) {
      if (this.early.size > 50) this.early.clear()
      this.early.set(e.data.message, !!e.data.returned)
      return
    }
    this.settle(e.data.message, name, !!e.data.returned)
  }

  private settle(id: string, name: string, returned: boolean): void {
    this.sent.delete(id)
    if (returned) void vscode.window.showWarningMessage(`pcbjs: Returned: ${name} left before reading your message`)
    else vscode.window.setStatusBarMessage(`$(mail-read) pcbjs: Read by ${name}`, 8000)
  }

  /** What the command was invoked on: the preview's chip, rows of a tree, else the active editor's selections. */
  payload(arg?: unknown, many?: unknown): Payload {
    if (isViewer(arg)) return this.located({ refs: [...arg.refs], ranges: [], board: arg.board, target: arg.target })
    if (isNode(arg)) return this.located(treePayload([arg, ...(Array.isArray(many) ? many.filter(n => isNode(n) && n.id !== arg.id) : [])]))
    return this.located(this.editorPayload())
  }

  /** Each editor selection as its range, with the members the language server resolved in them as the session's selection holds them. */
  editorPayload(): Payload {
    const ed = vscode.window.activeTextEditor
    const ranges = ed?.document.uri.scheme === 'file' ? ed.selections.map(s => rangeOf(ed.document.uri.fsPath, s)) : []
    const board = this.deps.board()
    return { refs: [...((board && this.deps.selection(board)) || [])], ranges, ...(board ? { board } : {}) }
  }

  private located(p: Payload): Payload {
    const board = p.board ?? this.deps.board()
    if (!board) return p
    const target = p.target ?? null
    const snapshot = this.snapshots.get(key(board, target)) ?? this.latest
    return { ...p, board, target, ...(snapshot ? { snapshot } : {}) }
  }

  /** The command: choose the agent, ask for the comment, send. The message id, or undefined when cancelled. */
  async run(arg?: unknown, many?: unknown): Promise<string | undefined> {
    const payload = this.payload(arg, many)
    let agents: ClientInfo[]
    try {
      agents = await this.refresh()
    } catch {
      agents = []
    }
    if (!agents.length) {
      void vscode.window.showWarningMessage('pcbjs: no agent is attached to the session. Start one with `pcbjs mcp` configured, see pcbjs docs mcp.')
      return undefined
    }
    const agent = await pickAgent(agents, this.deps.memory.get(), this.deps.now?.() ?? Date.now())
    if (!agent) return undefined
    this.deps.memory.set({ client: agent.client, name: agent.name })
    return this.tell(agent, `Send to ${agent.name}`, payload)
  }

  /** Ask for the comment and send it with the payload to one agent; Stop and tell and Reply come here too. */
  async tell(agent: { client: string; name: string }, title: string, payload: Payload): Promise<string | undefined> {
    const comment = await vscode.window.showInputBox({ title, placeHolder: PLACEHOLDER })
    if (comment === undefined) return undefined
    try {
      // before the first findings event, the snapshot the session answers queries from
      if (payload.board && !payload.snapshot) this.latest ??= (await this.deps.request('session/boards', {}).catch(() => null))?.snapshot
      const snapshot = payload.snapshot ?? this.latest
      const r = await this.deps.request('session/send', { to: agent.client, comment, ...payload, ...(snapshot ? { snapshot } : {}) })
      this.sent.set(r.id, agent.name)
      vscode.window.setStatusBarMessage(`$(mail) pcbjs: Sent to ${agent.name}`, 8000)
      const early = this.early.get(r.id)
      if (early !== undefined) {
        this.early.delete(r.id)
        this.settle(r.id, agent.name, early)
      }
      return r.id
    } catch (err) {
      void vscode.window.showErrorMessage(`pcbjs: cannot send to ${agent.name}: ${(err as Error).message}`)
      return undefined
    }
  }
}
