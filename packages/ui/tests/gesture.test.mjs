// The gesture model's pose on a fake board: a move and a ring turn each a Pose of the anchor's parts and its items of no part, held per
// facet after the commit until that facet draws the result; a flip is no pose, the facets draw it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { fixture } from './fixture-board.mjs'

registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
const { nextTick, reactive } = await import('vue')
const { createViewer } = await import('../src/shell.ts')
const { facetSet } = await import('@pcbjs/core/site-facets')
const { useGesture } = await import('../src/gesture.ts')

/** The fixture with CH1 placed at 1 5 on grid g, 1 mm with halves, drawing R1 and the track of route:1, in dev. */
function board() {
  const b = fixture()
  b.dev = { snapshot: 's1' }
  b.grids = [{ name: 'g', pitch: 1, minor: [2], origin: [0, 0], angle: 0, mirror: false, frame: null }]
  b.edit = [{ ref: 'CH1', caps: ['placed', 'layered'], src: { at: { file: 'pcb.tsx', line: 3, col: 5 } }, m: [1, 0, 0, 1, 0, 0], grid: 'g', at: [1, 5, 0], side: 'F' }]
  return b
}

function gesture(b = board(), selected = { refs: ['CH1'], anchor: 'CH1' }) {
  const calls = []
  const client = {
    begin: async p => (calls.push(['begin', p]), { txn: 't1', tools: [] }),
    update: async (txn, u) => (calls.push(['update', u]), { files: [], notes: [] }),
    commit: async () => (calls.push(['commit']), { written: [{ file: 'pcb.tsx', via: 'editor', applied: true }] }),
    cancel: async () => (calls.push(['cancel']), null),
  }
  const store = createViewer({ boards: [facetSet(b)], single: true, path: '/', baseUrl: '/' }).board(b.name)
  store.edit.client = client
  store.edit.mode = { mode: 'rw', editor: true }
  const g = useGesture({
    board: () => b,
    sel: () => selected,
    drawn: () => ({ parts: new Set(['R1']), anchor: { ids: new Set([1, 2, 9]) } }),
    boardAt: e => e.at,
    px: () => 0.05,
    vb: () => [0, 0, 30, 30],
    store,
  })
  return { b, g, store, calls }
}
const ev = (at, mods = {}) => ({ at, button: 0, pointerId: 1, clientX: at[0] * 100, clientY: at[1] * 100, shiftKey: false, metaKey: false, ctrlKey: false, ...mods })
const tick = async () => {
  await nextTick()
  await new Promise(r => setTimeout(r, 0))
}
const plain = p => p && { ...p, parts: [...p.parts], ids: [...p.ids] }

test('a move: the anchor’s parts and its items of no part, snapped, drawn over both facets while it lasts', async () => {
  const { g } = gesture()
  assert.equal(g.pose.value, null)
  assert.equal(g.down(ev([1.2, 5.1]), { ref: 'R101' }), true)
  g.move(ev([3.27, 6.04]))
  assert.deepEqual(plain(g.pose.value), { parts: ['R101'], ids: [9], origin: [1, 5], delta: [2, 1], angle: 0, held: { meta: true, layers: true }, done: false })
  g.move(ev([3.27, 6.04], { shiftKey: true }))
  assert.deepEqual(
    g.pose.value.delta.map(v => Math.round(v * 100) / 100),
    [2.07, 0.94],
    'shift moves free',
  )
  g.cancel()
  assert.equal(g.pose.value, null, 'Escape draws it back')
})

test('a ring turn: the angle about the anchor’s origin, the ring drawn at it', async () => {
  const { g } = gesture()
  const at = deg => [1 + 3 * Math.cos((deg * Math.PI) / 180), 5 - 3 * Math.sin((deg * Math.PI) / 180)]
  assert.equal(g.down(ev(at(0)), { tool: 'ring' }), true)
  g.move(ev(at(50)))
  assert.deepEqual(plain(g.pose.value), { parts: ['R101'], ids: [9], origin: [1, 5], delta: [0, 0], angle: 45, held: { meta: true, layers: true }, done: false })
  assert.equal(g.ring.value.c.join(), '1,5')
})

test('after the commit the pose holds per facet until the facet that draws the result comes, then ends', async () => {
  const { g, store, calls } = gesture()
  g.down(ev([1, 5]), { ref: 'R101' })
  g.move(ev([4, 5]))
  assert.equal(g.up(), 'drag')
  await tick()
  assert.equal(calls.at(-1)[0], 'commit')
  assert.deepEqual(plain(g.pose.value), { parts: ['R101'], ids: [9], origin: [1, 5], delta: [3, 0], angle: 0, held: { meta: true, layers: true }, done: true })
  assert.deepEqual(g.ring.value.c, [4, 5], 'the ring where the part is drawn')
  store.held.set('Fx', { facets: { layers: { run: 7 } } })
  store.rev++
  await tick()
  assert.deepEqual(g.pose.value.held, { meta: true, layers: false }, 'the layers facet draws the result: only the bodies still posed')
  store.held.set('Fx', { facets: { layers: { run: 7 }, meta: { run: 7 } } })
  store.rev++
  await tick()
  assert.equal(g.pose.value, null)
})

test('a flip is no pose: it writes the side and the facets draw it', async () => {
  const { g, calls } = gesture()
  assert.equal(g.command('side'), true)
  assert.equal(g.pose.value, null)
  await tick()
  assert.deepEqual(calls.find(c => c[0] === 'update')[1], { side: 'B' })
  assert.equal(g.pose.value, null)
})

test('a nondefault target exposes its read-only reason and cannot start a drag', () => {
  const b = board()
  b.variant = { name: 'Different', index: 1, names: ['Default', 'Different'] }
  b.edit[0].at = [20, 20, 0]
  const { g, calls } = gesture(b)
  assert.deepEqual(g.tools.value, [])
  assert.match(g.why.value, /target is read-only.*first target/)
  assert.equal(g.down(ev([20, 20]), { ref: 'R101' }), false)
  assert.deepEqual(calls, [])
})

test('multi-selection placement tools dispatch eligible members and leave other selections out', async () => {
  const b = board()
  b.edit.push({ ...b.edit[0], ref: 'CH2', at: [5, 5, 0] })
  const selected = { refs: ['CH1', 'net:GND', 'CH2'], anchor: 'CH1' }
  const { g, calls } = gesture(b, selected)
  assert.deepEqual(g.targets('move').refs, ['CH1', 'CH2'])
  for (const [tool, update] of [
    ['move', { delta: [1, 2] }],
    ['rotate', { angle: 90 }],
    ['layer', { side: 'B' }],
  ]) {
    g.oneShot(tool, update)
    await tick()
    const begin = calls.filter(c => c[0] === 'begin').at(-1)[1]
    assert.deepEqual(begin.refs, ['CH1', 'CH2'], tool)
    assert.equal(begin.anchor, 'CH1')
    assert.deepEqual(calls.filter(c => c[0] === 'update').at(-1)[1], update)
    assert.equal(calls.filter(c => c[0] === 'commit').length, calls.filter(c => c[0] === 'begin').length)
  }
  assert.deepEqual(selected.refs, ['CH1', 'net:GND', 'CH2'], 'non-placeable selection stays selected without being sent for a write')
})

test('a multi-placement ring previews about the session midpoint, including a rotated isolation frame', async () => {
  for (const [a, bpos] of [
    [
      [1, 5, 0],
      [5, 5, 0],
    ],
    [
      [10, 20, 90],
      [10, 24, 90],
    ],
  ]) {
    const b = board()
    b.edit[0].at = a
    b.edit.push({ ...b.edit[0], ref: 'CH2', at: bpos, m: [0, 1, -1, 0, 10, 20] })
    const selection = { refs: ['CH1', 'CH2'], anchor: 'CH1', isolate: { ref: 'CH1' } }
    const { g, calls } = gesture(b, selection)
    const center = [(a[0] + bpos[0]) / 2, (a[1] + bpos[1]) / 2]
    assert.deepEqual(g.ring.value.c, center)
    const before = JSON.stringify(b.edit)
    g.down(ev([center[0] + 3, center[1]]), { tool: 'ring' })
    g.move(ev([center[0], center[1] - 3], { ctrlKey: true }))
    assert.deepEqual(g.pose.value.origin, center)
    assert.equal(g.pose.value.angle, 90)
    g.cancel()
    await tick()
    assert.equal(g.pose.value, null)
    assert.equal(JSON.stringify(b.edit), before)
    assert.equal(calls.filter(c => c[0] === 'commit').length, 0)
    g.down(ev([center[0] + 3, center[1]]), { tool: 'ring' })
    g.move(ev([center[0], center[1] - 3], { ctrlKey: true }))
    assert.deepEqual(g.pose.value.origin, center)
    g.up()
    await tick()
    assert.deepEqual(calls.filter(c => c[0] === 'begin').at(-1)[1].refs, ['CH1', 'CH2'])
    assert.equal(calls.filter(c => c[0] === 'update').at(-1)[1].angle, 90)
    assert.equal(calls.filter(c => c[0] === 'commit').length, 1)
  }
})

test('multi-instance previews include each instance route and text, excluding automatic and isolated own placements', async () => {
  const b = board()
  const item = (id, path, kind, route) => ({
    ...b.items.find(i => i.id === 9),
    id,
    uid: `item:${id.toString(16).padStart(12, '0')}`,
    path,
    kind,
    ...(route ? { route } : { route: undefined }),
  })
  b.items.push(item(12, 'CH1', 'text'), item(13, 'CH2', 'track', 'route:2'), item(14, 'CH2', 'text'), item(15, undefined, 'text'))
  b.routes.push({ ...b.routes[0], id: 'route:2', path: 'CH2' })
  const node = b.edit[0]
  b.edit.push(
    { ...node, ref: 'CH2', at: [5, 5, 0] },
    { ...node, ref: 'R1', auto: ['x'] },
    { ...node, ref: 'R2', owned: 'CH1' },
    { ...node, ref: 'item:00000000000f', caps: ['placed'], at: [8, 5, 0] },
  )
  const selected = { refs: ['CH1', 'CH2', 'R1', 'R2', 'item:00000000000f', 'net:GND'], anchor: 'CH1', isolate: { ref: 'CH1' } }
  const { g, calls } = gesture(b, selected)
  const move = g.targets('move')
  assert.deepEqual(move.refs, ['CH1', 'CH2', 'item:00000000000f'])
  assert.deepEqual([...move.parts], ['R101', 'R201'])
  assert.deepEqual(
    [...move.ids].sort((a, b) => a - b),
    [9, 12, 13, 14, 15],
  )
  assert.deepEqual(g.targets('layer').refs, ['CH1', 'CH2'], 'text without layered capability is not flipped')
  const before = JSON.stringify(b)
  assert.equal(g.down(ev([1, 5]), { ref: 'R101' }), true)
  g.move(ev([3, 5]))
  assert.deepEqual([...g.pose.value.parts], ['R101', 'R201'])
  assert.deepEqual(
    [...g.pose.value.ids].sort((a, b) => a - b),
    [9, 12, 13, 14, 15],
  )
  g.cancel()
  await tick()
  assert.equal(g.pose.value, null)
  assert.equal(calls.filter(c => c[0] === 'commit').length, 0)
  assert.equal(JSON.stringify(b), before, 'cancel preserves all source-derived board data')
  g.oneShot('layer', { side: 'B' })
  await tick()
  assert.deepEqual(calls.filter(c => c[0] === 'begin').at(-1)[1].refs, ['CH1', 'CH2'])
  assert.deepEqual(selected.refs, ['CH1', 'CH2', 'R1', 'R2', 'item:00000000000f', 'net:GND'])
})

test('an excluded automatic or isolation-owned anchor uses the eligible member for pivot and transaction anchor', async () => {
  for (const excluded of [{ auto: ['x'] }, { owned: 'parent' }]) {
    const b = board()
    b.edit[0] = { ...b.edit[0], at: [1, 5, 0], ...excluded }
    b.edit.push({ ...board().edit[0], ref: 'CH2', at: [15, 9, 0] })
    const selected = { refs: ['CH1', 'CH2'], anchor: 'CH1', isolate: { ref: 'parent' } }
    const { g, calls } = gesture(b, selected)
    assert.deepEqual(g.targets('rotate').refs, ['CH2'])
    assert.equal(g.targets('rotate').anchor, 'CH2')
    assert.deepEqual(g.ring.value.c, [15, 9])
    g.down(ev([18, 9]), { tool: 'ring' })
    g.move(ev([15, 6], { ctrlKey: true }))
    assert.deepEqual(g.pose.value.origin, [15, 9])
    g.up()
    await tick()
    assert.equal(calls.find(c => c[0] === 'begin')[1].anchor, 'CH2')
    assert.deepEqual(calls.find(c => c[0] === 'begin')[1].refs, ['CH2'])
    g.oneShot('rotate', { angle: 90 })
    await tick()
    assert.equal(calls.filter(c => c[0] === 'begin').at(-1)[1].anchor, 'CH2')
    assert.equal(selected.anchor, 'CH1', 'selection remains unchanged')
  }
})

test('a group turns about its resolved internal grid origin in preview and transaction, including a translated rotated frame', async () => {
  const b = board()
  b.edit[0].at = [12, 8, 90]
  b.edit[0].pivot = [16, 6]
  const { g, calls } = gesture(b)
  assert.deepEqual(g.ring.value.c, [16, 6])
  g.down(ev([20, 6]), { tool: 'ring' })
  g.move(ev([16, 2]))
  assert.deepEqual(g.pose.value.origin, [16, 6])
  assert.equal(g.pose.value.angle, 90)
  g.up()
  await tick()
  assert.equal(calls.find(c => c[0] === 'update')[1].angle, 90)
})

test('default mm grid snaps drags by whole millimetres and shift remains free', () => {
  const b = board()
  b.grids = undefined
  b.edit[0].grid = null
  const { g } = gesture(b)
  g.down(ev([1, 5]), { ref: 'R101' })
  g.move(ev([2.68, 5.28]))
  assert.deepEqual(g.pose.value.delta, [2, 0])
  assert.ok(g.gridDots.value.length)
  g.move(ev([2.68, 5.28], { shiftKey: true }))
  assert.deepEqual(
    g.pose.value.delta.map(x => +x.toFixed(3)),
    [1.68, 0.28],
  )
})

test('the ring passes its angle seam continuously in either direction', () => {
  const { g } = gesture()
  const at = angle => [1 + 3 * Math.cos((angle * Math.PI) / 180), 5 - 3 * Math.sin((angle * Math.PI) / 180)]
  g.down(ev(at(170)), { tool: 'ring' })
  for (const a of [179, 190, 270, 350, 430]) g.move(ev(at(a)))
  assert.equal(g.pose.value.angle, 255)
  for (const a of [350, 270, 190, 170]) g.move(ev(at(a)))
  assert.equal(g.pose.value.angle, 0)
})

test('an off-grid placement starts unsnapped and can explicitly enable its editing grid', () => {
  const b = board()
  b.grids = undefined
  b.edit[0].grid = null
  b.edit[0].at = [1.2, 5.3, 0]
  const { g } = gesture(b)
  g.down(ev([1.2, 5.3]), { ref: 'R101' })
  g.move(ev([2.6, 5.4]))
  assert.equal(g.snapEnabled.value, false)
  assert.deepEqual(
    g.pose.value.delta.map(x => +x.toFixed(3)),
    [1.4, 0.1],
  )
  g.snapOverride.value = true
  g.move(ev([2.6, 5.4]))
  assert.deepEqual(
    g.pose.value.delta.map(x => +x.toFixed(3)),
    [1.8, -0.3],
  )
})

test('persisted placement pitch derives snap and the usable subdivision from unchanged coordinates', () => {
  const b = board()
  b.edit[0].snap = { pitch: 2, maxLevel: 2 }
  b.edit[0].at = [1.5, 5, 0]
  const { g } = gesture(b)
  assert.equal(g.sourceGrid.value.pitch, 2)
  assert.equal(g.snapEnabled.value, true)
  assert.equal(g.paintGrid.value.level, 2)
  const off = board()
  off.edit[0].snap = { pitch: 2, maxLevel: 1 }
  off.edit[0].at = [1.5, 5, 0]
  const next = gesture(off).g
  assert.equal(next.snapEnabled.value, false)
  assert.deepEqual(off.edit[0].at, [1.5, 5, 0])
})

test('snap choice survives refreshed geometry and resets only when the source grid changes', async () => {
  const b = reactive(board())
  b.edit[0].at = [1.23, 5.37, 0]
  const { g } = gesture(b)
  assert.equal(g.snapEnabled.value, false)
  g.snapOverride.value = true
  b.edit = b.edit.map(node => ({ ...node }))
  b.grids = b.grids.map(grid => ({ ...grid, minor: [...grid.minor] }))
  await nextTick()
  assert.equal(g.snapEnabled.value, true)
  b.grids[0].pitch = 2
  await nextTick()
  assert.equal(g.snapOverride.value, null)
  assert.equal(g.snapEnabled.value, false)
})

test('editing waits for the committed snapshot when streamed metadata arrives first', async () => {
  const { g, store } = gesture()
  const live = store.held.get('Fx')
  store.run = 1
  live.facets.meta.run = 1
  store.rev++
  assert.equal(g.rw.value, true)
  live.facets.meta.run = 2
  store.rev++
  assert.equal(g.rw.value, false)
  store.run = 2
  assert.equal(g.rw.value, true)
})
