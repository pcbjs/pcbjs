// pcbjs import: a KiCad board becomes a project that compiles, passes the Gerber self check and writes the Gerbers KiCad
// wrote, compared layer by layer by bounding box and hole by hole; a library footprint becomes a module that compiles.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from '../dist/config.js'
import { pluginState } from '../dist/plugin.js'
import { compileServer, compileSlots } from '../dist/check.js'
import { resetDefaults } from '@pcbjs/core'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const FIX = join(REPO, 'packages', 'kicad', 'tests', 'fixtures')
const { gerberBox, drillHits, syntheticKicad } = await import(join(REPO, 'packages', 'kicad', 'tests', 'helpers.mjs'))

const top = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-import-')))
const env = { ...process.env, KICAD10_FOOTPRINT_DIR: join(FIX, 'footprints') }
before(() => {
  mkdirSync(join(top, 'node_modules'), { recursive: true })
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(top, 'node_modules', '@pcbjs'), 'dir')
})
after(() => rmSync(top, { recursive: true, force: true }))

/** Copy a fixture board into a fresh KiCad folder and import it into a fresh project. */
function importFixture(name, files) {
  const src = join(top, `${name}-kicad`), dst = join(top, name)
  mkdirSync(src, { recursive: true }); mkdirSync(dst, { recursive: true })
  for (const f of files) copyFileSync(join(FIX, 'boards', name, f), join(src, f))
  const out = execFileSync(process.execPath, [BIN, 'import', 'board', join(src, files[0])], { cwd: dst, env, encoding: 'utf8' })
  return { dst, out }
}

/** Compile a project as `pcbjs check --fab` does and return its one board and fab set. */
async function compile(root) {
  resetDefaults()
  const saved = process.env.KICAD10_FOOTPRINT_DIR
  process.env.KICAD10_FOOTPRINT_DIR = env.KICAD10_FOOTPRINT_DIR
  try {
    const cfg = await resolveConfig([], 'build', undefined, root, () => {})
    cfg.fabCheck = true
    const state = pluginState(cfg)
    const server = await compileServer(cfg, state)
    const errors = new Map()
    try { await compileSlots(server, cfg, state.slots, errors) } finally { await server.close() }
    assert.equal(errors.size, 0, [...errors.values()].map(e => e?.message).join('\n'))
    return state.slots[0].compiled[0]
  } finally { if (saved === undefined) delete process.env.KICAD10_FOOTPRINT_DIR; else process.env.KICAD10_FOOTPRINT_DIR = saved }
}

/** Compare each layer of the pcbjs fab set with KiCad's by bounding box, and the drill files hole by hole. */
function compareFab(fab, kicadDir, pairs) {
  for (const [ours, theirs] of pairs) {
    const a = fab.files[ours], b = readFileSync(join(kicadDir, theirs), 'utf8')
    assert.ok(a, `pcbjs wrote ${ours}`)
    if (ours.endsWith('.drl')) { assert.deepEqual(drillHits(a), drillHits(b), ours); continue }
    const pa = gerberBox(a), pb = gerberBox(b)
    for (const k of ['x0', 'y0', 'x1', 'y1']) assert.ok(Math.abs(pa[k] - pb[k]) <= 0.002, `${ours} ${k}: pcbjs ${pa[k]} vs KiCad ${pb[k]}`)
  }
}

test('import board: the small KiCad board compiles with the pads, Gerbers and holes KiCad has', async () => {
  const { dst, out } = importFixture('small', ['small.kicad_pcb', 'small.kicad_pro'])
  assert.match(out, /6 parts and 0 plain footprints, 6 footprints \(6 from the KiCad library, 0 in lib\/\), 3 nets/)
  const sch = readFileSync(join(dst, 'pcb.sch.ts'), 'utf8')
  assert.match(sch, /export const U1 = SOIC_8_3_9x4_9mm_P1_27mm\('LM358'\)\.connect\(\{ 1: SIG, 2: NC, 3: NC, 4: GND, 5: NC, 6: NC, 7: NC, 8: VCC \}\)/)
  const pcb = readFileSync(join(dst, 'pcb.tsx'), 'utf8')
  // KiCad's back part at 30 degrees is side B at 210 here
  assert.match(pcb, /<D1 at="30 9 -150deg" side="B"/)
  assert.match(pcb, /<path layer="Edge\.Cuts" d="M 0 30 L 0 0 L 36 0 A 3\.99+ 3\.99+ 0 0 1 40 4 L 40 30 Z"/)
  const copper = readFileSync(join(dst, 'pcb.copper.tsx'), 'utf8')
  assert.match(copper, /route\(U1\[1\]\)\.width\(0\.25\)\.neck\(AS_DRAWN\)\.vias\(VIA\)\.Z\('12\.095 17'\)\.Z\('16 19'\)\.via\('B\.Cu'\)\.Z\('16 23'\)\.via\('F\.Cu'\)\.Z\(R1\[1\]\)/)
  assert.match(copper, /pour\(GND, 'B\.Cu', /)
  assert.match(copper, /keepout\('F\.Cu', '[^']+', \{ tracks: false, vias: false \}\)/)
  const c = await compile(dst)
  const b = c.board
  assert.deepEqual(b.drc.filter(d => d.rule === 'fab-mismatch'), [])
  assert.match(c.fab.readme, /Gerber self check: passed/)
  // KiCad finds the same: J1's pads 0.085 and 0.16 mm from its peg hole, and the six connections the board leaves open
  assert.deepEqual([...new Set(b.drc.filter(d => d.severity === 'error').map(d => d.rule))].sort(), ['hole-to-copper', 'unconnected'])
  assert.equal(b.unconnected, 6)
  compareFab(c.fab, join(FIX, 'boards', 'small', 'kicad-fab'), [
    ['small-F_Cu.gtl', 'small-F_Cu.gbr'], ['small-B_Cu.gbl', 'small-B_Cu.gbr'], ['small-F_Paste.gtp', 'small-F_Paste.gbr'], ['small-B_Paste.gbp', 'small-B_Paste.gbr'],
    ['small-Edge_Cuts.gm1', 'small-Edge_Cuts.gbr'], ['small-PTH.drl', 'small-PTH.drl'], ['small-NPTH.drl', 'small-NPTH.drl'],
  ])
})

test('import board: the tabs board with its rules and schematic is clean and its Gerbers match KiCad\'s', async () => {
  const { dst, out } = importFixture('tabs', ['tabs.kicad_pcb', 'tabs.kicad_pro', 'tabs.kicad_dru', 'tabs.kicad_sch'])
  assert.match(out, /3 parts and 0 plain footprints, 3 footprints \(0 from the KiCad library, 3 in lib\/\), 2 nets, 4 route chains of 8 segments and 1 arcs/)
  assert.match(out, /2 custom rules of the \.kicad_dru carried/)
  assert.deepEqual(readdirSync(join(dst, 'lib')).sort(), ['Hdr_1x02_P2_54mm.tsx', 'R_1206.tsx', 'Tab_Slot_1x02_P3_00mm.tsx'])
  const sch = readFileSync(join(dst, 'pcb.sch.ts'), 'utf8')
  assert.match(sch, /export const J1 = Tab_Slot_1x02_P3_00mm\('Tabs'\)\.connect\(\{ 1: SIG, 2: GND \}\)\.rules\(\{ edgeClearance: 0\.5 \}\)/)
  assert.match(readFileSync(join(dst, 'pcb.config.ts'), 'utf8'), /clearance: 0\.2032, .*edgeClearance: 0\.4, .*maskExpansion: 0\.0762/)
  const c = await compile(dst)
  const b = c.board
  assert.deepEqual(b.drc.map(d => `${d.rule}: ${d.message}`), [])
  assert.deepEqual(b.erc ?? [], [])
  assert.equal(b.unconnected, 0)
  assert.match(c.fab.readme, /Gerber self check: passed/)
  const at = (ref, num) => b.items.find(i => i.kind === 'pad' && i.ref === ref && i.num === num).at.map(v => Math.round(v * 1000) / 1000)
  assert.deepEqual(at('J1', '1'), [4, 5.5])
  assert.deepEqual(at('J2', '2'), [20, 8.04], 'a through-hole pad of a back footprint where KiCad has it')
  compareFab(c.fab, join(FIX, 'boards', 'tabs', 'kicad-fab'), [
    ['tabs-F_Cu.gtl', 'tabs-F_Cu.gbr'], ['tabs-B_Cu.gbl', 'tabs-B_Cu.gbr'], ['tabs-F_Mask.gts', 'tabs-F_Mask.gbr'], ['tabs-B_Mask.gbs', 'tabs-B_Mask.gbr'],
    ['tabs-F_Paste.gtp', 'tabs-F_Paste.gbr'], ['tabs-Edge_Cuts.gm1', 'tabs-Edge_Cuts.gbr'], ['tabs-PTH.drl', 'tabs-PTH.drl'],
  ])
})

test('import board: into a folder of a project with a package.json, the config and tsconfig.json go to the root; tracks keep their widths', async () => {
  const src = join(top, 'synth-kicad'), dst = join(top, 'synth')
  mkdirSync(src, { recursive: true }); mkdirSync(dst, { recursive: true })
  const { pcb, sch } = syntheticKicad()
  writeFileSync(join(src, 'synth.kicad_pcb'), pcb)
  writeFileSync(join(src, 'synth.kicad_sch'), sch)
  const pkg = JSON.stringify({ name: 'owner', private: true, type: 'module' }) + '\n'
  writeFileSync(join(dst, 'package.json'), pkg)
  const out = execFileSync(process.execPath, [BIN, 'import', 'board', join(src, 'synth.kicad_pcb'), '-o', 'pcb/synth.tsx'], { cwd: dst, env, encoding: 'utf8' })
  assert.match(out, /sourcing of 4 parts/)
  assert.equal(readFileSync(join(dst, 'package.json'), 'utf8'), pkg, 'the project\'s package.json is never replaced')
  assert.deepEqual(readdirSync(join(dst, 'pcb')).sort(), ['lib', 'synth.art.tsx', 'synth.copper.tsx', 'synth.sch.ts', 'synth.sourcing.ts', 'synth.tsx'])
  assert.match(readFileSync(join(dst, 'pcb.config.ts'), 'utf8'), /entries: \['pcb\/synth\.tsx'\]/)
  assert.deepEqual(JSON.parse(readFileSync(join(dst, 'tsconfig.json'), 'utf8')).include, ['*.ts', '*.tsx', 'pcb'])
  // a second import keeps the config and names the entry to add
  const again = execFileSync(process.execPath, [BIN, 'import', 'board', join(src, 'synth.kicad_pcb'), '-o', 'pcb2/synth.tsx'], { cwd: dst, env, encoding: 'utf8' })
  assert.match(again, /kept pcb\.config\.ts; add 'pcb2\/synth\.tsx' to its entries/)
  const b = (await compile(dst)).board
  // the 1 mm SIG tracks keep 1 mm up to the 0.6 mm pads: no neck-down
  assert.deepEqual([...new Set(b.items.filter(i => i.kind === 'track' && i.net === 'SIG' && i.layer === 'F.Cu').map(t => t.width))], [1])
  const pad = (ref, num) => b.items.find(i => i.kind === 'pad' && i.ref === ref && i.num === num)
  assert.deepEqual(pad('J1', '2').layers.filter(l => /Cu$/.test(l)), ['F.Cu', 'In2.Cu', 'B.Cu'])
  assert.ok(pad('D1', '1').pasteRings?.length === 1, 'the LED land pastes its window only')
  assert.equal(b.footprints.find(f => f.ref === 'D1').dnp, true)
})

test('import footprint: a library footprint becomes a module a board compiles; an existing file is kept', async () => {
  const dst = join(top, 'fp')
  mkdirSync(dst, { recursive: true })
  const out = execFileSync(process.execPath, [BIN, 'import', 'footprint', 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm'], { cwd: dst, env, encoding: 'utf8' })
  assert.match(out, /wrote lib\/SOIC_8_3_9x4_9mm_P1_27mm\.tsx: SOIC_8_3_9x4_9mm_P1_27mm, 8 pads, pins 1 2 3 4 5 6 7 8/)
  writeFileSync(join(dst, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  writeFileSync(join(dst, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', jsxImportSource: '@pcbjs/core', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, skipLibCheck: true, types: [] }, include: ['*.ts', '*.tsx', 'lib'] }))
  writeFileSync(join(dst, 'pcb.tsx'), [
    "import PCB, { nets } from '@pcbjs/core'",
    "import { SOIC_8_3_9x4_9mm_P1_27mm as SOIC8 } from './lib/SOIC_8_3_9x4_9mm_P1_27mm'",
    'const { A, B } = nets()',
    'const U1 = SOIC8(\'LM358\').connect({ 1: A, 2: B, 3: A, 4: B, 5: A, 6: B, 7: A, 8: B })',
    'export default <PCB name="FP"><rect layer="Edge.Cuts" x={0} y={0} w={20} h={20} /><U1 at="10 10" /></PCB>',
  ].join('\n'))
  const c = await compile(dst)
  assert.equal(c.board.items.filter(i => i.kind === 'pad').length, 8)
  assert.throws(() => execFileSync(process.execPath, [BIN, 'import', 'footprint', 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm'], { cwd: dst, env, encoding: 'utf8', stdio: 'pipe' }), /exists; pass --force/)
})
