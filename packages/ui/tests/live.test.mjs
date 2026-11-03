// The live board of a dev page: facets taken in order and a stale one dropped, what an edit makes stale until the facet that
// resolves it, a keystroke tier's sketch and the compiles an edit cancelled, and the four ways a view tells it fell out of sync.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FACET_NAMES, facetHash, facetSet, joinSite, splitSite } from '@pcbjs/core/site-facets'
import { pack } from '@pcbjs/core/site-shapes'
import { remakes } from '../src/scene/remake.ts'
import { compareState, drawnPose, holdOf, holding, liveOf, repeated, seqTracker, sketchIds, staleOf, takeFacet, takeInvalidate, unknownIn } from '../src/live.ts'

const meta = {
  name: 'B',
  title: 'B',
  rev: '1',
  copper: 2,
  thickness: 1.6,
  viewBox: [0, 0, 10, 10],
  bbox: { x: 0, y: 0, w: 10, h: 10 },
  outline: [],
  nets: ['GND'],
  footprints: [{ ref: 'R1', pads: [{ num: '1', name: '1', net: 'GND', at: [1, 1] }] }],
  airwires: [{ net: 'GND', from: [1, 1], to: [2, 2] }],
}
const layers = {
  layers: [],
  holes: '',
  drills: [],
  items: [
    { id: 1, uid: 'a', kind: 'pad' },
    { id: 2, uid: 't', kind: 'track' },
  ],
  carried: [],
}
const msg = (facet, data, run = 2) => ({ board: 'B', run, facet, stage: facet === 'meta' ? 'place' : 'finish', hash: facetHash(data), data })

test('facets build the board from its first meta, the airwires standing in for the ratsnest until the findings come', () => {
  const held = new Map()
  assert.equal(takeFacet(held, msg('layers', layers)).site, null, 'no board before its meta')
  const { site } = takeFacet(held, msg('meta', meta))
  assert.equal(site.name, 'B')
  assert.equal(site.items.length, 2)
  assert.deepEqual(site.ratsnest, meta.airwires)
  assert.deepEqual(site.drc, [])
  const done = takeFacet(held, msg('findings', { drc: [], erc: [], ratsnest: [], unconnected: 0 })).site
  assert.deepEqual(done.ratsnest, [])
})

test('a facet older than the one of its kind held is dropped, one whose data is not its hash is bad', () => {
  const held = new Map()
  takeFacet(held, msg('meta', meta, 3))
  assert.equal(takeFacet(held, msg('meta', { ...meta, title: 'old' }, 2)).dropped, true)
  assert.equal(takeFacet(held, msg('layers', layers, 1)).site.items.length, 2, 'an older facet of another kind still fills in')
  assert.equal(takeFacet(held, { ...msg('meta', meta, 4), hash: '0000000000000000' }).bad, true)
})

test('split and join agree, and a split facet hashes as the builders write it', () => {
  const site = joinSite({ meta, layers, findings: { drc: [], erc: [], ratsnest: [], unconnected: 0, stats: { tracks: 1 } } })
  const parts = splitSite(site)
  assert.deepEqual(Object.keys(parts), FACET_NAMES)
  assert.equal(facetHash(parts.layers), facetHash(layers))
  assert.deepEqual(joinSite(parts).items, site.items)
})

test('the 3D scene is remade by new shapes, meta or model, never by findings, the fab set or the same shapes again', () => {
  const held = new Map()
  const shapes = n => ({
    shapes: {
      rings: pack([
        [
          1,
          [
            [
              [0, 0],
              [n, 0],
              [n, n],
            ],
          ],
        ],
      ]),
      covered: { F: pack([]), B: pack([]) },
      openings: { F: pack([]), B: pack([]) },
    },
  })
  let builds = 0
  let shown
  const take = m => {
    const { site } = takeFacet(held, m)
    if (!site) return
    if (remakes(shown, site)) builds++
    shown = site
  }
  take(msg('meta', meta, 1))
  take(msg('layers', layers, 1))
  take(msg('shapes', shapes(1), 1))
  take(msg('model', { models: [] }, 1))
  assert.equal(builds, 3, 'the meta, the shapes and the model; the layers rows alone remake nothing')
  take(msg('findings', { drc: [], erc: [], ratsnest: [], unconnected: 0 }, 1))
  take(msg('fab', { bom: [], fab: { url: '', name: '', files: [], status: 'ok' }, svgUrl: '' }, 1))
  take(msg('shapes', shapes(1), 2))
  assert.equal(builds, 3, 'findings, fab and shapes of the same hash leave the scene')
  take(msg('shapes', shapes(2), 3))
  assert.equal(builds, 4)
})

test('an edit is stale until the facet that resolves it is newer than the run it was computed from', () => {
  const held = new Map()
  let site = takeFacet(held, msg('meta', meta, 1)).site
  site = takeFacet(held, msg('layers', layers, 1)).site
  const inv = { board: 'B', run: 1, refs: ['R1', 'net:GND'], uids: ['a', 't'], findings: ['drc:x:1'] }
  let st = staleOf(held.get('B'), site, inv)
  assert.deepEqual([[...st.ids], [...st.refs], [...st.nets], [...st.findings]], [[1, 2], ['R1'], ['GND'], ['drc:x:1']])
  // place ends: the part snaps back, its copper carried from the last compile stays stale
  site = takeFacet(held, msg('meta', meta, 2)).site
  site = takeFacet(held, msg('layers', { ...layers, carried: ['t'] }, 2)).site
  st = staleOf(held.get('B'), site, inv)
  assert.deepEqual([[...st.ids], [...st.refs]], [[2], []])
  site = takeFacet(held, msg('layers', layers, 2)).site
  assert.equal(staleOf(held.get('B'), site, inv).ids.size, 0)
})

test('the four conditions: a missing frame, another hash of the same run, behind with nothing pending, an unknown entity', () => {
  const seq = seqTracker()
  assert.equal(seq.see(5), null, 'the first frame seen starts the count')
  assert.equal(seq.see(6), null)
  assert.deepEqual(seq.see(8), { expected: 7, got: 8 })
  seq.reset()
  assert.equal(seq.see(1), null, 'a reconnect starts again')

  const held = new Map()
  const site = takeFacet(held, msg('meta', meta, 2)).site
  const h = facetHash(meta)
  assert.equal(compareState(held, { project: '/p', run: 2, facets: { 'meta:B': h }, pending: false }), null)
  assert.equal(compareState(held, { project: '/p', run: 2, facets: { 'meta:B': 'f'.repeat(16) }, pending: false }).condition, 'hash')
  assert.equal(compareState(held, { project: '/p', run: 3, facets: { 'meta:B': 'f'.repeat(16) }, pending: true }), null, 'a compile on its way')
  assert.equal(compareState(held, { project: '/p', run: 3, facets: { 'meta:B': 'f'.repeat(16) }, pending: false }).condition, 'behind')
  assert.equal(compareState(held, { project: '/p', run: 1, facets: { 'meta:B': 'f'.repeat(16) }, pending: false }), null, 'newer than the session, a compile of some views')

  takeFacet(held, msg('layers', layers, 2))
  const inv = { board: 'B', run: 2, refs: ['R9'], uids: [], findings: [] }
  assert.equal(unknownIn(held.get('B'), site, inv).condition, 'unknown')
  assert.equal(unknownIn(held.get('B'), site, { ...inv, refs: ['R1', 'net:GND'], uids: ['a'] }), null)
  assert.equal(unknownIn(held.get('B'), site, { ...inv, run: 1 }), null, 'only at the run it holds')
})

test('a board that came whole hashes its facets only when asked, as the session does', () => {
  const site = joinSite({ meta, layers })
  const b = liveOf(facetSet(JSON.parse(JSON.stringify(site))), 5)
  assert.equal(b.facets.meta.hash, null)
  const parts = splitSite(site)
  const st = { project: '/p', run: 5, facets: Object.fromEntries(Object.entries(parts).map(([f, d]) => [`${f}:B`, facetHash(d)])), pending: false }
  assert.equal(compareState(new Map([['B', b]]), st), null)
})

test('three incidents within a minute repeat', () => {
  assert.equal(repeated([0, 10_000], 20_000), false)
  assert.equal(repeated([0, 10_000, 20_000], 30_000), true)
  assert.equal(repeated([0, 10_000, 20_000], 65_000), false)
})

test('an edit makes every facet of a run up to its `edit` stale, whatever reached the page before the cancel', () => {
  const held = new Map()
  takeFacet(held, msg('meta', meta, 1))
  takeInvalidate(held, { board: 'B', run: 1, refs: [], uids: [], findings: [], edit: 3 })
  assert.equal(takeFacet(held, msg('layers', layers, 3)).dropped, true, 'the cancelled compile of run 3')
  assert.ok(!takeFacet(held, msg('layers', layers, 4)).dropped, 'a compile after the edit')
})

test('a keystroke sketch draws the entity over the layers and hides what it replaces until a newer layers facet, the rest of the board not stale', () => {
  const held = new Map()
  takeFacet(held, msg('meta', meta, 1))
  takeFacet(held, msg('layers', { ...layers, layers: [{ id: 'F.Cu', svg: '<g/>' }] }, 1))
  const sketch = { layers: [{ id: 'F.Cu', svg: '<path data-id="9"/>' }], items: [{ id: 9, uid: 'a2', kind: 'pad' }] }
  const { site } = takeFacet(held, { ...msg('layers', sketch, 2), stage: 'keystroke', partial: { replaces: ['a'] } })
  assert.equal(site.layers[0].svg, '<g/><path data-id="9"/>')
  assert.deepEqual(
    site.items.map(it => it.id),
    [1, 2, 9],
  )
  const st = staleOf(held.get('B'), site, undefined)
  assert.deepEqual([...st.gone], [1], 'the pad it replaces')
  assert.deepEqual([...st.ids], [], 'neither the sketch nor the rest of the board')
  assert.equal(takeFacet(held, { ...msg('layers', sketch, 1), partial: { replaces: [] } }).dropped, true, 'an older sketch')
  const full = takeFacet(held, msg('layers', layers, 3)).site
  assert.equal(full.items.length, 2, 'the full compile ends the sketch')
  assert.deepEqual(staleOf(held.get('B'), full, undefined), { ids: new Set(), refs: new Set(), nets: new Set(), findings: new Set(), gone: new Set() })
})

test('with a sketch standing, an invalidate of one part makes only that part stale', () => {
  const two = {
    ...layers,
    items: [
      { id: 1, uid: 'a', kind: 'pad', ref: 'R1', net: 'GND' },
      { id: 3, uid: 'a1', kind: 'pad', ref: 'R1', net: 'VCC' },
      { id: 4, uid: 'b', kind: 'pad', ref: 'R2', net: 'GND' },
      { id: 2, uid: 't', kind: 'track', net: 'GND' },
    ],
  }
  const held = new Map()
  takeFacet(held, msg('meta', meta, 1))
  takeFacet(held, msg('layers', two, 1))
  const sketch = { layers: [], items: [{ id: 9, uid: 'a2', kind: 'pad', ref: 'R1' }] }
  const { site } = takeFacet(held, { ...msg('layers', sketch, 2), stage: 'keystroke', partial: { replaces: ['a'] } })
  const seeded = staleOf(held.get('B'), site, undefined)
  assert.deepEqual([[...seeded.ids], [...seeded.refs], [...seeded.nets], [...seeded.gone]], [[], ['R1'], ['GND'], [1]], 'before its invalidate, what the sketch replaces')
  const inv = { board: 'B', run: 1, refs: ['R1'], uids: ['a', 'a1'], findings: [] }
  const st = staleOf(held.get('B'), site, inv)
  assert.deepEqual([...st.ids], [3], "R1's other pad; its replaced pad gone, the sketch drawn, R2 and the track untouched")
  assert.deepEqual([...st.refs], ['R1'])
  assert.deepEqual([...st.gone], [1])
})

test('a committed drag is drawn where it went from the commit until each facet that draws it there comes, never where it was', () => {
  const at = (x, y, r = 0) => ({ ...meta, footprints: [{ ...meta.footprints[0], at: [x, y], rot: r }], edit: [{ ref: 'R1', caps: ['placed'], at: [x, y, r] }] })
  const held = new Map()
  takeFacet(held, msg('meta', at(1, 1), 1))
  takeFacet(held, msg('layers', layers, 1))
  const u = { delta: [2, 0], angle: 90 }
  const hold = holdOf(held.get('B'))
  /** R1 as each facet draws it: the bodies and the ring from meta's edit node, the 2D drawing from layers, which still has it at 1 1 until s.4 */
  const pose = () => {
    const b = held.get('B')
    const fromMeta = b.facets.meta.data.edit[0].at
    const fromLayers = b.facets.layers.run === 4 ? [3, 1, 90] : [1, 1, 0]
    return { meta: drawnPose(fromMeta, u, holding(b, hold, 'meta')), layers: drawnPose(fromLayers, u, holding(b, hold, 'layers')) }
  }
  const there = { meta: [3, 1, 90], layers: [3, 1, 90] }
  assert.deepEqual(pose(), there, 'the commit')
  takeInvalidate(held, { board: 'B', run: 1, refs: ['R1'], uids: ['a'], findings: [], edit: 2 })
  assert.deepEqual(pose(), there, 'the invalidate')
  // a compile the edit made stale is dropped, so it never draws the old pose
  assert.equal(takeFacet(held, msg('meta', at(1, 1), 2)).dropped, true)
  const sketch = { layers: [], items: [{ id: 9, uid: 'a', kind: 'pad', ref: 'R1' }] }
  takeFacet(held, { ...msg('layers', sketch, 3), partial: { replaces: ['a'] } })
  assert.deepEqual(pose(), there, 'the sketch')
  assert.deepEqual([...sketchIds(held.get('B'))], [9], 'the sketch draws its own items where they go, never moved again')
  takeFacet(held, msg('meta', at(3, 1, 90), 4))
  assert.equal(holding(held.get('B'), hold, 'meta'), false, 'meta draws the result')
  assert.equal(holding(held.get('B'), hold, 'layers'), true, 'the layers still draw the old pose, held')
  assert.deepEqual(pose(), there, 'the meta facet')
  takeFacet(held, msg('layers', layers, 4))
  assert.equal(holding(held.get('B'), hold, 'layers'), false)
  assert.deepEqual(pose(), there, 'the full facet')
})
