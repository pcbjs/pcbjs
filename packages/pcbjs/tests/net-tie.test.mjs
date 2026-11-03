// Net ties: pads of one group of a footprint touch by design, without a short, each keeping its own net.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { defineFootprint, nets as netsOf, resetDefaults, route } from '@pcbjs/core'
import { compileBoard, CompileError } from '@pcbjs/compile'
import { fp, handle, netOf, place } from './parts.mjs'

const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 10 })
const board = (...kids) => {
  resetDefaults()
  return compileBoard(h(PCB, { name: 'T' }, edge(), ...kids))
}
// a Kelvin shunt: sense tab 2 sits on current pad 1, tab 3 on pad 4
const shuntPads = () => [
  h('pad', { num: 1, at: '-1.165 0', shape: 'rect', size: [1.57, 1.78] }),
  h('pad', { num: 2, at: '-0.58 0.925', shape: 'rect', size: [0.4, 0.65] }),
  h('pad', { num: 3, at: '0.58 0.925', shape: 'rect', size: [0.4, 0.65] }),
  h('pad', { num: 4, at: '1.165 0', shape: 'rect', size: [1.57, 1.78] }),
]
const nets = { 1: 'HI', 2: 'SP', 3: 'SN', 4: 'LO' }
const Shunt = defineFootprint(
  p =>
    h(
      'footprint',
      {
        netTie: [
          ['1', '2'],
          [3, 4],
        ],
        ...p,
      },
      ...shuntPads(),
    ),
  { pins: ['1', '2', '3', '4'], prefix: 'RS' },
)
const rules = b => b.drc.map(d => d.rule).filter(r => r !== 'single-pad')

test('net tie: the pads of a group overlap without a short; without the tie they short', () => {
  const tied = board(place(Shunt, { ref: 'RS1', at: '10 5', nets }))
  assert.deepEqual(rules(tied), [])
  assert.deepEqual(tied.footprints[0].netTie, [
    ['1', '2'],
    ['3', '4'],
  ])
  assert.deepEqual(
    tied.items.filter(i => i.kind === 'pad').map(p => p.net),
    ['HI', 'SP', 'SN', 'LO'],
    'each pad keeps its net',
  )
  const bare = board(fp({ ref: 'RS1', at: '10 5', nets }, ...shuntPads()))
  assert.deepEqual(rules(bare), ['short', 'short'])
  // netTie given on the <footprint>, and a part made from the factory
  assert.deepEqual(
    rules(
      board(
        fp(
          {
            ref: 'RS1',
            at: '10 5',
            nets,
            netTie: [
              ['1', '2'],
              ['3', '4'],
            ],
          },
          ...shuntPads(),
        ),
      ),
    ),
    [],
  )
  const { HI, SP, SN, LO } = netsOf()
  const part = Shunt('1m', { ref: 'RS1' }).connect({ 1: HI, 2: SP, 3: SN, 4: LO })
  assert.deepEqual(rules(board(h(part, { at: '10 5' }))), [])
})

test('net tie: only pads of one group are tied, and the nets stay distinct for the ratsnest', () => {
  // tie 1 with 3 instead: 1 and 2 short again
  const wrong = board(fp({ ref: 'RS1', at: '10 5', nets, netTie: [['1', '3']] }, ...shuntPads()))
  assert.deepEqual(rules(wrong), ['short', 'short'])
  // SP reaches a far pad only through the tie: still unconnected, the tie does not merge SP into HI
  const b = board(place(Shunt, { ref: 'RS1', at: '10 5', nets }), fp({ ref: 'TP1', at: '3 5', nets: { 1: 'SP' } }, h('pad', { num: 1, size: 1 })))
  assert.equal(b.unconnected, 1)
  assert.deepEqual(
    b.ratsnest.map(r => r.net),
    ['SP'],
  )
})

test('net tie: a route of a tied net does not run through the tie', () => {
  const b = board(
    place(Shunt, { ref: 'RS1', at: '10 5', nets }),
    fp({ ref: 'TP1', at: '3 5', nets: { 1: 'LO' } }, h('pad', { num: 1, size: 1 })),
    route(handle('TP1.1'), handle('RS1.4')).net(netOf('LO')).width(0.25),
  )
  assert.equal(b.unconnected, 0)
  assert.deepEqual(rules(b), [], 'no short or clearance against the other group')
})

test('net tie: groups name pads the footprint has, two or more each, each pad once', () => {
  const bad = netTie => assert.throws(() => board(fp({ ref: 'RS1', at: '10 5', nets, netTie }, ...shuntPads())), CompileError)
  bad([['1', '9']])
  bad([['1']])
  bad([
    ['1', '2'],
    ['2', '3'],
  ])
  bad('1,2')
  assert.throws(() => board(fp({ ref: 'RS1', at: '10 5', nets, netTie: [['1', '9']] }, ...shuntPads())), /: netTie names pad "9", which the footprint does not have/)
})
