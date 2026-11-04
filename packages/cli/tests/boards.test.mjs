import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardsIndex, boardsPayload, entriesReaching, markConflicts, routeEndpoint, slotsFor } from '../dist/project/boards.js'
import { boardUrls } from '../dist/project/project.js'
import { pluginState, virtualModule } from '../dist/server/site.js'
import { CONFIG_NAMES, findConfig, resolveConfig } from '../dist/project/config.js'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const entry = rel => ({ file: `/p/${rel}`, rel })
const fake = (rel, name, status = 'ok') => ({
  entry: entry(rel),
  board: { name, title: name, rev: '1' },
  site: { name, footprints: [], fab: { status } },
})
// a slot's compile: one Compiled per target
const one = (...a) => [fake(...a)]

test('boards: a repeated board name is a conflict naming both files, the first entry keeps it', () => {
  const slots = slotsFor([entry('a.tsx'), entry('b.tsx'), entry('c.tsx')])
  slots[0].compiled = one('a.tsx', 'X')
  slots[1].compiled = one('b.tsx', 'Y')
  slots[2].compiled = one('c.tsx', 'X')
  markConflicts(slots)
  assert.equal(slots[0].conflict, null)
  assert.equal(slots[1].conflict, null)
  assert.match(slots[2].conflict, /"X".*a\.tsx.*c\.tsx/)
  const p = boardsPayload(slots)
  assert.deepEqual(
    p.boards.map(b => b.board),
    ['X', 'Y'],
  )
  assert.equal(p.single, false)
  assert.equal(p.errors['a.tsx'], null)
  assert.match(p.errors['c.tsx'], /used by both/)
  // entries maps each shown board name to the entry path it came from, leaving out the clash
  assert.deepEqual(p.entries, { X: 'a.tsx', Y: 'b.tsx' })
  // a later failed compile keeps the stale clashing board out of the list
  slots[2].error = 'syntax error'
  markConflicts(slots)
  assert.deepEqual(
    boardsPayload(slots).boards.map(b => b.board),
    ['X', 'Y'],
  )
  slots[2].error = null
  // renaming the clash away clears it on the next pass
  slots[2].compiled = one('c.tsx', 'Z')
  markConflicts(slots)
  assert.equal(slots[2].conflict, null)
})

test('boards: boards.json index', () => {
  const idx = boardsIndex([fake('main.tsx', 'Blinky'), fake('coin.tsx', 'Coin', 'incomplete')], false)
  assert.deepEqual(idx, {
    boards: [
      { name: 'Blinky', title: 'Blinky', rev: '1', file: 'boards/Blinky.json', entry: 'main.tsx', status: 'ok' },
      { name: 'Coin', title: 'Coin', rev: '1', file: 'boards/Coin.json', entry: 'coin.tsx', status: 'incomplete' },
    ],
    single: false,
  })
})

test('boards: per-board urls in dev and in the built site', () => {
  assert.deepEqual(boardUrls('Coin', 'Coin-fab-1.zip', true), { fab: '/__pcbjs/Coin/fab/Coin-fab-1.zip', svg: '/__pcbjs/Coin/Coin.pcb.svg' })
  assert.deepEqual(boardUrls('Coin', 'Coin-fab-1.zip', false), { fab: 'fab/Coin/Coin-fab-1.zip', svg: 'fab/Coin/Coin.pcb.svg' })
})

test('boards: a changed file reaches only the entries that import it', () => {
  const node = file => ({ file, importers: new Set() })
  const a = node('/p/a.tsx'),
    b = node('/p/b.tsx'),
    lib = node('/p/lib.tsx'),
    only = node('/p/only.tsx')
  lib.importers.add(a)
  lib.importers.add(b)
  only.importers.add(b)
  a.importers.add(lib) // a cycle must not loop
  const entries = ['/p/a.tsx', '/p/b.tsx']
  assert.deepEqual([...entriesReaching([only], entries)], ['/p/b.tsx'])
  assert.deepEqual([...entriesReaching([lib], entries)].sort(), entries)
  assert.deepEqual([...entriesReaching([a], entries)].sort(), entries)
  assert.equal(entriesReaching(undefined, entries), null)
  assert.equal(entriesReaching(new Set(), entries), null)
})

test('boards: /__pcbjs/ paths start with the board name', () => {
  const names = ['Blinky', 'Coin']
  assert.deepEqual(routeEndpoint('Coin/board.json', names), { name: 'Coin', file: 'board.json' })
  assert.deepEqual(routeEndpoint('Coin/fab/Coin-fab-1.zip', names), { name: 'Coin', file: 'fab/Coin-fab-1.zip' })
  assert.deepEqual(routeEndpoint('Blinky/Blinky.pcb.svg', names), { name: 'Blinky', file: 'Blinky.pcb.svg' })
  assert.equal(routeEndpoint('board.json', names), null)
  assert.equal(routeEndpoint('fab/Blinky-F_Cu.gtl', names), null)
  assert.equal(routeEndpoint('board.json', []), null)
})

test('boards: the virtual module carries each target as its facets', async () => {
  const state = pluginState({ entries: [entry('a.tsx'), entry('b.tsx')] })
  state.slots[0].error = 'boom'
  state.slots[1].compiled = one('b.tsx', 'B')
  const src = virtualModule(state)
  const mod = await import('data:text/javascript,' + encodeURIComponent(src))
  assert.equal(mod.single, false)
  assert.deepEqual(
    mod.boards.map(b => b.board),
    ['B'],
  )
  assert.deepEqual(mod.errors, { 'a.tsx': 'boom', 'b.tsx': null })
  assert.deepEqual(mod.entries, { B: 'b.tsx' })
})

test('config: pcb.config.{ts,mts,js,mjs} in that order, no other name', () => {
  assert.deepEqual(CONFIG_NAMES, ['pcb.config.ts', 'pcb.config.mts', 'pcb.config.js', 'pcb.config.mjs'])
  const having =
    (...names) =>
    f =>
      names.some(n => f === join('/p', n))
  assert.equal(findConfig('/p', having()), null)
  assert.equal(findConfig('/p', having('pcb.config.mjs', 'pcb.config.mts')), join('/p', 'pcb.config.mts'))
  assert.equal(findConfig('/p', having('pcbjs.config.js')), null)
})

test('config: pcb.config.mjs loads silently and reloads', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pcbjs-config-'))
  const warn = console.warn,
    lines = []
  console.warn = (...a) => lines.push(a.join(' '))
  try {
    writeFileSync(join(root, 'main.tsx'), 'export default null\n')
    writeFileSync(join(root, 'pcb.config.mjs'), "export default { base: '/b/' }\n")
    let cfg = await resolveConfig(['main.tsx'], 'build', undefined, root)
    assert.equal(cfg.configFile, join(root, 'pcb.config.mjs'))
    assert.equal(cfg.base, '/b/')
    writeFileSync(join(root, 'pcb.config.mjs'), "export default { base: '/new/' }\n")
    cfg = await resolveConfig(['main.tsx'], 'build', undefined, root)
    assert.equal(cfg.base, '/new/')
    assert.deepEqual(lines, [])
  } finally {
    console.warn = warn
    rmSync(root, { recursive: true, force: true })
  }
})
