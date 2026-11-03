// A board for the selection tests: a named group G of R1 and R2, two instances CH1 and CH2 of one circuit with a part R01 each,
// a route CH1's layout made, a bare track, a pour, and one layer of copper and courtyard markup.
import { shaped } from './shaped.mjs'

const sq = (x, y, s = 1) => [
  [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ],
]
const fp = (ref, x, nets) => ({
  ref,
  at: [x + 1, 5],
  bbox: { x, y: 4, w: 2, h: 2 },
  side: 'F',
  pads: nets.map((net, i) => ({ num: String(i + 1), name: i ? 'B' : 'A', net, at: [x + 0.5 + i, 5] })),
})
const pad = (id, ref, x, net, num) => ({ id, uid: `item:00000000000${id.toString(16)}`, kind: 'pad', ref, net, pad: num, layers: ['F.Cu'], rings: sq(x + Number(num) - 1, 4.5) })

/** The board, with `extra` items beside its own. */
export const fixture = (extra = []) => {
  const b = board()
  return shaped({ ...b, items: [...b.items, ...extra] })
}

function board() {
  const items = [
    pad(1, 'R1', 0, 'A', '1'),
    pad(2, 'R1', 0, 'B', '2'),
    pad(3, 'R2', 4, 'B', '1'),
    pad(4, 'R2', 4, 'GND', '2'),
    pad(5, 'R101', 10, 'S1', '1'),
    pad(6, 'R101', 10, 'GND', '2'),
    pad(7, 'R201', 14, 'S2', '1'),
    pad(8, 'R201', 14, 'GND', '2'),
    { id: 9, uid: 'item:000000000009', kind: 'track', net: 'S1', layers: ['F.Cu'], rings: sq(10, 7, 1), width: 0.2, route: 'route:1' },
    { id: 10, uid: 'item:00000000000a', kind: 'track', net: 'B', layers: ['F.Cu'], rings: sq(1, 7, 1), width: 0.2 },
    { id: 11, uid: 'item:00000000000b', kind: 'zone', net: 'GND', layers: ['F.Cu'], rings: sq(0, 0, 30) },
  ]
  const el = it =>
    it.kind === 'track'
      ? `<path data-id="${it.id}" data-kind="track" data-net="${it.net}" fill="none" stroke="currentColor" stroke-width="0.2" d="M${it.rings[0][0].join(' ')}L${it.rings[0][1].join(' ')}"/>`
      : `<path data-id="${it.id}" data-kind="${it.kind}"${it.ref ? ` data-ref="${it.ref}"` : ''} data-net="${it.net}"${it.kind === 'pad' ? ` data-pad="${it.id % 2 ? 1 : 2}"` : ''} d="M${it.rings[0][0].join(' ')}Z"/>`
  const crt = ['R1', 'R2'].map((r, i) => `<path data-ref="${r}" fill="none" stroke="currentColor" stroke-width="0.05" d="M${i * 4} 4H${i * 4 + 2}V6H${i * 4}Z"/>`).join('')
  return {
    name: 'Fx',
    title: 'Fx',
    nets: ['A', 'B', 'GND', 'S1', 'S2'],
    footprints: [fp('R1', 0, ['A', 'B']), fp('R2', 4, ['B', 'GND']), fp('R101', 10, ['S1', 'GND']), fp('R201', 14, ['S2', 'GND'])],
    items,
    routes: [
      {
        id: 'route:1',
        net: 'S1',
        length: 1,
        path: 'CH1',
        pts: [
          [10, 7],
          [11, 7],
        ],
      },
    ],
    drc: [{ id: 'drc:clearance:aaaaaaaaaaaa', rule: 'clearance', severity: 'error', message: '', at: [10.5, 5], refs: ['R101/1'] }],
    erc: [],
    layers: [
      {
        id: 'F.Cu',
        name: 'F.Cu',
        kind: 'copper',
        side: 'front',
        color: '#c83434',
        order: 0,
        svg: items
          .filter(i => i.kind !== 'zone')
          .map(el)
          .join(''),
      },
      { id: 'F.CrtYd', name: 'F.CrtYd', kind: 'courtyard', side: 'front', color: '#ff26e2', order: 1, svg: crt },
    ],
    schematic: {
      parts: [
        { ref: 'R1', path: ['G'], local: 'R1' },
        { ref: 'R2', path: ['G'], local: 'R2' },
        { ref: 'R101', path: ['CH1'], local: 'R01' },
        { ref: 'R201', path: ['CH2'], local: 'R01' },
      ],
      circuits: [
        { path: ['G'], name: 'G', kind: 'group', def: 'fx.pcb.tsx#12:5', parts: ['R1', 'R2'], children: [], placed: true },
        { path: ['CH1'], name: 'CH1', kind: 'circuit', def: 'chan.ts#Chan', circuit: 'Chan', parts: ['R101'], children: [], placed: true },
        { path: ['CH2'], name: 'CH2', kind: 'circuit', def: 'chan.ts#Chan', circuit: 'Chan', parts: ['R201'], children: [], placed: true },
      ],
      nets: [],
    },
  }
}
