// reference-collision between two references of one board: two referenced strips that butt on a splice board are checked
// against each other, slab and bodies, as each is checked against the board itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, reference } from '@pcbjs/core'
import { compileBoard } from '../dist/index.js'

const T = 1.6
/** a 30 by 10 mm strip with one 2 mm tall body at (25, 5), as a resolver hands it over */
const strip = name => ({
  entry: `/stack/${name}/pcb.tsx`,
  name,
  title: name,
  revision: '1',
  thickness: T,
  outline: [
    [
      [0, 0],
      [30, 0],
      [30, 10],
      [0, 10],
    ],
  ],
  drills: [],
  footprints: [{ ref: 'U1', at: [25, 5], rot: 0, side: 'F', height: 2, body: { x: 25, y: 5, w: 4, h: 4, rot: 0 }, pads: [] }],
  hash: 'f'.repeat(64),
  files: [`/stack/${name}/pcb.tsx`],
  graph: {},
  status: 'ok',
})
const compile = (ats, rb = strip('strip')) =>
  compileBoard(h(PCB, { name: 'splice' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 80, h: 20 }), ...ats.map(at => reference('../strip/pcb.tsx', { at }))), {
    references: { resolve: () => rb },
    routeCache: false,
  })
const collisions = b => b.drc.filter(d => d.rule === 'reference-collision').map(d => d.message)

test('reference-collision: two references that butt pass, two that overlap name both', () => {
  // the strips 10 mm over the splice board, end to end with a 0.4 mm seam
  assert.deepEqual(
    collisions(
      compile([
        [0, 5, 10],
        [30.4, 5, 10],
      ]),
    ),
    [],
  )
  // pushed 0.5 mm into each other: the second's slab reaches into the first's
  assert.deepEqual(
    collisions(
      compile([
        [0, 5, 10],
        [29.5, 5, 10],
      ]),
    ),
    ["strip #2's board reaches 1.60 mm into strip #1's board"],
  )
  // the second strip 2 mm higher and over the first's body: its slab meets that body, not the first slab
  assert.deepEqual(
    collisions(
      compile(
        [
          [0, 5, 10],
          [20, 5, 12],
        ],
        strip('left'),
      ),
    ),
    ["left #2's board reaches 1.60 mm into left #1 U1 body"],
  )
})
