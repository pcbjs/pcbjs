// A cancel lands inside a stage: the signal flips some ms into place, the schematic, autoroute, finish or checks and the compile throws
// CancelledError within a few ms, the router's search and every rule of the checks reading it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { route, pour } from '@pcbjs/core'
import { compileStages, CancelledError } from '../dist/index.js'
import { fp, P, N } from './parts.mjs'

const W = 40,
  H = 30
const smd = (ref, x, y, net) => fp({ ref, at: `${x} ${y}`, nets: { 1: net } }, h('pad', { num: 1, size: 1, type: 'smd' }))
/** Legs that cross the board, each around the parts of the others, a pour behind them: a few hundred ms of work. */
function board() {
  const parts = [],
    legs = []
  for (let i = 0; i < 12; i++) {
    const net = `S${i}`
    parts.push(smd(`A${i}`, 3, 3 + i * 2, net), smd(`B${i}`, W - 3, H - 3 - i * 2, net))
    legs.push(route(P(`A${i}.1`), P(`B${i}.1`)).width(0.2))
  }
  return h(PCB, { name: 'Cancel' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: W, h: H }), ...parts, ...legs, pour(N.GND, 'B.Cu', `M0 0 H${W} V${H} H0 Z`))
}

/** ms from the signal flipping `after` ms into `stage` to the compile throwing; null when the stage ended first. */
function stopLatency(stage, after) {
  let flip = Infinity
  const signal = {
    get aborted() {
      return performance.now() >= flip
    },
  }
  const on = e => {
    if (e.name === stage && e.state === 'running' && flip === Infinity) flip = performance.now() + after
  }
  try {
    compileStages(board(), { signal, stage: on })
  } catch (e) {
    if (!(e instanceof CancelledError)) throw e
    return performance.now() - flip
  }
  return null
}

test('cancel: the compile stops within a few ms of the signal, inside every long stage', t => {
  // a warm-up, so the times are of the compile and not of loading it
  compileStages(board())
  const times = []
  const seen = {}
  for (const stage of ['place', 'schematic', 'autoroute', 'finish', 'checks'])
    for (const after of [0, 2, 5, 10, 20]) {
      // the least of three, so a busy machine's pause is not counted as the compile's
      const runs = [0, 1, 2].map(() => stopLatency(stage, after)).filter(ms => ms !== null)
      if (!runs.length) continue
      const ms = Math.min(...runs)
      times.push(ms)
      seen[stage] = Math.max(seen[stage] ?? 0, ms)
    }
  assert.ok(seen.autoroute !== undefined && seen.checks !== undefined, `cancelled inside: ${JSON.stringify(seen)}`)
  times.sort((a, b) => a - b)
  const median = times[times.length >> 1]
  t.diagnostic(
    `stop after the signal, ms: median ${median.toFixed(1)}, worst per stage ${JSON.stringify(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, +v.toFixed(1)])))}`,
  )
  assert.ok(median < 5, `median stop ${median.toFixed(1)} ms; the worst per stage ${JSON.stringify(seen)}`)
  assert.ok(times.at(-1) < 30, `worst stop ${times.at(-1).toFixed(1)} ms; per stage ${JSON.stringify(seen)}`)
})

test('cancel: the router reads the signal inside one leg, not only between legs', () => {
  let reads = 0,
    routing = false
  const signal = {
    get aborted() {
      if (routing) reads++
      return false
    },
  }
  compileStages(board(), { signal, stage: e => (routing = e.name === 'autoroute' && e.state === 'running') })
  // one read per leg would be 12
  assert.ok(reads > 24, `${reads} cancel points in autoroute`)
})
