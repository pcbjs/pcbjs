import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import './vscode.mjs'
const require = createRequire(import.meta.url)
const { FabPanel } = require('../dist/fab-panel.cjs')
const { fabFindingAction } = require('../dist/fab.cjs')
const { actionOwner, actionPage } = require('../dist/tree-data.cjs')

test('retained fabrication finding keeps root, session and divergent target after focus changes, and stale owner is rejected', async () => {
  const a = { session: 'A', open: true, roots: ['/a'] }
  const b = { session: 'B', open: true, roots: ['/b'] }
  let focused = a
  const delivered = []
  const panel = new FabPanel({
    projects: () => ['/a'],
    connected: (root, session) => !!actionOwner({ ...blocker, session, project: root }, [a, b]),
    openFinding: async (action, origin) => {
      const row = fabFindingAction(action, origin)
      const link = actionOwner(row, [a, b], focused)
      if (link) delivered.push([link.session, row.id, row.target, row.source.file])
    },
  })
  const card = { root: '/a', session: 'A', target: 'second' }
  const blocker = { kind: 'finding', board: 'same', id: 'same', target: 'second', file: '/a/pcb.tsx' }
  focused = b
  await panel.act(card, blocker)
  assert.deepEqual(delivered, [['A', 'same', 'second', '/a/pcb.tsx']])
  a.open = false
  await panel.act(card, blocker)
  assert.equal(delivered.length, 1)
  assert.match(panel.problems[0], /disconnected session.*Reopen Fabrication/)
  assert.equal(actionOwner({ ...blocker, session: 'A', project: '/a' }, [b], b), undefined)
  assert.equal(actionOwner({ ...blocker, project: '/a' }, [b], b), undefined)
})


test('duplicate board IDs within one session resolve the captured project route, never the currently shown scope', () => {
  const link = { root: '/workspace', scopes: { scopes: [{ root: '/a', route: '/a/' }, { root: '/b', route: '/b/' }] } }
  assert.equal(actionPage('/a', 'Same', link), '/a/board/Same')
  assert.equal(actionPage('/b', 'Same', link), '/b/board/Same')
  assert.equal(actionPage('/gone', 'Same', link), undefined)
})

test('fabrication uses the exact checked session identity even when checking starts a detached session', async () => {
  const panel = new FabPanel({
    projects: () => ['/a'], origin: () => undefined,
    check: async () => ({ session: 'started-A', report: { boards: [{ name: 'Same', target: null, findings: [], counts: null }], diagnostics: [] }, sets: [{ name: 'Same', target: null, rev: '1', entry: '/a/pcb.tsx', dir: '/a/out', zip: null, files: [] }] }),
    repo: async () => null,
    read: () => ({ zip: null, size: 0, sha256: null, mtime: 0, date: null, rev: null, stale: null, selfCheck: null }),
  })
  await panel.refresh()
  assert.equal(panel.cards[0].session, 'started-A')
})
