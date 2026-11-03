// The stage reads: each facet perturbed on one board misses exactly the units that read it, and the warm compile equals a cold compile of the edit, so no read a positive list leaves out serves stale output.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import PCB, { h, keepout, pour, route, Schematic, Place } from '@pcbjs/core'
import { compileStages } from '@pcbjs/compile'
import { clearStageCache, setCompileId } from '@pcbjs/compile/internal/cache'
import { clearRouteCache } from '@pcbjs/compile/internal/route-cache'
import { twoLayer } from '@pcbjs/lib/stackups'
import { fp, handle, N } from './parts.mjs'

const smd = (ref, x, y, net, o = {}) => fp({ ref, at: `${x} ${y}`, nets: { 1: net }, ...o }, h('pad', { num: 1, size: 1, type: 'smd' }))
const A = smd('A', 5, 10, 'X')
const B = smd('B', 35, 10, 'X')
const C = smd('C', 5, 3, 'Y')
const D = smd('D', 35, 3, 'Y')

/** A tuned route X, a plain route Y, a GND pour, a label far from X and one near it; each option edits one thing. */
const board = (o = {}) =>
  h(
    PCB,
    {
      name: 'Reads',
      title: o.title ?? 'Reads',
      teardrops: o.drops ?? false,
      ...(o.clearance ? { rules: { clearance: o.clearance } } : {}),
      ...(o.stackup ? { stackup: o.stackup } : {}),
      ...(o.at ? { schematic: { drawing: h(Schematic, {}, h(Place, { part: A.part, at: o.at })) } } : {}),
      ...(o.plugins ? { plugins: o.plugins } : {}),
    },
    h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: o.w ?? 40, h: 20 }),
    A,
    B,
    C,
    o.moved ? h(D.part, { at: '35 4' }) : D,
    route(handle('A.1'), handle('B.1')).width(0.2).length(36).Z(),
    route(handle('C.1'), handle('D.1')).width(o.width ?? 0.25),
    pour(N.GND, 'B.Cu', 'M0 0 H40 V20 H0 Z'),
    h('text', { layer: 'F.SilkS', at: '20 17', size: 1 }, o.far ?? 'far'),
    h('text', { layer: 'F.SilkS', at: '20 12', size: 1 }, o.near ?? 'near'),
    ...(o.keepout ? [keepout('M 18 0 H 22 V 1 H 18 Z', { layers: ['F.Cu'] })] : []),
    ...(o.copper ? [h('rect', { layer: 'B.Cu', x: 1, y: 17, w: 1, h: 1 })] : []),
  )

/** One compile as a fresh process makes it, everything read from `dir`. */
function compile(dir, o = {}) {
  clearStageCache()
  clearRouteCache()
  const [r] = compileStages(board(o), {
    cache: { dir, entry: 'pcb.tsx', files: { '/project/pcb.tsx': 'one' }, env: '' },
    exports: [{ name: 'count', key: '1', run: b => b.items.length }],
  })
  return r
}
/** The keyed units that missed, sorted. */
const misses = r =>
  r.stages
    .filter(s => s.key && !s.hit && s.name !== 'place' && s.name !== 'evaluate')
    .map(s => s.name)
    .sort()
const canonical = b => JSON.stringify({ ...b, routing: { ...b.routing, cached: 0, ripped: 0, rounds: 0 } })

let dirs = []
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), 'pcbjs-reads-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  setCompileId(null)
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
})

/** The units an edit misses after a compile of `base`; the warm board must be what a cold compile of the edit gives. */
function perturbed(o, base = {}) {
  const dir = fresh()
  compile(dir, base)
  const warm = compile(dir, { ...base, ...o })
  const cold = compile(fresh(), { ...base, ...o })
  assert.equal(canonical(warm.board), canonical(cold.board), `${JSON.stringify(o)}: the warm board is the cold one`)
  assert.deepEqual(warm.board.drc, cold.board.drc)
  assert.deepEqual(warm.exports, cold.exports)
  return misses(warm)
}

/** A plugin of each kind: a hook writing data, a stage reading the outline, a check reading the drawings. */
const probe = (version = '1') => ({
  name: 'probe',
  version,
  after: { place: () => ({ data: { v: version } }) },
  stages: [
    {
      name: 'frame',
      slot: 'beforeChecks',
      reads: ['outline'],
      run: b => ({
        add: [
          {
            kind: 'graphic',
            layer: 'Dwgs.User',
            width: 0.1,
            paths: [
              [
                [1, 1],
                [b.bbox.w - 1, 1],
              ],
            ],
            closed: [false],
            fill: false,
          },
        ],
      }),
    },
  ],
  checks: [
    {
      rule: 'probe.labels',
      reads: ['drawings'],
      run: b => [{ severity: 'warning', rule: 'probe.labels', message: `${b.items.filter(i => i.kind === 'text').length} texts`, at: [0, 0] }],
    },
  ],
})

const ROUTED = ['autoroute', 'tune', 'finish:pours']
const COPPER = ['clearance', 'connectivity', 'current', 'edge-clearance', 'hole', 'keepout', 'length', 'loops', 'pair', 'reference', 'thermal', 'track-width', 'unconnected'].map(
  c => `checks:${c}`,
)
/** The checks of silk, mask and the edge band, which read the copper and the drawings. */
const DRAWN = ['edge-band', 'mask-web', 'silk', 'silk-edge'].map(c => `checks:${c}`)
const of = (...lists) => lists.flat().sort()

test('stage reads: an unchanged board misses nothing', () => {
  assert.deepEqual(perturbed({}), [])
})

test('stage reads: a board facet misses each unit that reads it, and what the units it changed feed', () => {
  assert.deepEqual(perturbed({ title: 'Other' }), of(ROUTED, COPPER, DRAWN, 'checks:sourcing', 'finish:silk', 'schematic', 'exports'), 'meta')
  assert.deepEqual(perturbed({ clearance: 0.3 }), of(ROUTED, COPPER, DRAWN, 'checks:copper-weight', 'checks:sourcing', 'finish:silk', 'exports'), 'rules')
  assert.deepEqual(perturbed({ stackup: twoLayer({ outerCopper: 2 }) }), of(ROUTED, COPPER, DRAWN, 'checks:copper-weight', 'exports'), 'stackup')
  assert.deepEqual(perturbed({ w: 41 }), of(ROUTED, COPPER, DRAWN, 'checks:courtyard', 'checks:cutout', 'finish:silk', 'exports'), 'outline')
  assert.deepEqual(perturbed({ keepout: true }), of(ROUTED, COPPER, DRAWN, 'exports'), 'keepouts')
  assert.deepEqual(
    perturbed({ moved: true }),
    of(ROUTED, COPPER, DRAWN, 'checks:courtyard', 'checks:model', 'checks:sourcing', 'finish:silk', 'schematic', 'exports'),
    'parts and pads',
  )
  assert.deepEqual(perturbed({ copper: true }), of(ROUTED, COPPER, DRAWN, 'checks:courtyard', 'finish:silk', 'exports'), 'copper and frame')
  assert.deepEqual(perturbed({ at: '20 10' }), of('schematic', 'exports'), 'sch')
  assert.deepEqual(perturbed({ width: 0.3 }), of(ROUTED, COPPER, DRAWN, 'exports'), 'jobs')
  assert.deepEqual(perturbed({ drops: true }), of(COPPER, DRAWN, 'checks:courtyard', 'finish:pours', 'finish:silk', 'exports'), 'jobs.finish')
})

test('stage reads: a label edit misses the silk and the exports, and the tuning only when the label is within reach of a tuned route', () => {
  assert.deepEqual(perturbed({ far: 'edited' }), of(DRAWN, 'checks:courtyard', 'finish:silk', 'exports'))
  assert.deepEqual(perturbed({ near: 'edited' }), of(DRAWN, 'checks:courtyard', 'finish:silk', 'tune', 'exports'))
})

test('stage reads: a plugin stage or check misses on the facets it reads and on its version, its hook data on the exports', () => {
  const base = { plugins: [probe()] }
  assert.deepEqual(perturbed({ far: 'edited' }, base), of(DRAWN, 'checks:courtyard', 'finish:silk', 'probe/probe.labels', 'exports'))
  assert.deepEqual(perturbed({ w: 41 }, base), of(ROUTED, COPPER, DRAWN, 'checks:courtyard', 'checks:cutout', 'finish:silk', 'probe/frame', 'probe/probe.labels', 'exports'))
  assert.deepEqual(perturbed({ plugins: [probe('2')] }, base), of('probe/frame', 'probe/probe.labels', 'exports'))
})
