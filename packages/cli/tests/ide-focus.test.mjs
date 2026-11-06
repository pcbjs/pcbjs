// The server side of IDE mode: which board an editor focus points at, through an injected module graph, and the board list
// an editor host gets.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { focusTarget, ideBoards, markConflicts, slotsFor } from '../dist/project/boards.js'

const entry = rel => ({ file: `/p/${rel}`, rel })
const target = (rel, name, variant, status = 'ok') => ({
  entry: entry(rel),
  board: { name, title: `${name} board`, rev: '1', ...(variant ? { variant: { name: variant } } : {}) },
  site: { name, footprints: [], fab: { status } },
})

/** A module graph as Vite's moduleGraph answers it: modules by file, each with the modules that import it. */
function graph(edges) {
  const nodes = new Map()
  const node = file => nodes.get(file) ?? (nodes.set(file, { file, importers: new Set() }), nodes.get(file))
  for (const [from, to] of edges) node(`/p/${to}`).importers.add(node(`/p/${from}`))
  return { getModulesByFile: file => (nodes.has(file) ? new Set([nodes.get(file)]) : undefined) }
}

// main.tsx imports lib/MyGroup.tsx, which imports lib/MyPart.tsx; coin.tsx and multi.tsx import lib/MyPart.tsx; multi.tsx also imports lib/shared.ts
const g = graph([
  ['main.tsx', 'lib/MyGroup.tsx'],
  ['lib/MyGroup.tsx', 'lib/MyPart.tsx'],
  ['coin.tsx', 'lib/MyPart.tsx'],
  ['multi.tsx', 'lib/MyPart.tsx'],
  ['multi.tsx', 'lib/shared.ts'],
  ['quad.pcb.tsx', 'pcb.config.ts'],
  ['main.tsx', 'pcb.config.ts'],
])

function demoSlots() {
  const slots = slotsFor(['main.tsx', 'coin.tsx', 'quad.pcb.tsx', 'multi.tsx'].map(entry))
  slots[0].compiled = [target('main.tsx', 'Blinky')]
  slots[1].compiled = [target('coin.tsx', 'Coin')]
  slots[2].compiled = [target('quad.pcb.tsx', 'Quad', null, 'incomplete')]
  slots[3].compiled = ['House', 'JLCPCB', 'OSH Park'].map(v => target('multi.tsx', 'Multi', v))
  markConflicts(slots)
  return slots
}

// the four rules, with the board the viewer shows
test("focus rule 1: a file in exactly one board's tree goes to that board, whatever the viewer shows", () => {
  for (const cur of [null, 'Blinky', 'Coin', 'Quad', 'Multi', 'preview:scratch.tsx']) {
    assert.deepEqual(focusTarget(g, demoSlots(), '/p/lib/MyGroup.tsx', cur), { board: 'Blinky', entry: 'main.tsx', boards: ['Blinky'] })
    assert.deepEqual(focusTarget(g, demoSlots(), '/p/coin.tsx', cur), { board: 'Coin', entry: 'coin.tsx', boards: ['Coin'] })
  }
})

test('focus rule 2: a file shared by several boards keeps the board shown when it is one of them', () => {
  assert.deepEqual(focusTarget(g, demoSlots(), '/p/lib/MyPart.tsx', 'Coin'), { board: 'Coin', entry: 'coin.tsx', boards: ['Blinky', 'Coin', 'Multi'] })
  assert.deepEqual(focusTarget(g, demoSlots(), '/p/lib/MyPart.tsx', 'Multi'), { board: 'Multi', entry: 'multi.tsx', boards: ['Blinky', 'Coin', 'Multi'] })
  assert.deepEqual(focusTarget(g, demoSlots(), '/p/pcb.config.ts', 'Quad'), { board: 'Quad', entry: 'quad.pcb.tsx', boards: ['Blinky', 'Quad'] })
})

test('focus rule 4: a file in no tree gives no board and no entry, the cue for the isolated preview', () => {
  assert.deepEqual(focusTarget(g, demoSlots(), '/p/scratch.tsx', 'Coin'), { board: null, entry: null, boards: [] })
  // a file only a failed entry reaches is in a tree: entry set, no board, and no preview
  const slots = demoSlots()
  slots[0].compiled = null
  slots[0].error = 'boom'
  assert.deepEqual(focusTarget(g, slots, '/p/lib/MyGroup.tsx', 'Coin'), { board: null, entry: 'main.tsx', boards: [] })
})

test('ide boards: one per entry with a board, target names, and ok, incomplete or error', () => {
  const slots = demoSlots()
  slots[1].error = 'SyntaxError' // Coin failed this time and shows its last good board
  slots[3].compiled[2] = target('multi.tsx', 'Multi', 'OSH Park', 'incomplete')
  const p = ideBoards(slots)
  assert.deepEqual(p.boards, [
    { name: 'Blinky', title: 'Blinky board', entry: 'main.tsx', targets: [], status: 'ok' },
    { name: 'Coin', title: 'Coin board', entry: 'coin.tsx', targets: [], status: 'error' },
    { name: 'Quad', title: 'Quad board', entry: 'quad.pcb.tsx', targets: [], status: 'incomplete' },
    { name: 'Multi', title: 'Multi board', entry: 'multi.tsx', targets: ['House', 'JLCPCB', 'OSH Park'], status: 'incomplete' },
  ])
  assert.equal(p.single, false)
  assert.deepEqual(p.errors, { 'main.tsx': null, 'coin.tsx': 'SyntaxError', 'quad.pcb.tsx': null, 'multi.tsx': null })
  // an entry that never compiled is only in errors
  slots[0].compiled = null
  slots[0].error = 'boom'
  assert.deepEqual(
    ideBoards(slots).boards.map(b => b.name),
    ['Coin', 'Quad', 'Multi'],
  )
  assert.equal(ideBoards(slots).errors['main.tsx'], 'boom')
})
