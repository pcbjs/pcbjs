// A pad under a merged pour lights its own mesh, never the merged one; a whole net lights the merged mesh.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isoOut, lit, litMeshes, overlaid } from '../src/scene/lit.ts'

// as buildItems makes them: J1's GND pad and the pour merged on B.Cu, each one's own mesh hidden under it; J1's SIG pad alone
const net = { id: -1e6, kind: 'zone', net: 'GND', layers: ['B.Cu'], layer: 'B.Cu' }
const pad = { id: 2, kind: 'pad', net: 'GND', ref: 'J1', layers: ['B.Cu'], layer: 'B.Cu', pad: '1' }
const pour = { id: 9, kind: 'zone', net: 'GND', layers: ['B.Cu'], layer: 'B.Cu' }
const sig = { id: 3, kind: 'pad', net: 'SIG', ref: 'J1', layers: ['B.Cu'], layer: 'B.Cu', pad: '2' }
const mesh = (name, userData) => ({ name, userData })
const meshes = [mesh('merged', { ...net, items: [pad, pour] }), mesh('pad', { ...pad, under: net }), mesh('pour', { ...pour, under: net }), mesh('sig', sig)]
const keep = (k = {}) => ({ ids: new Set(k.ids ?? []), parts: new Set(k.parts ?? []), nets: new Set(k.nets ?? []) })
const names = ms => ms.map(m => m.name)
const byName = n => meshes.find(m => m.name === n).userData

test('a pad id lights its own mesh, never the merged pour', () => {
  assert.deepEqual(names(litMeshes(meshes, keep({ ids: [2] }))), ['pad'])
  assert.equal(lit(byName('merged'), keep({ ids: [2] })), false)
  assert.deepEqual(names(overlaid(meshes, keep({ ids: [2] }), null)), ['pad'])
})

test('a part lights its pads, the merged pour stays out of the focus', () => {
  const k = keep({ parts: ['J1'] })
  assert.deepEqual(names(litMeshes(meshes, k)), ['pad', 'sig'])
  assert.equal(lit(byName('merged'), k), false)
  assert.deepEqual(names(overlaid(meshes, k, null)), ['pad'])
})

test('a whole net lights the merged mesh, not the items under it', () => {
  const k = keep({ nets: ['GND'] })
  assert.deepEqual(names(litMeshes(meshes, k)), ['merged'])
  assert.equal(lit(byName('merged'), k), true)
  assert.deepEqual(names(overlaid(meshes, k, null)), [])
})

test('a pad over its context net keeps its own overlay, the merged mesh lit by the net', () => {
  const k = keep({ ids: [2], nets: ['GND'] })
  assert.deepEqual(names(litMeshes(meshes, k)), ['merged'])
  assert.deepEqual(names(overlaid(meshes, k, null)), ['pad'])
})

test('an isolation of the part leaves the merged pour out and shows the pad alone', () => {
  const iso = { ids: new Set([2, 3]), parts: new Set(['J1']), fade: false }
  assert.equal(isoOut(byName('merged'), iso), true)
  assert.equal(isoOut(byName('pad'), iso), false)
  assert.deepEqual(names(overlaid(meshes, null, iso)), ['pad'])
  const all = { ids: new Set([2, 9]), parts: new Set(), fade: false }
  assert.equal(isoOut(byName('merged'), all), false)
  assert.deepEqual(names(overlaid(meshes, null, all)), [])
})
