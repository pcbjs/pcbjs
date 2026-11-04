// The Worktrees node of the Boards view without vscode: each worktree of the repository with the agent working in it, its boards and
// its files changed against the main tree, read through the git CLI.

import { execFile } from 'node:child_process'
import * as path from 'node:path'
import type { ClientInfo, Method, Params, Result, ScopesMsg } from '@pcbjs/core/protocol'
import { isUnder, samePath } from './protocol'
import type { Node } from './tree-data'

export interface Worktree {
  path: string
  head: string
  /** the short branch name, absent when detached */
  branch?: string
}

/** `git worktree list --porcelain`, the main tree first. */
export function parseWorktrees(text: string): Worktree[] {
  const out: Worktree[] = []
  for (const block of text.split(/\n\s*\n/)) {
    const w: Partial<Worktree> & { bare?: boolean } = {}
    for (const line of block.split('\n')) {
      const [key, ...rest] = line.split(' ')
      const v = rest.join(' ')
      if (key === 'worktree') w.path = path.resolve(v)
      else if (key === 'HEAD') w.head = v
      else if (key === 'branch') w.branch = v.replace(/^refs\/heads\//, '')
      else if (key === 'bare') w.bare = true
    }
    if (w.path && w.head && !w.bare) out.push({ path: w.path, head: w.head, ...(w.branch ? { branch: w.branch } : {}) })
  }
  return out
}

export type Git = (cwd: string, args: string[], input?: string) => Promise<string>

export const git: Git = (cwd, args, input) =>
  new Promise((ok, fail) => {
    const child = execFile('git', args, { cwd, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
      err ? fail(new Error(String(stderr || err.message).trim())) : ok(stdout),
    )
    child.stdin?.end(input)
  })

export interface WorktreeState extends Worktree {
  /** the agents connected from inside it */
  agents: ClientInfo[]
  /** an agent was seen here and none is now */
  left?: string
  /** root-relative, changed against the main tree's HEAD, untracked ones too */
  changed: string[]
  /** the projects of the session inside it, each with its route and boards */
  scopes: { root: string; route?: string; boards: string[] }[]
  /** Open board attached it to the window's session */
  attached: boolean
}

/** The worktrees of the repository holding `dir`, the main tree first; empty outside one. */
export async function listWorktrees(dir: string, run: Git = git): Promise<Worktree[]> {
  try {
    return parseWorktrees(await run(dir, ['worktree', 'list', '--porcelain']))
  } catch {
    return []
  }
}

/** The files a worktree changed against the commit the main tree is on. */
export async function changedFiles(w: Worktree, main: Worktree, run: Git = git): Promise<string[]> {
  try {
    const [diff, untracked] = await Promise.all([run(w.path, ['diff', '--name-only', main.head]), run(w.path, ['ls-files', '--others', '--exclude-standard'])])
    return [...new Set([...diff.split('\n'), ...untracked.split('\n')].map(l => l.trim()).filter(Boolean))].sort()
  } catch {
    return []
  }
}

const within = (root: string, p: string | undefined) => !!p && (samePath(root, p) || isUnder(root, p))

/** The worktree holding `p`, the deepest when one lies inside another. */
export function treeOf(list: Worktree[], p: string | undefined): Worktree | undefined {
  let best: Worktree | undefined
  for (const w of list) if (within(w.path, p) && (!best || w.path.length > best.path.length)) best = w
  return best
}

/** The project folders of `dirs` that belong to the checkout of `folder`: none under `.claude`, in a git-ignored folder or in another worktree. */
export async function ownProjects(folder: string, dirs: string[], run: Git = git): Promise<string[]> {
  const list = await listWorktrees(folder, run)
  const ours = treeOf(list, folder)
  const kept = dirs.filter(d => !path.relative(folder, d).split(/[\\/]/).includes('.claude') && treeOf(list, d) === ours)
  if (!ours || !kept.length) return kept
  let ignored: string[] = []
  try {
    ignored = (await run(ours.path, ['check-ignore', '--stdin', '-z'], kept.join('\0') + '\0')).split('\0').filter(Boolean)
  } catch {}
  return kept.filter(d => !ignored.some(i => samePath(i, d)))
}

/** What the node shows of each worktree besides the main one. */
export function worktreeStates(list: Worktree[], clients: ClientInfo[], scopes: ScopesMsg | undefined, changed: Map<string, string[]>, seen: Map<string, string>): WorktreeState[] {
  return list.slice(1).map(w => {
    const agents = clients.filter(c => c.role === 'agent' && within(w.path, c.root))
    if (agents.length) seen.set(w.path, agents[0].name)
    const own = (scopes?.scopes ?? []).filter(s => within(w.path, s.root))
    return {
      ...w,
      agents,
      ...(!agents.length && seen.has(w.path) ? { left: seen.get(w.path) } : {}),
      changed: changed.get(w.path) ?? [],
      scopes: own.map(s => ({ root: s.root, route: s.route, boards: (s.boards ?? []).map(b => b.title || b.name) })),
      attached: own.length > 0,
    }
  })
}

interface Requester {
  request<M extends Method>(method: M, params?: Params<M>): Promise<Result<M>>
}

/** Open board on a worktree: that one folder attached to the window's session, unless it is already; true when it was attached now. */
export async function attachWorktree(s: Requester, w: Pick<WorktreeState, 'path' | 'attached'>): Promise<boolean> {
  if (w.attached) return false
  await s.request('session/attach', { folders: [w.path] })
  return true
}

/** Detach on an attached worktree: the session stops serving it; the projects it still serves. */
export async function detachWorktree(s: Requester, w: Pick<WorktreeState, 'path'>): Promise<{ root: string; url: string }[]> {
  const r = await s.request('session/detach', { folders: [w.path] })
  return r?.projects ?? []
}

/** The clients the Agents view lists: an agent inside another worktree only while that worktree is attached. */
export function visibleClients(clients: ClientInfo[], list: Worktree[], here: string, scopes: ScopesMsg | undefined): ClientInfo[] {
  const ours = treeOf(list, here)
  return clients.filter(c => {
    const w = c.role === 'agent' ? treeOf(list, c.root) : undefined
    return !w || w === ours || (scopes?.scopes ?? []).some(s => within(w.path, s.root))
  })
}

/** The line the preview's banner shows for a worktree's board. */
export function bannerOf(w: WorktreeState): string {
  const a = w.agents[0]
  const who = a ? `${a.name}${a.task ? `: ${a.task}` : ''}` : w.left ? `left by ${w.left}` : 'no agent'
  return `Worktree ${w.branch ?? path.basename(w.path)}, ${who}`
}

/** One `Worktrees` node with a child per worktree, its boards and changed files; empty without a second worktree. */
export function worktreeNodes(states: WorktreeState[], main: string): Node[] {
  if (!states.length) return []
  return [
    {
      id: 'worktrees',
      label: 'Worktrees',
      description: `${states.length}`,
      icon: 'git-branch',
      expanded: false,
      children: states.map(w => {
        const a = w.agents[0]
        const id = `worktree:${w.path}`
        return {
          id,
          label: w.branch ?? path.basename(w.path),
          description: [w.attached ? 'attached' : '', a ? a.name : w.left ? `${w.left} left` : 'no agent', a?.task, `${w.changed.length} changed`].filter(Boolean).join(' · '),
          tooltip: `${w.path}\n${bannerOf(w)}`,
          icon: a ? 'hubot' : 'git-branch',
          context: w.attached ? 'worktree.attached' : 'worktree',
          worktree: w.path,
          expanded: false,
          children: [
            ...w.scopes.flatMap(s =>
              s.boards.map(b => ({
                id: `${id}:board:${s.root}:${b}`,
                label: b,
                description: path.relative(w.path, s.root) || undefined,
                icon: 'circuit-board',
                worktree: w.path,
                action: { kind: 'worktree' as const, path: w.path },
              })),
            ),
            ...w.changed.map(f => ({
              id: `${id}:file:${f}`,
              label: f,
              icon: 'diff',
              action: { kind: 'diff' as const, left: path.join(main, f), right: path.join(w.path, f), title: `${f} (main tree ↔ ${w.branch ?? path.basename(w.path)})` },
            })),
          ],
        }
      }),
    },
  ]
}
