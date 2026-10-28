// The importer's footprint dedupe: copies that differ only in their pads' zone connections make one module with a thermal map
// on each placement that differs, and copies whose geometry differs by nanometres of rotation noise make one module.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importBoard, readKicadPcb } from '../dist/index.js'
import { sameGeometry, padThermals } from '../dist/import-board.js'

const fx = (ref, at, items) => `  (footprint "Test:R_Ring" (layer "F.Cu") (at ${at})
    (property "Reference" "${ref}" (at 0 -2 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "1k" (at 0 2 0) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))
    (attr smd)
${items.map(s => '    ' + s).join('\n')}
  )`
// a pad's angle in the file is the footprint's: KiCad writes it on the board
const pad = (n, x, net, extra = '', rot = 0) =>
  `(pad "${n}" smd roundrect (at ${x} 0${rot ? ` ${rot}` : ''}) (size 0.8 0.95) (roundrect_rratio 0.25) (layers "F.Cu" "F.Paste" "F.Mask") (net "${net}")${extra})`
const fabRect = `(fp_rect (start -0.8 -0.4125) (end 0.8 0.4125) (stroke (width 0.1) (type solid)) (fill no) (layer "F.Fab"))`
// the same rectangle as KiCad writes it for a copy turned 15 degrees and back: a polygon a nanometre off
const fabNoisy = `(fp_poly (pts (xy -0.8 -0.412499) (xy 0.8 -0.4125) (xy 0.8 0.412499) (xy -0.8 0.4125)) (stroke (width 0.1) (type solid)) (fill no) (layer "F.Fab"))`
const crt = `(fp_rect (start -1.48 -0.73) (end 1.48 0.73) (stroke (width 0.05) (type solid)) (fill no) (layer "F.CrtYd"))`
const pcb = `(kicad_pcb (version 20240108) (generator "pcbnew") (generator_version "8.0")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (35 "F.Paste" user) (39 "F.Mask" user) (38 "B.Mask" user) (37 "F.SilkS" user "F.Silkscreen") (44 "Edge.Cuts" user) (46 "F.CrtYd" user "F.Courtyard") (49 "F.Fab" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "") (net 1 "GND") (net 2 "SIG")
${fx('R1', '10 10', [pad(1, -0.825, 'SIG'), pad(2, 0.825, 'GND'), fabRect, crt])}
${fx('R2', '20 10 15', [pad(1, -0.825, 'SIG', '', 15), pad(2, 0.825, 'GND', '', 15), fabNoisy, crt])}
${fx('R3', '10 20', [pad(1, -0.825, 'SIG'), pad(2, 0.825, 'GND', ' (zone_connect 2)'), fabRect, crt])}
${fx('R4', '20 20 30', [pad(1, -0.825, 'SIG', ' (zone_connect 0)', 30), pad(2, 0.825, 'GND', ' (thermal_bridge_angle 45)', 30), fabNoisy, crt])}
  (gr_rect (start 0 0) (end 30 30) (stroke (width 0.1) (type solid)) (fill no) (layer "Edge.Cuts"))
)
`

function imported() {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-kicad-dedupe-')))
  try {
    writeFileSync(join(top, 'ring.kicad_pcb'), pcb)
    return importBoard(join(top, 'ring.kicad_pcb'), { outDir: join(top, 'out'), schematic: false })
  } finally {
    rmSync(top, { recursive: true, force: true })
  }
}

test('import dedupe: copies differing in zone connections and by 1 nm of rotation noise make one module', () => {
  const res = imported()
  assert.deepEqual(
    [...res.files.keys()].filter(k => k.startsWith('lib/')),
    ['lib/R_Ring.tsx'],
  )
  assert.equal(res.counts.lib, 1)
  const lib = res.files.get('lib/R_Ring.tsx')
  assert.doesNotMatch(lib, /thermal=/, "the pads where the copies differ keep the pour's relief")
})

test('import dedupe: each placement that joins pours differently carries a thermal map of those pads', () => {
  const board = imported().files.get('pcb.tsx')
  const line = ref => board.split('\n').find(l => l.trim().startsWith(`<${ref} `))
  assert.doesNotMatch(line('R1'), /thermal=/)
  assert.doesNotMatch(line('R2'), /thermal=/)
  assert.match(line('R3'), /thermal=\{\{ 2: 'solid' \}\}/)
  assert.match(line('R4'), /thermal=\{\{ 1: 'none', 2: \{ angle: 45 \} \}\}/)
})

test('sameGeometry: numbers within 1 µm are equal, beyond it or with other text not', () => {
  assert.ok(sameGeometry('L|F.Fab|0.1|-0.8,-0.4125', 'L|F.Fab|0.1|-0.8,-0.412499'))
  assert.ok(sameGeometry('a 1.0000', 'a 1.0009'))
  assert.ok(!sameGeometry('a 1.000', 'a 1.002'))
  assert.ok(!sameGeometry('L|F.Fab|1', 'L|B.Fab|1'))
})

test('padThermals: one setting per pad number, null when a number has two', () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-kicad-thermals-')))
  try {
    const twice = pcb.replace(
      `${fx('R1', '10 10', [pad(1, -0.825, 'SIG'), pad(2, 0.825, 'GND'), fabRect, crt])}`,
      `${fx('R1', '10 10', [pad(1, -0.825, 'SIG', ' (zone_connect 2)'), pad(1, 0.825, 'SIG'), fabRect, crt])}`,
    )
    writeFileSync(join(top, 'a.kicad_pcb'), twice)
    const fps = readKicadPcb(join(top, 'a.kicad_pcb')).footprints
    assert.equal(padThermals(fps[0]), null)
    assert.deepEqual(
      [...padThermals(fps[2])],
      [
        ['1', 'null'],
        ['2', '"solid"'],
      ],
    )
  } finally {
    rmSync(top, { recursive: true, force: true })
  }
})
