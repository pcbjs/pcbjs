// Board discovery and icon precedence; user settings and undo are covered by auto-icons.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const m = require('../dist/icon-map.cjs')

test('entries: the literals of the config list, comments ignored, globs kept', () => {
  const src = `export default defineConfig({\n  // entries: ['old.tsx'],\n  entries: ['blinky.pcb.tsx', "boards/*.tsx"], // the boards\n})`
  assert.deepEqual(m.configEntries(src), ['blinky.pcb.tsx', 'boards/*.tsx'])
  assert.deepEqual(m.configEntries('export default {}'), [])
  assert.ok(m.isGlob('boards/*.tsx') && !m.isGlob('pcb.tsx'))
})

test('fixed: config names, the entry and schematic suffixes, lib/ before them, the fab folder', () => {
  const a = m.fixedAssociations()
  assert.equal(a.fileNames['pcb.config.ts'], 'config')
  assert.equal(a.fileNames['pcbjs.config.mjs'], undefined)
  assert.equal(a.fileNames['pcb.tsx'], 'entry')
  assert.deepEqual(Object.entries(a.fileExtensions), [
    ['lib/ts', 'footprint'],
    ['lib/tsx', 'footprint'],
    ['pcb.tsx', 'entry'],
    ['sch.ts', 'schematic'],
    ['sch.tsx', 'schematic'],
  ])
  assert.deepEqual(a.folderNames, { '.pcbjs/fab': 'fab' })
})

test('found: by folder and name; an entry wins over a footprint, a config or schematic keeps its own icon', () => {
  const a = m.foundAssociations({
    entries: ['/p/main.tsx', '/p/lib/board.tsx', '/p/top.sch.tsx'],
    footprints: ['/p/lib/MyPart.tsx', '/p/lib/board.tsx'],
    fabDirs: ['/p/.pcbjs/fab/Blinky'],
    zips: ['/p/.pcbjs/fab/Blinky/Blinky-fab-0.1.0.zip'],
  })
  assert.deepEqual(a.fileNames, { 'lib/MyPart.tsx': 'footprint', 'lib/board.tsx': 'entry', 'p/main.tsx': 'entry', 'Blinky/Blinky-fab-0.1.0.zip': 'fab' })
  assert.deepEqual(a.folderNames, { 'fab/Blinky': 'fab' })
})
