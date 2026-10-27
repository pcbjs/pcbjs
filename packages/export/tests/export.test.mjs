// @pcbjs/export on its own: a board made with @pcbjs/core and compiled by @pcbjs/compile, written as a fab set and an SVG.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import PCB, { h } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { boardSvg, buildFab, excellon, gerberLayer, zipFab } from '../dist/index.js'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const DATE = '2026-01-01T00:00:00.000Z'
const pad = (ref, x) => h('footprint', { ref, value: 'V', id: 'pcbjs:TestPad', at: `${x}mm 10mm`, 'net:pad1': 'V', bom: false }, h('pad', { num: 1, size: 2, shape: 'circle', drill: 1 }))
const board = () => compileBoard(h(PCB, { name: 'Two', revision: '1.0' },
  h('circle', { layer: 'Edge.Cuts', cx: 10, cy: 10, r: 10 }), pad('TP1', 5), pad('TP2', 15),
  h('track', { net: 'V', layer: 'F.Cu', width: 0.5, d: 'M 5 10 H 15' })))

test('export: the fab set has every layer, the drills, the job file and an orderable README', () => {
  const fab = buildFab(board(), DATE)
  const names = Object.keys(fab.files)
  for (const ext of ['gtl', 'gbl', 'gts', 'gbs', 'gto', 'gm1', 'drl', 'gbrjob']) assert.ok(names.some(n => n.endsWith('.' + ext)), `a .${ext} file in ${names.join(', ')}`)
  assert.match(fab.readme, /STATUS: ORDERABLE/)
  assert.equal(fab.zipName, 'Two-fab-1.0.zip')
  assert.ok(zipFab(fab).length > 100)
})

test('export: the Gerber header, the job file, README-fab and the manifest name the package version', () => {
  const fab = buildFab(board(), DATE)
  const file = ext => Object.entries(fab.files).find(([n]) => n.endsWith(ext))[1]
  assert.equal(file('.gtl').split('\n')[0], `%TF.GenerationSoftware,pcbjs,pcbjs,${version}*%`)
  assert.equal(JSON.parse(file('.gbrjob')).Header.GenerationSoftware.Version, version)
  assert.ok(fab.readme.split('\n').includes(`Generated ${DATE} by pcbjs ${version}`))
  assert.equal(JSON.parse(fab.files['manifest.json']).generator, `pcbjs ${version}`)
})

test('export: Gerber copper, plated drills and the SVG of one board', () => {
  const b = board()
  assert.match(gerberLayer(b, 'F.Cu', DATE).text, /^%TF\.GenerationSoftware,pcbjs,pcbjs,[^*]+\*%/)
  const drl = excellon(b, true, DATE)
  assert.deepEqual(drl.tools.map(t => t.count), [2])
  assert.match(boardSvg(b), /^<\?xml/)
})
