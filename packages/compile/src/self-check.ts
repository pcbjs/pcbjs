// A small board a browser compile worker compiles on load: a hash other than Node's means this engine computes otherwise than V8 in Node.
import PCB, { defineFootprint, h, nets, pour, route } from '@pcbjs/core'
import type { Board } from '@pcbjs/core/model'
import type { FootprintProps } from '@pcbjs/core/internal/types'
import { compileStages } from './pipeline.js'
import { sha1 } from './cache.js'
import type { MathKind } from './fdlibm.js'

/** The hash of the fixture as Node compiles it, by how its Math rounds; the browser compile test fails with the new value when the compiler changes it. */
export const SELF_CHECK_HASH: Record<MathKind, string> = {
  plain: '31a13e39f2023476b0be79247b927fa4e0b56514',
  fused: '32abe9df007d3e2e76f94ca131977c6fc24c296f',
}

export interface SelfCheck {
  ok: boolean
  kind: MathKind
  hash: string
  want: string
  ms: number
}

const Pad = defineFootprint(
  function CheckPad(props: FootprintProps) {
    return h('footprint', { id: 'pcbjs:CheckPad', ...props }, h('pad', { num: 1, size: 1.6, shape: 'circle' }), h('pad', { num: 2, at: '3 0', size: [1.2, 0.8] }))
  },
  { pins: ['1', '2'], prefix: 'P' },
)

function fixture() {
  const { A, GND } = nets()
  const P1 = Pad({ ref: 'P1' }).connect({ 1: A, 2: GND })
  const P2 = Pad({ ref: 'P2' }).connect({ 1: A, 2: GND })
  return h(
    PCB,
    { name: 'SelfCheck' },
    h('circle', { layer: 'Edge.Cuts', cx: 12, cy: 12, r: 11 }),
    h(P1, { at: '6 9 37' }),
    h(P2, { at: '15 15 -113' }),
    route(P1[1], P2[1]).width(0.3).Z(),
    pour(GND, 'F.Cu', 'M2 2 H22 V22 H2 Z'),
    h('text', { layer: 'F.SilkS', at: '12 14', size: 1 }, 'self check'),
  )
}

// where the code that made an item sits, which differs between a bundle and the files Node reads
const PLACES = new Set(['src', 'chain', 'def', 'sites', 'uid', 'uids', 'file', 'abs', 'timings'])

/** The board's copper, outline, findings and nets, without where its code sits. */
export const boardHash = (b: Board): string => sha1(JSON.stringify(b, (k, v) => (PLACES.has(k) ? undefined : v)))

/** Compiles the fixture and compares its hash with that of a Node whose Math is of this kind. */
export function selfCheck(kind: MathKind): SelfCheck {
  const t0 = performance.now()
  const [r] = compileStages(fixture(), { want: ['findings'] })
  const hash = boardHash(r.board)
  const want = SELF_CHECK_HASH[kind]
  return { ok: hash === want, kind, hash, want, ms: Math.round(performance.now() - t0) }
}
