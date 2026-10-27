// ERC copper-weight: heavy copper needs the fab's wider minimums.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, resetDefaults } from '@pcbjs/core'
import { twoLayer, fourLayer } from '@pcbjs/lib'
import { copperWeightRule, COPPER_WEIGHT_RULES } from '@pcbjs/core/rules'
import { compileBoard } from '@pcbjs/compile'

afterEach(() => resetDefaults())
const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 10 })
const weight = (props) => compileBoard(h(PCB, { name: 'W', ...props }, edge())).erc.filter(e => e.rule === 'copper-weight')

test('copper weight: the shipped table is JLCPCB 2 oz, a heavier weight takes the lighter entry', () => {
  assert.deepEqual(COPPER_WEIGHT_RULES[2], { clearance: 0.16, minTrackWidth: 0.16 })
  assert.equal(copperWeightRule(1), undefined)
  assert.deepEqual(copperWeightRule(3), { oz: 2, clearance: 0.16, minTrackWidth: 0.16 })
})

test('copper weight: 2 oz outer copper under 1 oz rules is one warning naming the layers and the figures', () => {
  assert.deepEqual(weight({ stackup: twoLayer() }), [])
  const w = weight({ stackup: twoLayer({ outerCopper: 2 }), rules: { clearance: 0.127, minTrackWidth: 0.127 } })
  assert.equal(w.length, 1)
  assert.equal(w[0].severity, 'warning')
  assert.match(w[0].message, /^F\.Cu and B\.Cu are 2 oz copper, which fabs make at clearance 0\.16 mm and track width 0\.16 mm or more, but the rules have clearance 0\.127 mm and minTrackWidth 0\.127 mm/)
  assert.deepEqual(weight({ stackup: twoLayer({ outerCopper: 2 }), rules: { clearance: 0.16, minTrackWidth: 0.16 } }), [])
  // only the heavy layers are named: 2 oz inner copper on a 4-layer board
  const inner = weight({ stackup: fourLayer({ innerCopper: 2 }), rules: { clearance: 0.2, minTrackWidth: 0.127 } })
  assert.equal(inner.length, 1)
  assert.match(inner[0].message, /^In1\.Cu and In2\.Cu are 2 oz copper.* the rules have minTrackWidth 0\.127 mm;/)
})
