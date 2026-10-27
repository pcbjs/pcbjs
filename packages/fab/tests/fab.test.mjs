// @pcbjs/fab on its own: every preset module loads, carries its spec and makes a <board> with the preset stackup and rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNode } from '@pcbjs/core'
import { FABS, bindPCB, isBoundPCB, paletteName } from '../dist/index.js'

test('fab: every preset in FABS is a bound <PCB> named after its path', async () => {
  for (const path of FABS) {
    const PCB = (await import(`../dist/${path}.js`)).default
    assert.ok(isBoundPCB(PCB), path)
    assert.equal(PCB.preset.fab.replace(/\s+/g, ''), path.split('/')[0], path)
    assert.ok(PCB.preset.name.startsWith(PCB.preset.fab + ' ') && PCB.preset.name.includes(path.split('/')[1].split('-')[0] + '-Layer'), PCB.preset.name)
    const node = PCB({ name: 'X' })
    assert.ok(isNode(node) && node.type === 'board', path)
    assert.equal(node.props.rules.clearance, PCB.preset.rules.clearance, path)
  }
})

test('fab: bindPCB recolours the stackup from the palette, any case', () => {
  const Board = bindPCB({ name: 'House 2-Layer', stackup: { layers: [{ type: 'mask', side: 'F', color: 'Green' }] }, rules: { clearance: 0.2 }, colors: { 'Matte Black': '#111' } })
  assert.equal(Board.preset.fab, 'House')
  assert.equal(paletteName({ 'Matte Black': '#111' }, 'matte-black'), 'Matte Black')
  const node = Board({ name: 'B', color: 'matte black' })
  assert.equal(node.props.stackup.layers[0].color, 'Matte Black')
})

test('fab: a preset spreads back into bindPCB, and the result type checks', async () => {
  const JLC = (await import('../dist/JLCPCB/2-Layer.js')).default
  const House = bindPCB({ ...JLC.preset, name: 'House 2-Layer', rules: { ...JLC.preset.rules, clearance: 0.2 } })
  assert.deepEqual(House.preset.finishes, JLC.preset.finishes)
  assert.equal(House({ name: 'H', finish: 'ENIG' }).props.rules.clearance, 0.2)
  const ts = (await import('typescript')).default
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const fab = new URL(import.meta.resolve('../dist/index.js')).pathname
  const jlc = new URL(import.meta.resolve('../dist/JLCPCB/2-Layer.js')).pathname
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-fab-'))
  const file = join(dir, 'house.ts')
  writeFileSync(file, [
    `import { bindPCB } from ${JSON.stringify(fab)}`,
    `import JLC, * as M from ${JSON.stringify(jlc)}`,
    `export const A = bindPCB({ ...JLC.preset, name: 'House A' })`,
    `export const B = bindPCB({ name: 'House B', stackup: M.stackup, rules: M.rules, colors: M.colors, finishes: M.finishes, sourcing: M.sourcing })`,
  ].join('\n') + '\n')
  try {
    const program = ts.createProgram([file], { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true, types: [] })
    const diags = ts.getPreEmitDiagnostics(program).filter(d => d.file?.fileName === file)
    assert.deepEqual(diags.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
