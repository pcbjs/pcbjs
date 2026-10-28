// The board importer's fidelity, on a small synthetic KiCad board and its schematic: tracks keep their widths, equal footprint
// copies make one module with BOM and placement flags on the parts, the schematic's part numbers reach pcb.sourcing.ts and its
// DNP the parts, remove_unused_layers and paste windows reach the pads, filled silk is written before what lies inside it,
// and model paths follow the one path rule.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { nets } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { importBoard, readSchematicFields, graphicSpecs, readKicadPcb, kicadFootprint, setKicadConfig } from '../dist/index.js'
import { syntheticKicad } from './helpers.mjs'

const top = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-kicad-import-')))
let res
before(() => {
  const { pcb, sch } = syntheticKicad()
  writeFileSync(join(top, 'synth.kicad_pcb'), pcb)
  writeFileSync(join(top, 'synth.kicad_sch'), sch)
  res = importBoard(join(top, 'synth.kicad_pcb'), { outDir: join(top, 'out') })
})
after(() => {
  rmSync(top, { recursive: true, force: true })
  setKicadConfig(process.cwd(), undefined)
})
const file = name => {
  const f = res.files.get(name)
  assert.ok(f, `${name} is written`)
  return f
}

test('import: every route chain keeps its width up to the pads, neck AS_DRAWN', () => {
  const copper = file('pcb.copper.tsx')
  assert.match(copper, /const AS_DRAWN = \{ length: 0 \}/)
  const chains = copper.split('\n').filter(l => /^\s*route\(/.test(l))
  assert.ok(chains.length >= 3)
  for (const c of chains) assert.match(c, /\.width\([\d.]+\)\.neck\(AS_DRAWN\)/, c)
})

test('import: copies differing in element order, outline start, BOM flag and courtyard make one module, the flag on the part', () => {
  assert.deepEqual([...res.files.keys()].filter(k => k.startsWith('lib/')).sort(), ['lib/Hdr_Test.tsx', 'lib/LED_Test.tsx', 'lib/R_Test.tsx'])
  const lib = file('lib/R_Test.tsx')
  assert.doesNotMatch(lib, /bom=|pos=/, 'the footprint carries no BOM or placement flag')
  // the tighter of the two courtyards
  assert.match(lib, /layer="F\.CrtYd" x=\{-1\.6\}/)
  const sch = file('pcb.sch.ts')
  assert.match(sch, /export const R1 = R_Test\('10k'\)\.connect/)
  assert.match(sch, /export const R2 = R_Test\(\{ value: '10k', bom: false \}\)\.connect/)
})

test('import: the schematic gives part numbers in pcb.sourcing.ts, equal ones in one call, and DNP on the part', () => {
  const sym = readSchematicFields(join(top, 'synth.kicad_sch'))
  assert.deepEqual([...sym.keys()].sort(), ['D1', 'J1', 'R1', 'R2'], 'power symbols and library symbols are no parts')
  assert.equal(sym.get('D1').dnp, true)
  const src = file('pcb.sourcing.ts')
  assert.match(src, /import \{ source \} from '@pcbjs\/core'/)
  assert.match(src, /source\(\[R1, R2\], \{ MPN: 'RC0603FR-0710KL', Manufacturer: 'Yageo', 'MPN:LCSC': 'C98220' \}\)/)
  assert.match(src, /source\(J1, \{ MPN: 'PZ254V-11-03P', Assembly: 'hand' \}\)/)
  assert.match(file('pcb.tsx'), /import '\.\/pcb\.sourcing'/)
  assert.match(file('pcb.sch.ts'), /export const D1 = LED_Test\(\{ value: 'LED', dnp: true \}\)/)
  assert.doesNotMatch(file('pcb.sch.ts'), /source:/)
  const none = importBoard(join(top, 'synth.kicad_pcb'), { schematic: false })
  assert.equal(none.files.has('pcb.sourcing.ts'), false, 'without the schematic the board has no fields to carry')
})

test('import: remove_unused_layers keeps a through-hole pad on the outer layers and the layers it connects on', () => {
  const lib = file('lib/Hdr_Test.tsx')
  assert.match(lib, /<pad num="1" [^>]*layers=\{\['F\.Cu', 'In1\.Cu', 'B\.Cu'\]\}/, 'the zone layer of pad 1')
  assert.match(lib, /<pad num="2" [^>]*layers=\{\['F\.Cu', 'In2\.Cu', 'B\.Cu'\]\}/, 'the track layer of pad 2')
  assert.doesNotMatch(
    lib.split('\n').find(l => l.includes('num="3"')),
    /layers=/,
    'pad 3 without the flag keeps every layer',
  )
})

test('import: paste windows, a positive margin and a ratio reach the pads as paste', () => {
  const lib = file('lib/LED_Test.tsx')
  const pad = n => lib.split('\n').find(l => l.includes(`<pad num="${n}"`))
  // the cathode window, 2.1 mm wide at x -0.6, in the frame of the 3.4 mm pad at x -1.2
  assert.match(pad(1), /paste=\{\[\[\[1\.65, 0\.4\], \[-0\.45, 0\.4\], \[-0\.45, -0\.4\], \[1\.65, -0\.4\]\]\]\}/)
  assert.match(pad(2), /paste=\{\[\[\[-0\.3, 0\.4\], \[-0\.9, 0\.4\], \[-0\.9, -0\.4\], \[-0\.3, -0\.4\]\]\]\}/)
  assert.match(pad(3), /paste=\{\[\[/, 'a positive margin is a grown window')
  assert.match(pad(4), /pasteShrink=\{0\.04\} pasteRatio=\{-0\.1\}/)
})

test('import: a filled silk shape is written before the items inside it', () => {
  const b = readKicadPcb(join(top, 'synth.kicad_pcb'))
  const specs = graphicSpecs(b.graphics.filter(g => g.layer === 'F.SilkS'))
  assert.deepEqual(
    specs.map(s => s.type),
    ['path', 'circle'],
    'the square around the disc first',
  )
  const art = file('pcb.art.tsx')
  assert.ok(art.indexOf('<path') < art.indexOf('<circle'))
})

test('kicadFootprint: ${KIPRJMOD} is the project root, a model option is relative to the file that gives it', async () => {
  const proj = join(top, 'proj'),
    lib = join(proj, 'lib', 'footprints', 'Mine.pretty')
  mkdirSync(lib, { recursive: true })
  mkdirSync(join(proj, 'models'), { recursive: true })
  writeFileSync(join(proj, 'models', 'part.step'), 'ISO-10303-21;\n')
  writeFileSync(
    join(lib, 'Part.kicad_mod'),
    `(footprint "Part" (version 20240108) (attr smd)
  (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask"))
  (model "\${KIPRJMOD}/models/part.step" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0))))\n`,
  )
  setKicadConfig(proj, { footprints: ['lib/footprints'] })
  const place = F => {
    const { A } = nets()
    const U = F('x').connect({ 1: A })
    return compileBoard(h(PCB, { name: 'M' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 10, h: 10 }), h(U, { at: '5 5' })))
  }
  const own = place(kicadFootprint('Mine:Part')).footprints[0].model
  assert.equal(own.path ?? own.step, join(proj, 'models', 'part.step'), 'not lib/footprints/models')
  // the factory made in one module and placed from another: its model is relative to the module that made it
  writeFileSync(
    join(proj, 'footprints.mjs'),
    `import { kicadFootprint } from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)}\nexport const Part = kicadFootprint('Mine:Part', { model: { file: './models/part.step' } })\n`,
  )
  const { Part } = await import(pathToFileURL(join(proj, 'footprints.mjs')).href)
  const given = place(Part).footprints[0].model
  assert.equal(given.path ?? given.step, join(proj, 'models', 'part.step'), 'relative to footprints.mjs, not to this test file')
})
