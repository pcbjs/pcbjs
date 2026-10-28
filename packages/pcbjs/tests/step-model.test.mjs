// STEP models of footprints: the spec resolved relative to the file that defines the footprint, the model-missing ERC
// warning, the generated fallback the standard library keeps, and the step entry of the site data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import PCB, { h } from '@pcbjs/core'
import { R0603, PinHeader } from '@pcbjs/lib'
import { compileBoard, CompileError } from '@pcbjs/compile'
import { siteData } from '@pcbjs/export/site-data'
import { meshKey } from '@pcbjs/step/key'

const PIN = new URL('../../step/tests/fixtures/pin.step', import.meta.url).pathname
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
    const fp = h(
      'footprint',
      { ref: 'J1', at: '5 5', model: { step: './models/pin.step', rotate: [0, 0, 90] }, __src: { file: 'parts/pin.tsx', line: 3, col: 1, endLine: 3, endCol: 40 } },
      pad(),
    )
    const b = compileBoard(board(fp), { files: new Set([join(p.root, 'parts', 'pin.tsx')]) })
    const m = b.footprints[0].model
    assert.equal(m.kind, 'step')
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
  const b = compileBoard(
    board(h('footprint', { ref: 'J1', at: '5 5', model: { kind: 'step', step: '/nowhere/part.step', fallback: { kind: 'box', w: 2, h: 2, height: 1 } } }, pad())),
  )
  const w = b.erc.filter(d => d.rule === 'model-missing')
  assert.equal(w.length, 1)
  assert.equal(w[0].severity, 'warning')
  assert.match(w[0].message, /J1: STEP model \/nowhere\/part\.step not found at \/nowhere\/part\.step/)
  const s = site(b, '/').footprints[0]
  assert.deepEqual(s.model, { kind: 'box', w: 2, h: 2, height: 1 })
  assert.equal(s.step.mesh, undefined)
  assert.equal(s.step.file, 'nowhere/part.step')
})

test('a file: URL and an absolute path are taken as they are', () => {
  const url = pathToFileURL(PIN).href
  const b = compileBoard(board(h('footprint', { ref: 'J1', at: '5 5', model: { step: url } }, pad()), h('footprint', { ref: 'J2', at: '9 5', model: { step: PIN } }, pad())))
  assert.deepEqual(
    b.footprints.map(f => f.model.path),
    [PIN, PIN],
  )
})

test('the standard library keeps its generated model as the fallback of a STEP model', () => {
  const R1 = R0603({ value: '330', model: { step: PIN } })
  const J1 = PinHeader(2, { model: { step: PIN, offset: [0, 0, 1] } })
  const b = compileBoard(board(h(R1, { at: '5 5' }), h(J1, { at: '10 5' })))
  const [r, j] = b.footprints
  assert.equal(r.model.fallback.kind, 'chip')
  assert.deepEqual(j.model.fallback, { kind: 'header', pins: 2, rows: 1, pitch: 2.54 })
  assert.deepEqual(j.model.offset, [0, 0, 1])
  assert.equal(site(b, '/').footprints[0].model.kind, 'chip')
})

test('a bad STEP spec is a compile error at the footprint', () => {
  assert.throws(
    () => compileBoard(board(h('footprint', { ref: 'J1', model: { step: PIN, rotate: [0, 90] } }, pad()))),
    e => e instanceof CompileError && /J1: model rotate needs three numbers/.test(e.message),
  )
  assert.throws(() => compileBoard(board(h('footprint', { ref: 'J1', model: { step: '' } }, pad()))), /needs step, the file/)
  assert.throws(() => compileBoard(board(h('footprint', { ref: 'J1', model: { step: PIN, fallback: { step: PIN } } }, pad()))), /fallback must be a generated model/)
})
