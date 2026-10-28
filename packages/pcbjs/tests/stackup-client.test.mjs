// The viewer's stackup panel and 3D colours, imported straight from the client TypeScript, and the stackup in the site data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { siteData } from '@pcbjs/export/site-data'
import { JLCPCB_4L_7628, fourLayer } from '@pcbjs/lib/stackups'
import { cssColor, sideColors, stackupRows } from '@pcbjs/viewer/src/stackup.ts'

const site = props =>
  siteData(compileBoard(h(PCB, { name: 'S', ...props }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 10, h: 10 }))), {
    root: '/',
    fabUrl: '',
    fabName: '',
    fabFiles: [],
    fabStatus: 'ok',
    svgUrl: '',
    dev: false,
    bom: [],
  })

test('site data carries the stackup, generated or given', () => {
  assert.deepEqual(site({ stackup: JLCPCB_4L_7628 }).stackup, JLCPCB_4L_7628)
  assert.equal(site({ copper: 2 }).stackup.layers.filter(l => l.type === 'copper').length, 2)
})

test('stackupRows lists every layer top to bottom with thickness and material or weight', () => {
  const rows = stackupRows(JLCPCB_4L_7628)
  assert.equal(rows.length, JLCPCB_4L_7628.layers.length)
  assert.deepEqual(rows.map(r => r.type).slice(3, 10), ['copper', 'prepreg', 'copper', 'core', 'copper', 'prepreg', 'copper'])
  assert.deepEqual(rows[3], { type: 'copper', name: 'F.Cu', thickness: '0.035', detail: '1 oz', color: null, title: 'copper, F.Cu, 0.035 mm, 1 oz' })
  assert.deepEqual(rows[4], { type: 'prepreg', name: '', thickness: '0.2104', detail: '7628', color: null, title: 'prepreg, 0.2104 mm, 7628, er 4.4, loss tangent 0.02' })
  assert.equal(rows[2].name, 'F.Mask')
  assert.equal(rows[2].detail, 'Green')
})

test('mask and silk colours: the side layer first, then the stackup, fab names mapped', () => {
  assert.deepEqual(sideColors(fourLayer({ maskColor: '#1a1a1a' }), 'F'), { mask: '#1a1a1a', silk: '#ececec' })
  assert.deepEqual(sideColors({ layers: [], maskColor: 'Black' }, 'B'), { mask: '#1a1a1a', silk: null })
  assert.equal(cssColor('Matte Black'), '#202020')
  assert.equal(cssColor(undefined), null)
  assert.deepEqual(sideColors(undefined, 'F'), { mask: null, silk: null })
})
