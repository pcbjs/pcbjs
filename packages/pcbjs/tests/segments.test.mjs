// Segment sync: every command of a route chain is an item of its own whose source range is that command's call.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { route } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { siteData } from '@pcbjs/export/internal/site-data'
import { transformSourceRanges } from '@pcbjs/cli/internal/source-ranges'
import { highlightLabel, resolveCursor, sourceTarget } from '@pcbjs/ui'
import { fp, handle } from './parts.mjs'

const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 })
const smd = (ref, x, y, net) => fp({ ref, at: `${x} ${y}`, nets: { 1: net } }, h('pad', { num: 1, size: 1, type: 'smd' }))
const site = board => siteData(board, { root: '/p', fabUrl: '', fabName: '', fabFiles: [], fabStatus: 'ok', svgUrl: '', dev: true, bom: [] })

/** The `__src` objects the transform injects into `code`, evaluated, in source order. */
function injected(code, file = 'main.tsx') {
  const out = transformSourceRanges(code, `/p/${file}`, file).code
  return [...out.matchAll(/__src(?:=\{|: )(\{ file: [^}]*\})/g)].map(m => Function(`return (${m[1]})`)())
}
/** The route of `code`, a chain on one line, built as the transformed code calls it: the call's range, then each command with its own. */
function chained(code, ends, steps) {
  const out = transformSourceRanges(`import { route } from '@pcbjs/core'\n${code}`, '/p/a.ts', 'a.ts').code
  const ats = [...out.matchAll(/\.__at\((\{[^}]*\})\)/g)].map(m => Function(`return (${m[1]})`)())
  const [src] = injected(`import { route } from '@pcbjs/core'\n${code}`, 'a.ts')
  assert.equal(ats.length, steps.length)
  return steps.reduce((r, f, k) => f(r).__at(ats[k]), route(...ends, { __src: src }).width(0.25))
}

test('segments: route chain commands map to their items, automatic legs included', () => {
  const code = `route(J1[1], J2[1]).H(8).V(5).via('B.Cu').H(14).X()\n`
  const r = chained(code, [handle('J1.1'), handle('J2.1')], [r => r.H(8), r => r.V(5), r => r.via('B.Cu'), r => r.H(14), r => r.X()])
  const b = compileBoard(h(PCB, { name: 'R' }, edge(), smd('J1', 3, 3, 'N'), smd('J2', 20, 12, 'N'), r))
  const col = s => code.indexOf(s) + 1
  const by = s => b.items.filter(i => (i.kind === 'track' || i.kind === 'via') && i.src?.line === 2 && i.src.col === col(s))
  assert.equal(by('H(8)').length, 1)
  assert.equal(by('V(5)').length, 1)
  assert.deepEqual(
    by("via('B.Cu')").map(i => i.kind),
    ['via'],
  )
  assert.equal(by('H(14)').length, 1)
  assert.equal(by('H(14)')[0].layer, 'B.Cu')
  const auto = by('X()')
  assert.ok(auto.length >= 1 && auto.some(i => i.kind === 'track'), 'the automatic leg carries the X() range')
  assert.equal(auto[0].src.endCol, col('X()') + 2)
  assert.ok(auto[0].chain.at(-1).col === 1, 'the call is innermost in the chain')
  assert.equal(b.unconnected, 0)
})

test('segments: the source index has a range per command beside the call, and the cursor resolves to one command', () => {
  const code = `route(J1[1], J2[1]).H(8).V(5).Z()\n`
  const r = chained(code, [handle('J1.1'), handle('J2.1')], [r => r.H(8), r => r.V(5), r => r.Z()])
  const b = compileBoard(h(PCB, { name: 'R' }, edge(), smd('J1', 3, 3, 'N'), smd('J2', 20, 5, 'N'), r))
  const d = site(b)
  const ranges = d.sources['a.ts']
  const call = ranges.find(x => x.start[1] === 1)
  const cmds = ranges.filter(x => x !== call)
  assert.equal(cmds.length, 3)
  assert.equal(call.uids.length, 3)
  for (const x of cmds) {
    assert.ok(x.start[1] > call.end[1], 'after the call')
    assert.equal(x.uids.length, 1)
  }
  const hit = resolveCursor(d.sources, 'a.ts', 2, code.indexOf('V(5)') + 2)
  assert.deepEqual(hit.uids, cmds.find(x => x.start[1] === code.indexOf('V(5)') + 1).uids)
  // a click opens the command
  const v = cmds.find(x => x.uids.includes(hit.uids[0]))
  const id = d.items.find(i => i.uid === hit.uids[0]).id
  assert.deepEqual(sourceTarget(d, { id }, 'placement'), { file: 'a.ts', start: v.start, end: v.end })
})

test('segments: the chip reads file:line:col for a command and file:line otherwise', () => {
  assert.equal(highlightLabel({ file: 'main.tsx', line: 4, col: 9, seg: 'H 9' }), 'main.tsx:4:9')
  assert.equal(highlightLabel({ file: 'main.tsx', line: 4 }), 'main.tsx:4')
})
