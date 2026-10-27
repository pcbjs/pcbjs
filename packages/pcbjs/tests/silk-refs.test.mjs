// Silk reference designators: drawn above the courtyard by default, moved off pads, text and the edge, or left out with silk-ref.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets } from '@pcbjs/core'
import { R0603, PinHeader } from '@pcbjs/lib'
import { compileBoard, CompileError } from '@pcbjs/compile'
import { bbox } from '@pcbjs/compile/geom'

const edge = (w = 30, hh = 20) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
const board = (props, ...children) => compileBoard(h(PCB, { name: 'Silk', ...props }, edge(), ...children))
const refText = (b, ref) => b.items.find(i => i.kind === 'text' && i.ref === ref && i.text === ref)
const silkFindings = b => [...b.drc, ...b.erc].filter(d => /silk/.test(d.rule))
const box = t => bbox(t.strokes)

test('silk refs: each footprint gets its ref on its side, 1 mm high, 0.15 mm stroke, centred above the courtyard', () => {
  const { A, B } = nets()
  const R1 = R0603('1k').connect(A, B), R2 = R0603('1k').connect(A, B)
  const b = board({}, h(R1, { at: '10 10' }), h(R2, { at: '20 10', side: 'B' }))
  const f = refText(b, 'R1'), k = refText(b, 'R2')
  assert.equal(f.layer, 'F.SilkS'); assert.equal(f.size, 1); assert.equal(f.thickness, 0.15); assert.equal(f.mirrored, false)
  assert.equal(k.layer, 'B.SilkS'); assert.equal(k.mirrored, true)
  const cy = bbox(b.items.filter(i => i.kind === 'graphic' && i.layer === 'F.CrtYd' && i.ref === 'R1').flatMap(g => g.paths))
  const t = box(f)
  assert.ok(Math.abs(t.x + t.w / 2 - 10) < 1e-6, 'centred over the part')
  assert.ok(t.y + t.h < cy.y, 'above the courtyard')
  assert.ok(cy.y - (t.y + t.h) < 0.5)
  assert.deepEqual(silkFindings(b), [])
})

test('silk refs: a ref that would cover a pad, a text or the edge moves to the nearest clear spot', () => {
  const { A, B } = nets()
  // at the top edge there is no room above, and a text sits below
  const R1 = R0603('1k').connect(A, B)
  const b = board({}, h(R1, { at: '15 1.2' }), h('text', { layer: 'F.SilkS', at: '15 3.2', size: 1 }, 'X'))
  const t = box(refText(b, 'R1'))
  assert.ok(t.y > 0.2, 'inside the board')
  assert.deepEqual(silkFindings(b), [], JSON.stringify(silkFindings(b)))
})

test('silk refs: no clear spot within 3 mm leaves the ref out with one silk-ref warning', () => {
  const { A, B } = nets()
  const R1 = R0603('1k').connect(A, B)
  // a board just larger than the part: no room anywhere
  const b = compileBoard(h(PCB, { name: 'Tiny' }, edge(3, 2), h(R1, { at: '1.5 1' })))
  assert.equal(refText(b, 'R1'), undefined)
  const w = b.erc.filter(e => e.rule === 'silk-ref')
  assert.equal(w.length, 1)
  assert.equal(w[0].severity, 'warning')
  assert.match(w[0].message, /^no clear spot within 3 mm for the silk ref of R1; it is left out/)
})

test('silk refs: silkRefs={false} board wide, ref={false} and refAt per placement', () => {
  const { A, B } = nets()
  const R1 = R0603('1k').connect(A, B), R2 = R0603('1k').connect(A, B), R3 = R0603('1k').connect(A, B)
  const off = board({ silkRefs: false }, h(R1, { at: '10 10' }))
  assert.equal(refText(off, 'R1'), undefined)
  const b = board({}, h(R1, { at: '5 10', ref: false }), h(R2, { at: '15 10', refAt: '0 3 90' }), h(R3, { at: '25 10', refAt: false }))
  assert.equal(refText(b, 'R1'), undefined)
  assert.equal(refText(b, 'R3'), undefined)
  const t = refText(b, 'R2')
  assert.deepEqual(t.at, [15, 13])
  assert.equal(t.rot, 90)
  assert.throws(() => board({ silkRefs: 'no' }), e => e instanceof CompileError && /silkRefs must be true or false/.test(e.message))
  assert.throws(() => board({}, h(R1, { at: '5 10', ref: 'R7' })), e => e instanceof CompileError && /not from ref/.test(e.message))
  // a plain footprint takes refAt too
  const f = board({}, h('footprint', { ref: 'J9', at: '10 10', refAt: false }, h('pad', { num: 1, size: [1, 1] })))
  assert.equal(refText(f, 'J9'), undefined)
})

test('silk refs: a 2.54 mm header keeps its ref clear of the pad openings, and the DRC silk rules stay quiet', () => {
  const { A, B, C, D } = nets()
  const J1 = PinHeader(4).connect(A, B, C, D)
  const b = board({}, h(J1, { at: '15 10' }))
  assert.ok(refText(b, 'J1'))
  assert.deepEqual(silkFindings(b), [])
})

test('silk refs: test points, pogo pads, fiducials and mounting holes get none, unless refAt places one', () => {
  const tp = (ref, at, props = {}, pads = [{ num: 1, at: '0 0', size: 1.5 }]) => h('footprint', { ref, at, ...props }, ...pads.map(p => h('pad', p)))
  const probes = [1, 2, 3].map(n => ({ num: n, at: `0 ${2 * (n - 1)}`, size: [1.75, 1.2], drill: 0.8, shape: 'oval' }))
  const b = board({},
    tp('TP1', '5 5', { id: 'my:TestPoint_Pad_D1.5mm' }),
    tp('TP2', '10 5', { bom: false, pos: false }),
    tp('FID1', '15 5', { id: 'Fiducial_1mm_Mask2mm' }),
    tp('H1', '20 5', { id: 'MountingHole_3.2mm' }, [{ num: 1, at: '0 0', size: 3.2, drill: 3.2, type: 'npth' }]),
    tp('J9', '25 5', { bom: false, pos: false }, probes),
    tp('TP3', '5 14', { id: 'my:TestPoint_Pad_D1.5mm', refAt: '0 -2 0' }),
    tp('J1', '15 14'))
  for (const ref of ['TP1', 'TP2', 'FID1', 'H1', 'J9']) assert.equal(refText(b, ref), undefined, ref)
  assert.ok(refText(b, 'TP3'), 'refAt draws the ref of a test point')
  assert.ok(refText(b, 'J1'), 'a plain one pad footprint keeps its ref')
  assert.deepEqual(silkFindings(b), [])
})
