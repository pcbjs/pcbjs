// The posters of `?pcb:poster` and `?pcb:board`: the top view, path data written as tight as SVG reads it, the same shape.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compactPath, posterSvg, tightPath } from '../dist/server/poster.js'

test('a path of absolute lines becomes relative lines at 0.01 mm, a point within 0.1 mm of the last one dropped', () => {
  assert.equal(compactPath('M1.5 2.25L3 2.25L3.01 2.26L3 4.5L1.5 2.25Z'), 'M1.5 2.25l1.5 0l0 2.25l-1.5 -2.25z')
  assert.equal(compactPath('M0 0A1 1 0 0 1 2 0'), 'M0 0A1 1 0 0 1 2 0', 'an arc stays as it is')
})

test('tight path data: h and v along an axis, no repeated command, no separator a sign or a second point makes', () => {
  assert.equal(tightPath('M1.5 2.25l1.5 0l0 2.25l-1.5-2.25z'), 'M1.5 2.25h1.5v2.25l-1.5-2.25z')
  assert.equal(tightPath('M16.16 18.42l0-1.27l-.12 .18l-.12 .12l-.12 .06'), 'M16.16 18.42v-1.27l-.12.18-.12.12-.12.06')
  assert.equal(tightPath('M0 0L1 1L2 3'), 'M0 0 1 1 2 3', 'lines after a move need no letter')
  assert.equal(tightPath('M0 0l0.5 0.25l3 .5'), 'M0 0l.5.25 3 .5', 'a point after a whole number keeps its space')
})

test('a poster keeps the top view and drops the metadata and the item ids', () => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:pcb="https://pcb.svg/ns/1" viewBox="0 0 10 10">
  <metadata>
    <pcb:board name="x"/>
  </metadata>
  <g pcb:layer="F.Cu" id="layer-F_Cu" color="#c83434" fill="currentColor">
<path data-id="3" d="M1.123456 2L3 2"/>
  </g>
  <g pcb:layer="F.Fab" id="layer-F_Fab" color="#afafaf" fill="currentColor">
<path d="M0 0L1 1"/>
  </g>
</svg>
`
  const out = posterSvg(svg)
  assert.doesNotMatch(out, /metadata|data-id|pcb:|F_Fab|<\?xml/)
  assert.match(out, /<path d="M1\.12 2h1\.88"\/>/)
})
