// One of two projects for the browser compile's project isolation, both an entry /project/pcb.mjs: a binds and places the route trunk.
import PCB, { bindRef, defineFootprint, h, nets, route } from '@pcbjs/core'

const TwoPad = defineFootprint(
  function TwoPad(props) {
    return h('footprint', { id: 'test:TwoPad', ...props }, h('pad', { num: 1, size: 1.2, shape: 'circle' }), h('pad', { num: 2, at: '2.5 0', size: 1.2, shape: 'circle' }))
  },
  { pins: ['1', '2'], prefix: 'J' },
)

const { A, B } = nets()
const J1 = TwoPad('x', { ref: 'J1' }).connect({ 1: A, 2: B })
const J2 = TwoPad('x', { ref: 'J2' }).connect({ 1: A, 2: B })
const trunk = bindRef(route(J1[1], J2[1]).Z(), 'trunk', { file: '/project/pcb.mjs', line: 14, col: 7 })

export default h(
  PCB,
  { name: 'Alpha', __src: { file: '/project/pcb.mjs', line: 1, col: 1 } },
  h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 12 }),
  h(J1, { at: '4 4' }),
  h(J2, { at: '12 8' }),
  trunk,
  route(J1[2], J2[2]).Z(),
)
