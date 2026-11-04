// STEP models of footprints: the spec resolved relative to the file that defines the footprint, the model-missing ERC
// warning, the generated fallback the standard library keeps, and the step entry of the site data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import PCB, { h, bindRef } from '@pcbjs/core'
import { R0603, PinHeader } from '@pcbjs/lib'
import { compileBoard, CompileError } from '@pcbjs/compile'
import { siteData } from '@pcbjs/export/internal/site-data'
import { meshKey } from '@pcbjs/step/internal/key'
import { fp } from './parts.mjs'

const PIN = fileURLToPath(new URL('../../step/tests/fixtures/pin.step', import.meta.url))
const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 20 })
const board = (...children) => h(PCB, { name: 'Step' }, edge(), ...children)
const site = (b, root) => siteData(b, { root, fabUrl: '', fabName: '', fabFiles: [], fabStatus: '', svgUrl: '', dev: false, bom: [] })
const pad = () => h('pad', { num: 1, size: 1, at: '0 0' })

function project() {
  const root = mkdtempSync(join(tmpdir(), 'pcbjs-step-'))
  mkdirSync(join(root, 'parts', 'models'), { recursive: true })
  copyFileSync(PIN, join(root, 'parts', 'models', 'pin.step'))
  return { root, done: () => rmSync(root, { recursive: true, force: true }) }
}

test('a STEP path resolves against the file of the <footprint> element, and the site data carries the mesh hash and transform', () => {
  const p = project()
  try {
    // the source-range transform records the file relative to the root; the compile finds it among the imported files
    const J1 = fp(
      { ref: 'J1', at: '5 5', model: { file: './models/pin.step', rotate: [0, 0, 90] }, __src: { file: 'parts/pin.tsx', line: 3, col: 1, endLine: 3, endCol: 40 } },
      pad(),
    )
    const b = compileBoard(board(J1), { files: new Set([join(p.root, 'parts', 'pin.tsx')]) })
    const m = b.footprints[0].model
    assert.equal(m.kind, undefined)
    assert.equal(m.file, './models/pin.step')
    assert.equal(m.path, join(p.root, 'parts', 'models', 'pin.step'))
    assert.deepEqual(
      b.erc.filter(d => d.rule === 'model-missing'),
      [],
    )
    const s = site(b, p.root).footprints[0]
    assert.equal(s.model, undefined)
    assert.deepEqual(s.step, {
      file: 'parts/models/pin.step',
      mesh: meshKey(new Uint8Array(readFileSync(PIN))),
      transform: { offset: [0, 0, 0], rotate: [0, 0, 90], scale: [1, 1, 1] },
    })
  } finally {
    p.done()
  }
})

test('a missing STEP file is a model-missing warning naming the path, and the site data has no mesh', () => {
  const b = compileBoard(board(fp({ ref: 'J1', at: '5 5', model: { file: '/nowhere/part.step', fallback: { kind: 'box', w: 2, h: 2, height: 1 } } }, pad())))
  const w = b.erc.filter(d => d.rule === 'model-missing')
  assert.equal(w.length, 1)
  assert.equal(w[0].severity, 'warning')
  assert.match(w[0].message, /J1: model file \/nowhere\/part\.step not found at \/nowhere\/part\.step/)
  const s = site(b, '/').footprints[0]
  assert.deepEqual(s.model, { kind: 'box', w: 2, h: 2, height: 1 })
  assert.equal(s.step.mesh, undefined)
  assert.equal(s.step.file, 'nowhere/part.step')
})

test('a file: URL and an absolute path are taken as they are', () => {
  const url = pathToFileURL(PIN).href
  const b = compileBoard(board(fp({ ref: 'J1', at: '5 5', model: { file: url } }, pad()), fp({ ref: 'J2', at: '9 5', model: { file: PIN } }, pad())))
  assert.deepEqual(
    b.footprints.map(f => f.model.path),
    [PIN, PIN],
  )
})

test('the standard library keeps its generated model as the fallback of a STEP model', () => {
  const R1 = bindRef(R0603('330', { model: { file: PIN } }), 'R1')
  const J1 = bindRef(PinHeader(2)({ model: { file: PIN, offset: [0, 0, 1] } }), 'J1')
  const b = compileBoard(board(h(R1, { at: '5 5' }), h(J1, { at: '10 5' })))
  const [r, j] = b.footprints
  assert.equal(r.model.fallback.kind, 'chip')
  assert.deepEqual(j.model.fallback, { kind: 'header', pins: 2, rows: 1, pitch: 2.54 })
  assert.deepEqual(j.model.offset, [0, 0, 1])
  assert.equal(site(b, '/').footprints[0].model.kind, 'chip')
})

test('a bad STEP spec is a compile error at the footprint', () => {
  assert.throws(
    () => compileBoard(board(fp({ ref: 'J1', model: { file: PIN, rotate: [0, 90] } }, pad()))),
    e => e instanceof CompileError && /J1: model rotate needs three numbers/.test(e.message),
  )
  assert.throws(() => compileBoard(board(fp({ ref: 'J1', model: { file: '' } }, pad()))), /a model file needs file/)
  assert.throws(() => compileBoard(board(fp({ ref: 'J1', model: { file: PIN, fallback: { file: PIN } } }, pad()))), /fallback must be a generated model/)
  // one key, file, and no kind
  assert.throws(() => compileBoard(board(fp({ ref: 'J1', model: { step: PIN } }, pad()))), /J1: the model file key is file, such as \{ file: '.\/models\/part.step' \}/)
  assert.throws(() => compileBoard(board(fp({ ref: 'J1', model: { kind: 'step', file: PIN } }, pad()))), /J1: a model file has no kind/)
  assert.throws(
    () => compileBoard(board(fp({ ref: 'J1', model: { file: '${KICAD9_3DMODEL_DIR}/Crystal.3dshapes/X.wrl' } }, pad()))),
    /a KiCad library model is kicad:<Lib>.3dshapes\/<Name>.step/,
  )
})
