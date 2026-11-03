// Item uids name who made an item, not where it is: a moved part and a moved text keep theirs, and twins number the same whatever the order of other calls' items.
import { fp } from './parts.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, resetDefaults } from '@pcbjs/core'
import { compileBoard } from '../dist/index.js'
import { mintUids } from '../dist/uid.js'

const board = (part, text) => {
  resetDefaults()
  return compileBoard(
    h(
      PCB,
      { name: 'U' },
      h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 }),
      fp({ ref: 'J1', at: part }, h('pad', { num: 1, size: 1.6, drill: 0.8 }), h('pad', { num: 2, at: '2.54 0', size: 1.6, drill: 0.8 })),
      h('text', { layer: 'F.SilkS', at: text }, 'HELLO'),
    ),
    { cache: false },
  )
}
const named = b => Object.fromEntries(b.items.flatMap(it => (it.kind === 'pad' ? [[`J1/${it.num}`, it.uid]] : it.kind === 'text' && it.text === 'HELLO' ? [['text', it.uid]] : [])))

test('a moved part and a moved text keep their uids across two compiles', () => {
  const a = named(board('5 5', '15 10'))
  const b = named(board('20 12 90', '4 16'))
  assert.equal(Object.keys(a).length, 3)
  assert.match(a.text, /^item:[0-9a-f]{12}$/)
  assert.deepEqual(b, a)
})

const src = (line, hash) => ({ file: 'main.tsx', line, col: 1, hash })
const items = () => [
  { kind: 'pad', layer: 'F.Cu', layers: ['F.Cu'], ref: 'U1', num: 'EP', poly: [], at: [0, 0], tag: 'ep-a' },
  { kind: 'pad', layer: 'F.Cu', layers: ['F.Cu'], ref: 'U1', num: 'EP', poly: [], at: [1, 0], tag: 'ep-b' },
  { kind: 'track', layer: 'F.Cu', route: 'route:1', net: 'A', pts: [], width: 0.2, tag: 'r1-0' },
  { kind: 'track', layer: 'F.Cu', route: 'route:1', net: 'A', pts: [], width: 0.2, tag: 'r1-1' },
  { kind: 'track', layer: 'F.Cu', route: 'route:2', net: 'B', pts: [], width: 0.2, tag: 'r2-0' },
  { kind: 'text', layer: 'F.SilkS', text: 'X', src: src(4, 'aaaaaaaaaaaa'), at: [0, 0], tag: 'x-0' },
  { kind: 'text', layer: 'F.SilkS', text: 'X', src: src(4, 'aaaaaaaaaaaa'), at: [5, 0], tag: 'x-1' },
  { kind: 'text', layer: 'F.SilkS', text: 'Y', src: src(9, 'bbbbbbbbbbbb'), at: [0, 9], tag: 'y-0' },
]
const minted = list => {
  const b = { items: list.map((it, id) => ({ ...it, id })) }
  mintUids(b)
  return Object.fromEntries(b.items.map(it => [it.tag, it.uid]))
}

test('twins take ~2 and stay deterministic when other calls reorder around them', () => {
  const base = minted(items())
  assert.equal(base['ep-b'], `${base['ep-a']}~2`)
  assert.equal(new Set(Object.values(base)).size, 8)
  // another order of the calls, each call's own items in the order it made them
  const [epA, epB, r10, r11, r20, x0, x1, y0] = items()
  assert.deepEqual(minted([y0, r20, x0, epA, r10, x1, r11, epB]), base)
  assert.deepEqual(minted([r10, r11, epA, epB, y0, x0, x1, r20]), base)
})

test('uids an earlier stage gave stay, and later items of the same call number on', () => {
  const list = items().map((it, id) => ({ ...it, id }))
  const first = { items: list.slice(0, 3) }
  mintUids(first)
  const all = { items: [...first.items, ...list.slice(3)] }
  mintUids(all)
  assert.deepEqual(Object.fromEntries(all.items.map(it => [it.tag, it.uid])), minted(items()))
})
