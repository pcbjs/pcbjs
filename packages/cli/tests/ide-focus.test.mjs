// The server side of IDE mode: which board an editor focus points at, through an injected module graph, and the board list
// an editor host gets.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardsPayload, focusTarget, ideBoards, markConflicts, slotsFor } from '../dist/boards.js'
import { isPreviewName, previewDir, previewName, previewRoute } from '../dist/preview.js'
import { pluginState, previewable, virtualModule } from '../dist/plugin.js'
import { buildPayload } from '../dist/build.js'

const entry = rel => ({ file: `/p/${rel}`, rel })
const target = (rel, name, variant, status = 'ok') => ({
  entry: entry(rel),
  board: { name, title: `${name} board`, revision: '1', ...(variant ? { variant: { name: variant } } : {}) },
  site: { name, fab: { status } },
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

test('focus: an entry file points at its own board', () => {
  assert.deepEqual(focusTarget(g, demoSlots(), '/p/coin.tsx'), { board: 'Coin', entry: 'coin.tsx', boards: ['Coin'] })
})

test('focus: a library file points at the first board in entry order that imports it, and lists the others', () => {
  assert.deepEqual(focusTarget(g, demoSlots(), '/p/lib/MyGroup.tsx'), { board: 'Blinky', entry: 'main.tsx', boards: ['Blinky'] })
  assert.deepEqual(focusTarget(g, demoSlots(), '/p/lib/MyPart.tsx'), { board: 'Blinky', entry: 'main.tsx', boards: ['Blinky', 'Coin', 'Multi'] })
  assert.deepEqual(focusTarget(g, demoSlots(), '/p/lib/shared.ts'), { board: 'Multi', entry: 'multi.tsx', boards: ['Multi'] })
  assert.deepEqual(focusTarget(g, demoSlots(), '/p/pcb.config.ts'), { board: 'Blinky', entry: 'main.tsx', boards: ['Blinky', 'Quad'] })
})

test('focus: a file outside every graph, or no graph yet, points at nothing, except an entry, which always reaches its board', () => {
  assert.deepEqual(focusTarget(g, demoSlots(), '/p/README.md'), { board: null, entry: null, boards: [] })
  assert.deepEqual(focusTarget(undefined, demoSlots(), '/p/lib/MyPart.tsx'), { board: null, entry: null, boards: [] })
  assert.deepEqual(focusTarget(undefined, demoSlots(), '/p/coin.tsx'), { board: 'Coin', entry: 'coin.tsx', boards: ['Coin'] })
})

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

test('focus rule 3: a shared file the board shown does not use goes to the first sharing board in entry order', () => {
  assert.deepEqual(focusTarget(g, demoSlots(), '/p/lib/MyPart.tsx', 'Quad'), { board: 'Blinky', entry: 'main.tsx', boards: ['Blinky', 'Coin', 'Multi'] })
  assert.deepEqual(focusTarget(g, demoSlots(), '/p/lib/MyPart.tsx', null), { board: 'Blinky', entry: 'main.tsx', boards: ['Blinky', 'Coin', 'Multi'] })
  assert.deepEqual(focusTarget(g, demoSlots(), '/p/lib/MyPart.tsx', 'preview:scratch.tsx'), { board: 'Blinky', entry: 'main.tsx', boards: ['Blinky', 'Coin', 'Multi'] })
})

test('focus rule 4: a file in no tree gives no board and no entry, the cue for the isolated preview', () => {
  assert.deepEqual(focusTarget(g, demoSlots(), '/p/scratch.tsx', 'Coin'), { board: null, entry: null, boards: [] })
  // a file only a failed entry reaches is in a tree: entry set, no board, and no preview
  const slots = demoSlots()
  slots[0].compiled = null
  slots[0].error = 'boom'
  assert.deepEqual(focusTarget(g, slots, '/p/lib/MyGroup.tsx', 'Coin'), { board: null, entry: 'main.tsx', boards: [] })
})

test('focus: an entry without a board of its own gives the entry but no board, a later live one gives the board', () => {
  const slots = demoSlots()
  slots[0].compiled = null
  slots[0].error = 'boom'
  assert.deepEqual(focusTarget(g, slots, '/p/lib/MyGroup.tsx'), { board: null, entry: 'main.tsx', boards: [] })
  assert.deepEqual(focusTarget(g, slots, '/p/lib/MyPart.tsx'), { board: 'Coin', entry: 'coin.tsx', boards: ['Coin', 'Multi'] })
  // a board whose name another entry took is not live either
  slots[1].compiled = [target('coin.tsx', 'Multi')]
  slots[3].compiled = [target('multi.tsx', 'Multi')]
  markConflicts(slots)
  assert.deepEqual(focusTarget(g, slots, '/p/lib/MyPart.tsx'), { board: 'Multi', entry: 'coin.tsx', boards: ['Multi'] })
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

test('transient: the preview of a file is named preview:<rel> and served under /__pcbjs/preview/<encoded rel>/', () => {
  assert.equal(previewName('lib/scratch.tsx'), 'preview:lib/scratch.tsx')
  assert.ok(isPreviewName('preview:lib/scratch.tsx'))
  assert.ok(!isPreviewName('Blinky'))
  assert.equal(previewDir('lib/scratch.tsx'), '/__pcbjs/preview/lib%2Fscratch.tsx')
  assert.deepEqual(previewRoute('preview/lib%2Fscratch.tsx/board.json'), { rel: 'lib/scratch.tsx', file: 'board.json' })
  assert.deepEqual(previewRoute('preview/lib%2Fscratch.tsx/fab/Preview-fab.zip'), { rel: 'lib/scratch.tsx', file: 'fab/Preview-fab.zip' })
  assert.equal(previewRoute('Blinky/board.json'), null)
  // only design modules under the root
  assert.ok(previewable('/p', '/p/scratch.tsx'))
  assert.ok(previewable('/p', '/p/lib/x.mts'))
  assert.ok(!previewable('/p', '/p/README.md'))
  assert.ok(!previewable('/p', '/p/types.d.ts'))
  assert.ok(!previewable('/p', '/p/node_modules/x/index.js'))
  assert.ok(!previewable('/p', '/p/.pcbjs/cache/x.js'))
  assert.ok(!previewable('/p', '/q/scratch.tsx'))
})

test('transient: dev carries the preview last, flagged transient, and the build and the editor host never see it', () => {
  const slots = demoSlots()
  const preview = target('scratch.tsx', 'preview:scratch.tsx')
  const dev = boardsPayload(slots, preview)
  assert.deepEqual(
    dev.boards.map(b => b.name),
    ['Blinky', 'Coin', 'Quad', 'Multi', 'Multi', 'Multi', 'preview:scratch.tsx'],
  )
  assert.equal(dev.boards.at(-1).transient, true)
  assert.equal(dev.entries['preview:scratch.tsx'], undefined)
  assert.equal(dev.errors['scratch.tsx'], undefined)
  // the virtual module of dev has it, the build's payload does not, even with a preview left in the state
  const state = pluginState({ entries: slots.map(s => s.entry) })
  state.slots = slots
  state.preview = { file: '/p/scratch.tsx', rel: 'scratch.tsx', kind: 'board', compiled: preview }
  assert.match(virtualModule(state), /preview:scratch\.tsx/)
  const built = buildPayload(state)
  assert.ok(built.boards.every(b => !b.transient && !b.name.startsWith('preview:')))
  assert.equal(built.boards.length, 6)
  state.inline = false
  assert.doesNotMatch(virtualModule(state), /preview:/)
  assert.ok(ideBoards(slots).boards.every(b => !b.name.startsWith('preview:')))
})
