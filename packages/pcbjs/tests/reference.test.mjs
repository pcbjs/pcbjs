// Board references, see docs/references.md: the mate transform for both stacks, the anchor form, the two DRC rules and the
// errors, with a resolver that hands over a referenced board directly instead of compiling one in a child process.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets as netsOf, reference } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { apply4 } from '@pcbjs/compile/reference'
import { PinHeader } from '@pcbjs/lib'
import { near } from './helpers.mjs'

const outline = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 40, h: 40 })
const T = 1.6

/** A referenced board with one part: `pads` in its own board mm. */
const remote = (fp, extra = {}) => ({
  entry: '/stack/remote/pcb.tsx', name: 'remote', title: 'Remote', revision: '1', thickness: T,
  outline: [[[0, 0], [30, 0], [30, 30], [0, 30]]], drills: [{ x: 2, y: 2, d: 3 }],
  footprints: [{ height: 0, body: { x: fp.at[0], y: fp.at[1], w: 1, h: 1, rot: 0 }, ...fp }],
  hash: 'f'.repeat(64), files: ['/stack/remote/pcb.tsx'], graph: {}, status: 'ok', ...extra,
})
const resolver = rb => ({ resolve: () => rb })
const compile = (rb, ...kids) => compileBoard(h(PCB, { name: 'local' }, outline(), ...kids), { references: resolver(rb), routeCache: false })
const marks = (b, rule) => b.drc.filter(d => d.rule === rule)
/** where a point of the referenced board lands, as board mm and z */
const land = (r, [x, y], z = 0) => { const q = apply4(r.transform, [x, -y, z]); return [q[0], -q[1], q[2]] }

const fourPins = (x, y) => ({ ref: 'J1', at: [x, y], rot: 0, side: 'F', pads: [0, 1, 2, 3].map(k => ({ num: String(k + 1), name: String(k + 1), at: [x, y + 2.54 * k] })) })

test('reference: below, a socket on the back mates a header on the other board\'s front, face to face at the connector height', () => {
  const J = PinHeader(4)
  const b = compile(remote(fourPins(5, 5)), h(J, { at: '10 10 180deg', side: 'B' }), reference('../remote/pcb.tsx', { mate: { local: J, remote: 'J1', pin: 1 }, stack: 'below' }))
  const [r] = b.references
  assert.deepEqual(r.anchor, { kind: 'mate', local: 'J1.1', remote: 'J1.1' })
  assert.equal(r.gap, 8.5, 'the default gap is the local connector height')
  // the remote pin lands on the local one, its top face 8.5 under this board's bottom face, the board half a turn round
  const pin = land(r, [5, 5], T)
  near(pin[0], 10, 1e-9); near(pin[1], 10, 1e-9); near(pin[2], -8.5, 1e-9)
  const o = land(r, [0, 0], 0)
  near(o[0], 15, 1e-9); near(o[1], 15, 1e-9); near(o[2], -8.5 - T, 1e-9)
  near(r.z[0], -8.5 - T, 1e-9); near(r.z[1], -8.5, 1e-9)
  assert.ok(r.transform[10] > 0, 'not upside down: both boards face the same way')
  assert.deepEqual(marks(b, 'reference-mate'), [])
})

test('reference: above, a pogo pin mates a test pad on the back of the board lying on it', () => {
  const P = PinHeader(1)
  const tp = { ref: 'TP1', at: [3, 4], rot: 0, side: 'B', pads: [{ num: '1', name: '1', at: [3, 4] }] }
  const b = compile(remote(tp), h(P, { at: '20 20' }), reference('../remote/pcb.tsx', { mate: { local: P, remote: 'TP1' }, gap: 16 }))
  const [r] = b.references
  assert.equal(r.stack, 'above')
  // the same orientation: no turn and no flip, the remote bottom face 16 over this board's top face
  near(r.transform[0], 1); near(r.transform[5], 1); near(r.transform[10], 1)
  const o = land(r, [0, 0], 0)
  near(o[0], 17, 1e-9); near(o[1], 16, 1e-9); near(o[2], T + 16, 1e-9)
  assert.deepEqual(marks(b, 'reference-mate'), [])
})

test('reference: above with both connectors on the front turns the other board over about the pin\'s y axis', () => {
  const J = PinHeader(1)
  const b = compile(remote({ ref: 'J9', at: [4, 4], rot: 0, side: 'F', pads: [{ num: '1', name: '1', at: [4, 4] }] }), h(J, { at: '10 10' }), reference('r.tsx', { mate: { local: J, remote: 'J9' }, gap: 5 }))
  const [r] = b.references
  near(r.transform[0], -1); near(r.transform[10], -1)
  const pin = land(r, [4, 4], T)
  near(pin[0], 10, 1e-9); near(pin[1], 10, 1e-9); near(pin[2], T + 5, 1e-9)
})

test('reference-mate: a pin that lands off the local pads is an error naming it, with the turn that would fit', () => {
  const J = PinHeader(4)
  const wide = { ...fourPins(5, 5), pads: [0, 1, 2, 3].map(k => ({ num: String(k + 1), name: String(k + 1), at: [5, 5 + 3 * k] })) }
  const [m] = marks(compile(remote(wide), h(J, { at: '10 10 180deg', side: 'B' }), reference('r.tsx', { mate: { local: J, remote: 'J1' }, stack: 'below' })), 'reference-mate')
  assert.equal(m.severity, 'error')
  assert.match(m.message, /^remote J1 pin 2 lands 0\.46 mm from the nearest pad of J1, 3 of 4 pins miss$/)
  const J2 = PinHeader(4)
  const [t] = marks(compile(remote(fourPins(5, 5)), h(J2, { at: '10 10 180deg', side: 'B' }), reference('r.tsx', { mate: { local: J2, remote: 'J1' }, stack: 'below', rotate: 180 })), 'reference-mate')
  assert.match(t.message, /; rotate: 0 lands every pin$/)
})

test('reference-collision: a referenced body reaching into this board or a part is a warning naming both', () => {
  const J = PinHeader(1)
  const tall = { ref: 'C1', at: [10, 10], rot: 0, side: 'F', height: 12, body: { x: 10, y: 10, w: 4, h: 4, rot: 0 }, pads: [{ num: '1', name: '1', at: [10, 10] }] }
  const rb = remote({ ref: 'J9', at: [4, 4], rot: 0, side: 'F', pads: [{ num: '1', name: '1', at: [4, 4] }] })
  rb.footprints.push(tall)
  const b = compile(rb, h(J, { at: '10 10' }), reference('r.tsx', { mate: { local: J, remote: 'J9' }, gap: 5 }))
  const m = marks(b, 'reference-collision')
  assert.ok(m.length >= 1, JSON.stringify(b.drc))
  assert.ok(m.every(x => x.severity === 'warning'))
  assert.ok(m.some(x => /^remote C1 body reaches [\d.]+ mm into this board's slab$/.test(x.message)), m.map(x => x.message).join('\n'))
  // the mated pair itself never counts
  assert.ok(!m.some(x => /J9/.test(x.message)))
})

test('reference: the anchor form puts the origin at x, y and the bottom face at z, or the top face with flip', () => {
  const b = compile(remote(fourPins(5, 5)), h('g', { at: '2 3' }, reference('r.tsx', { at: [1, 1, 12] })), reference('r.tsx', { at: [0, 0, -2], flip: true }))
  const [a, f] = b.references
  assert.deepEqual(a.anchor, { kind: 'at', at: [1, 1, 12] })
  const o = land(a, [0, 0], 0)
  near(o[0], 3, 1e-9); near(o[1], 4, 1e-9); near(o[2], 12, 1e-9)
  near(land(f, [0, 0], T)[2], -2, 1e-9)
  near(f.transform[10], -1)
  assert.deepEqual(b.drc.filter(d => d.rule.startsWith('reference')), [])
})

test('reference: errors name the call: a missing part, a resolver failure such as a cycle, and no resolver', () => {
  const J = PinHeader(2)
  assert.throws(() => compile(remote(fourPins(5, 5)), h(J, { at: '10 10' }), reference('r.tsx', { mate: { local: J, remote: 'J7' } })), /reference\("r\.tsx"\): remote has no part J7/)
  const cyc = { resolve: () => { throw new Error('a reference cycle: controller → driver → controller') } }
  assert.throws(() => compileBoard(h(PCB, { name: 'local' }, outline(), reference('../driver/pcb.tsx', { at: [0, 0, 0] })), { references: cyc, routeCache: false }), /reference\("\.\.\/driver\/pcb\.tsx"\): a reference cycle: controller → driver → controller/)
  assert.throws(() => compileBoard(h(PCB, { name: 'local' }, outline(), reference('r.tsx', { at: [0, 0, 0] })), { routeCache: false }), /references compile through the pcbjs command line/)
})

test('reference: nothing reaches the copper: the board items are those of the same board without it', () => {
  const J = PinHeader(4)
  const kids = () => [h(J, { at: '10 10 180deg', side: 'B' })]
  const plain = compileBoard(h(PCB, { name: 'local' }, outline(), ...kids()), { routeCache: false })
  const withRef = compile(remote(fourPins(5, 5)), ...kids(), reference('r.tsx', { mate: { local: J, remote: 'J1' }, stack: 'below' }))
  assert.deepEqual(withRef.items.map(i => [i.kind, i.layer]), plain.items.map(i => [i.kind, i.layer]))
})

// ---- body heights from model boxes ----

/** A part with a model file and no height, at 10 10, its body a 2 mm pad. */
const modelled = (props = {}) => h('footprint', { ref: 'U1', at: '10 10', model: { file: '/models/u1.step' }, ...props }, h('pad', { num: 1, size: 2 }))
const box = top => ({ min: [-1, -1, 0], max: [1, 1, top] })

test('reference heights: a part with a model file and no height takes the top of its model box, the height wins, else 1 mm', () => {
  // the other board's bottom face 3 mm over this board's top face
  const above = () => reference('r.tsx', { at: [0, 0, T + 3] })
  const run = (props, modelBox) => compileBoard(h(PCB, { name: 'local' }, outline(), modelled(props), above()), { references: resolver(remote(fourPins(25, 25))), routeCache: false, ...(modelBox ? { modelBox } : {}) })
  const seen = []
  const tall = run({}, spec => { seen.push(spec.path); return box(5) })
  assert.deepEqual(seen, ['/models/u1.step'], 'the loader gets the resolved path')
  assert.deepEqual(tall.references[0].heights, [{ ref: 'U1', height: 5, from: 'model' }])
  const [m] = marks(tall, 'reference-collision')
  assert.match(m?.message ?? '', /^remote's board reaches 1\.60 mm into U1$/)
  // without a loader, or a loader with no box, the default 1 mm stays clear
  for (const b of [run({}), run({}, () => null)]) {
    assert.deepEqual(b.references[0].heights, [{ ref: 'U1', height: 1, from: 'default' }])
    assert.deepEqual(marks(b, 'reference-collision'), [])
  }
  // a height on the footprint wins over the model box
  const set = run({ height: 2 }, () => box(5))
  assert.deepEqual(set.references[0].heights, [{ ref: 'U1', height: 2, from: 'height' }])
  assert.deepEqual(marks(set, 'reference-collision'), [])
})

test('reference heights: the remote bodies carry where their heights come from', () => {
  const J = PinHeader(1)
  const rb = remote({ ref: 'J9', at: [4, 4], rot: 0, side: 'F', pads: [{ num: '1', name: '1', at: [4, 4] }] })
  rb.footprints.push({ ref: 'U5', at: [20, 20], rot: 0, side: 'F', height: 3.2, heightFrom: 'model', body: { x: 20, y: 20, w: 4, h: 4, rot: 0 }, pads: [] })
  const b = compile(rb, h(J, { at: '10 10' }), reference('r.tsx', { mate: { local: J, remote: 'J9' }, gap: 5 }))
  const u5 = b.references[0].bodies.find(x => x.ref === 'U5')
  assert.equal(u5.from, 'model')
  near(u5.z[1] - u5.z[0], 3.2, 1e-9)
  assert.equal(b.references[0].gapFrom, 'gap')
})

// ---- nets across the mate ----

const netPins = (x, y, names) => ({ ...fourPins(x, y), pads: names.map((n, k) => ({ num: String(k + 1), name: String(k + 1), at: [x, y + 2.54 * k], ...(n ? { net: n } : {}) })) })

test('reference-net: with nets the net of every local pad of the mating part is compared with the remote pad on it', () => {
  const mateWith = (remoteNets, nets, localNets = ['V5', 'GND', 'SDO', 'GND_A']) => {
    const N = netsOf()
    const J = PinHeader(4).connect(Object.fromEntries(localNets.map((n, i) => [i + 1, n]).filter(([, n]) => n).map(([k, n]) => [k, N[n]])))
    return compile(remote(netPins(5, 5, remoteNets)), h(J, { at: '10 10 180deg', side: 'B' }), reference('r.tsx', { mate: { local: J, remote: 'J1', ...(nets === undefined ? {} : { nets }) }, stack: 'below' }))
  }
  const same = ['V5', 'GND', 'SDO', 'GND_A']
  assert.deepEqual(marks(mateWith(same, true), 'reference-net'), [])
  // off by default
  assert.deepEqual(marks(mateWith(['V5', 'GND', 'SDI', 'GND'], undefined), 'reference-net'), [])
  // true: same names; a mismatch names both parts, both pins and both nets
  const bad = marks(mateWith(['V5', 'GND', 'SDI', 'GND'], true), 'reference-net')
  assert.deepEqual(bad.map(m => m.message), ['J1 pin 3 net SDO meets remote J1 pin 3 net SDI', 'J1 pin 4 net GND_A meets remote J1 pin 4 net GND'])
  assert.ok(bad.every(m => m.severity === 'error'))
  // an object maps local names to remote ones, the rest stay
  assert.deepEqual(marks(mateWith(['V5', 'GND', 'SDI', 'GND'], { SDO: 'SDI', GND_A: 'GND' }), 'reference-net'), [])
  const [o] = marks(mateWith(['V5', 'GND', 'SDO', 'GND'], { SDO: 'SDI', GND_A: 'GND' }), 'reference-net')
  assert.equal(o.message, 'J1 pin 3 net SDO meets remote J1 pin 3 net SDO; the mate maps SDO to SDI')
  // a list: the local net may meet any of the names
  assert.deepEqual(marks(mateWith(['V5', 'GND', 'LBAK', 'GND'], { SDO: ['SDI', 'LBAK'], GND_A: 'GND' }), 'reference-net'), [])
  assert.equal(marks(mateWith(['V5', 'GND', 'SDO', 'GND'], { SDO: ['SDI', 'LBAK'], GND_A: 'GND' }), 'reference-net')[0]?.message, 'J1 pin 3 net SDO meets remote J1 pin 3 net SDO; the mate maps SDO to SDI or LBAK')
  assert.throws(() => mateWith(same, { SDO: [] }), /each value must be the remote net name or a list/)
  // a function folds GND_* to GND
  assert.deepEqual(marks(mateWith(['V5', 'GND', 'SDO', 'GND'], n => n.replace(/^GND_.*$/, 'GND')), 'reference-net'), [])
  // a pad with no net on either side is a no-connect and is not checked
  assert.deepEqual(marks(mateWith(['V5', '', 'SDO', 'GND_A'], true), 'reference-net'), [])
  assert.deepEqual(marks(mateWith(['V5', 'X', 'SDO', 'GND_A'], true, ['V5', '', 'SDO', 'GND_A']), 'reference-net'), [])
  // a bad mapping is a compile error naming the call
  assert.throws(() => mateWith(same, 'yes'), /mate\.nets must be true, an object/)
  assert.throws(() => mateWith(same, n => 3), /mate\.nets returned 3/)
})

test('reference: an unknown mate option is an error, so a typo does not turn a check off', () => {
  const J = PinHeader(4)
  assert.throws(() => compile(remote(fourPins(5, 5)), h(J, { at: '10 10 180deg', side: 'B' }), reference('r.tsx', { mate: { local: J, remote: 'J1', net: true }, stack: 'below' })), /mate has an unknown option "net"/)
})

// ---- several mating pairs ----

test('reference: mate takes several pairs, the first places the board, every pair is checked and left out of the collisions', () => {
  const J3 = PinHeader(2), J4 = PinHeader(2)
  // the remote board's J1 and J2, 20 mm apart, 2 mm tall, so 9 mm under this board they reach into the 8.5 mm headers;
  // the board turns half round under the back, so its J1 at x 25 lands on J3 at x 10 and its J2 at x 5 on J4 at x 30
  const conn = (ref, x, dy = 0) => ({ ref, at: [x, 5 + dy], rot: 0, side: 'F', height: 2, body: { x, y: 6.27 + dy, w: 2.54, h: 5.08, rot: 0 }, pads: [0, 1].map(k => ({ num: String(k + 1), name: String(k + 1), at: [x, 5 + dy + 2.54 * k] })) })
  const two = (dy = 0) => { const rb = remote(conn('J1', 25)); rb.footprints = [conn('J1', 25), conn('J2', 5, dy)]; return rb }
  const run = (rb, mate) => compile(rb, h(J3, { at: '10 10 180deg', side: 'B' }), h(J4, { at: '30 10 180deg', side: 'B' }), reference('r.tsx', { mate, stack: 'below', gap: 9 }))
  const one = run(two(), { local: J3, remote: 'J1' })
  assert.ok(marks(one, 'reference-collision').some(m => /^remote J2 body reaches [\d.]+ mm into J2 on the back$/.test(m.message)), 'with one pair the second connector collides')
  const b = run(two(), [{ local: J3, remote: 'J1', pin: 1 }, { local: J4, remote: 'J2' }])
  const [r] = b.references
  assert.deepEqual(r.anchor, { kind: 'mate', local: 'J1.1', remote: 'J1.1' })
  assert.deepEqual(r.mates.map(m => `${m.local.ref}>${m.remote.ref}`), ['J1>J1', 'J2>J2'])
  assert.equal(r.mate, r.mates[0])
  assert.deepEqual(marks(b, 'reference-collision'), [])
  assert.deepEqual(marks(b, 'reference-mate'), [])
  // the second pair off by 1 mm is a reference-mate error naming it
  const [m] = marks(run(two(1), [{ local: J3, remote: 'J1' }, { local: J4, remote: 'J2' }]), 'reference-mate')
  assert.match(m?.message ?? '', /^remote J2 pin \d lands 1\.00 mm from the nearest pad of J2/)
  // the first pair's nets carry to a pair without its own
  const N = netsOf()
  const K3 = PinHeader(2).connect({ 1: N.A, 2: N.B }), K4 = PinHeader(2).connect({ 1: N.C, 2: N.D })
  const rb = two()
  rb.footprints[0].pads.forEach((q, i) => { q.net = ['A', 'B'][i] })
  rb.footprints[1].pads.forEach((q, i) => { q.net = ['C', 'X'][i] })
  const nb = compile(rb, h(K3, { at: '10 10 180deg', side: 'B' }), h(K4, { at: '30 10 180deg', side: 'B' }), reference('r.tsx', { mate: [{ local: K3, remote: 'J1', nets: true }, { local: K4, remote: 'J2' }], stack: 'below', gap: 9 }))
  assert.deepEqual(marks(nb, 'reference-net').map(x => x.message), ['J2 pin 2 net D meets remote J2 pin 2 net X'])
  assert.throws(() => run(two(), []), /mate needs at least one pair/)
})
