// The Agent activity view and the Worktrees node from session data alone: events update an agent's files, task and findings delta;
// the porcelain of git worktree list parses; a sidebar shows both.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import './vscode.mjs'

const require = createRequire(import.meta.url)
const { Activity, agentNodes, ago } = require('../dist/agents.cjs')
const { parseWorktrees, worktreeStates, worktreeNodes, visibleClients } = require('../dist/worktrees.cjs')
const { Sidebar } = require('../dist/sidebar.cjs')

const P = '/work/p'
const by = { client: 'c4', name: 'Claude Code', role: 'agent' }
let n = 0
const ev = (kind, data, who = null, t = 1000) => ({ id: `s.${++n}`, t, kind, project: P, by: who, data })
const findings = (errors, warnings) => ev('findings', { board: 'Main', target: null, added: [], resolved: [], errors, warnings, unconnected: 0 })

test('the activity view follows the events: plan, progress, files with their time, and the findings delta since the first edit', () => {
  const a = new Activity()
  a.clients([
    { client: 'c1', name: 'vscode-pcbjs', role: 'editor' },
    { client: 'c4', name: 'Claude Code', role: 'agent', root: P },
  ])
  assert.ok(a.event(findings(1, 3)))
  a.event(ev('message', { to: 'editor', from: 'c4', task: 'fix the USB pair', plan: ['move J1'] }, by))
  a.event(ev('edit', { file: 'pcb.tsx', source: 'agent', ranges: [] }, by, 2000))
  a.event(findings(3, 2))
  a.event(ev('message', { to: 'editor', from: 'c4', progress: 'first compile clean, routing D+' }, by))
  const e = ev('edit', { file: 'lib/usb.ts', source: 'disk', ranges: null }, by, 5000)
  a.event(e)
  assert.equal(a.event(e), false, 'an event counts once')
  // an editor's own edit is not an agent's
  a.event(ev('edit', { file: 'pcb.tsx', source: 'editor', ranges: [] }, { client: 'c1', name: 'vscode-pcbjs', role: 'editor' }))
  const [agent] = a.list()
  assert.equal(a.list().length, 1)
  assert.deepEqual(
    agent.files.map(f => [f.file, f.at]),
    [
      ['/work/p/lib/usb.ts', 5000],
      ['/work/p/pcb.tsx', 2000],
    ],
  )
  assert.deepEqual(a.delta(agent), { errors: 2, warnings: -1 })
  const [node] = agentNodes(a, 65000)
  assert.equal(node.label, 'Claude Code')
  assert.equal(node.description, 'fix the USB pair · errors +2, warnings -1')
  assert.deepEqual(
    node.children.map(c => [c.label, c.description]),
    [
      ['first compile clean, routing D+', undefined],
      ['move J1', undefined],
      ['errors +2, warnings -1', 'since its first edit'],
      ['usb.ts', '1 min ago'],
      ['pcb.tsx', '1 min ago'],
    ],
  )
  assert.equal(ago(1000, 13000), '12 s ago')
  // the agent leaves: still listed, no Stop and tell
  a.clients([{ client: 'c1', name: 'vscode-pcbjs', role: 'editor' }])
  const [gone] = agentNodes(a)
  assert.equal(gone.context, undefined)
  assert.match(gone.description, /^left/)
})

test('worktrees: the porcelain parsed, a node per worktree besides the main one, shown after the boards in the Boards view', () => {
  const list = parseWorktrees(
    'worktree /r\nHEAD aaa\nbranch refs/heads/main\n\nworktree /r/.wt/a\nHEAD bbb\nbranch refs/heads/agent/a\n\nworktree /r/.wt/b\nHEAD ccc\ndetached\n\n',
  )
  assert.deepEqual(list, [
    { path: '/r', head: 'aaa', branch: 'main' },
    { path: '/r/.wt/a', head: 'bbb', branch: 'agent/a' },
    { path: '/r/.wt/b', head: 'ccc' },
  ])
  const clients = [{ client: 'c4', name: 'Codex', role: 'agent', root: '/r/.wt/a/board', task: 'place the LEDs' }]
  const scopes = { scopes: [{ root: '/r/.wt/a/board', route: '/board/', boards: [{ name: 'LED' }] }] }
  const states = worktreeStates(list, clients, scopes, new Map([['/r/.wt/a', ['board/pcb.tsx']]]), new Map())
  const [root] = worktreeNodes(states, '/r')
  assert.deepEqual(
    root.children.map(c => [c.label, c.description]),
    [
      ['agent/a', 'attached · Codex · place the LEDs · 1 changed'],
      ['b', 'no agent · 0 changed'],
    ],
  )
  assert.deepEqual(
    root.children[0].children.map(c => [c.label, c.action?.kind]),
    [
      ['LED', 'worktree'],
      ['board/pcb.tsx', 'diff'],
    ],
  )
  assert.equal(worktreeNodes([], '/r').length, 0)
  const sidebar = new Sidebar(async () => undefined, false)
  sidebar.setWorktrees([root])
  sidebar.setAgents([])
  assert.equal(sidebar.providers.boards.nodes.at(-1).id, 'worktrees')
  assert.equal(sidebar.providers.boards.getTreeItem(root.children[0]).contextValue, 'worktree.attached')
  assert.equal(sidebar.providers.boards.getTreeItem(root.children[1]).contextValue, 'worktree')
  // the Agents view: an agent of the main tree, and one of a worktree only while it is attached
  const both = [{ client: 'c1', name: 'Claude Code', role: 'agent', root: '/r/board' }, ...clients, { client: 'c5', name: 'Cursor', role: 'agent', root: '/r/.wt/b' }]
  assert.deepEqual(
    visibleClients(both, list, '/r', scopes).map(c => c.client),
    ['c1', 'c4'],
  )
  assert.deepEqual(
    visibleClients(both, list, '/r', { scopes: [] }).map(c => c.client),
    ['c1'],
  )
})
