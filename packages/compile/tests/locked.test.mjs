import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, rmSync } from 'node:fs'
import { transform } from 'esbuild'
import PCB, { h, defineFootprint, Schematic, resetDefaults } from '@pcbjs/core'
import { compileBoard } from '../dist/index.js'
import { siteData } from '@pcbjs/export'

afterEach(resetDefaults)
const Two = defineFootprint(p => h('footprint', p, h('pad', { num: 1, size: 1 }), h('pad', { num: 2, at: '2 0', size: 1 })), { pins: ['1', '2'], prefix: 'R' })
const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 })
const compile = (drawing, children) => compileBoard(h(PCB, { name: 'Locks', silkRefs: false, schematic: { drawing } }, edge(), children), { cache: false })

test('JSX shorthand and boolean expressions lock PCB and schematic placements independently', async () => {
  const file = new URL(`.locked-fixture-${process.pid}.mjs`, import.meta.url)
  const source = `import PCB, { defineFootprint, Schematic } from '@pcbjs/core';
    const Pad = defineFootprint(p => <footprint {...p}><pad num={1} size={1}/><pad num={2} at="2 0" size={1}/></footprint>, {pins:['1','2'],prefix:'R'});
    const R1=Pad('',{ref:'R1'}),R2=Pad('',{ref:'R2'}),R3=Pad('',{ref:'R3'});
    export const board = enabled => <PCB name="Locks" silkRefs={false} schematic={{drawing:<Schematic><R1 locked={false}/><R2 at="10 10" locked/><R3 at="15 10" locked={enabled}/></Schematic>}}>
      <rect layer="Edge.Cuts" x={0} y={0} w={30} h={20}/><g name="G"><R1 at="5 5" locked/><R2 at="10 5" locked={false}/></g><R3 at="15 5" locked={enabled}/>
    </PCB>;`
  try {
    writeFileSync(file, (await transform(source, { loader: 'tsx', format: 'esm', jsx: 'automatic', jsxImportSource: '@pcbjs/core' })).code)
    const { board } = await import(file.href)
    for (const enabled of [true, false, true]) {
      const b = compileBoard(board(enabled), { cache: false })
      const fps = b.footprints.map(p => !!p.locked)
      assert.deepEqual(fps, [true, false, enabled])
      const symbols = new Map(b.schematic.drawing.symbols.map(s => [s.ref, s]))
      assert.equal(!!symbols.get('R1').locked, false)
      assert.equal(symbols.get('R1').auto, true, 'locked-only symbol declarations retain auto placement')
      assert.equal(symbols.get('R2').locked, true)
      assert.equal(!!symbols.get('R3').locked, enabled)
      assert.equal(b.edit.find(n => n.ref === 'G').locked, true, 'a group cannot bypass a locked child')
      assert.equal(b.edit.find(n => n.ref === 'R1').locked, true)
      const data = siteData(b, {})
      assert.deepEqual(
        data.footprints.map(p => !!p.locked),
        fps,
      )
      assert.equal(data.edit.find(n => n.ref === 'R1').locked, true)
      assert.equal(data.schematic.drawing.symbols.find(s => s.ref === 'R2').locked, true)
    }
  } finally {
    rmSync(file, { force: true })
  }
})

test('locked accepts booleans, not strings or other truthy values', () => {
  for (const locked of ['true', 'false', 1, null, {}]) {
    const R1 = Two('', { ref: 'R1' })
    assert.throws(() => compile(null, [h(R1, { at: '5 5', locked })]), /locked must be true or false/)
    assert.throws(() => compile(h(Schematic, {}, h(R1, { at: '5 5', locked })), [h(R1, { at: '5 5' })]), /locked must be true or false/)
  }
})
