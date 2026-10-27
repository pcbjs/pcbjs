// Under the focus fade, a hover outside the pinned net, its pair group or the selection is a bare outline that reaches nothing else.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import * as THREE from 'three'
import { GHOST_FILL, hoverFill, hoverScope, inScope } from '../src/scene/focus.ts'

// the client imports its modules without an extension, as Vite resolves them
registerHooks({ resolve: (spec, ctx, next) => { try { return next(spec, ctx) } catch (e) { if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx); throw e } } })
const { FADE_OPACITY, Variants, setState } = await import('../src/scene/highlight.ts')

const board = {
  footprints: [
    { ref: 'U1', pads: [{ net: 'SDA' }, { net: 'GND' }] },
    { ref: 'R1', pads: [{ net: 'SDA' }, { net: 'VCC' }] },
    { ref: 'C1', pads: [{ net: 'VCC' }, { net: 'GND' }] },
  ],
}

test('no scope without the fade or without a focus, and every hover then acts', () => {
  assert.equal(hoverScope({ net: 'SDA' }, false, board), null)
  assert.equal(hoverScope({}, true, board), null)
  assert.ok(inScope({ net: 'GND' }, null))
  assert.equal(hoverFill({ net: 'GND' }, null), 1)
})

test('a pinned net: its copper and the bodies on it are in scope, other copper is not', () => {
  const s = hoverScope({ net: 'SDA' }, true, board)
  assert.ok(inScope({ net: 'SDA', ref: 'U1' }, s))
  assert.ok(inScope({ ref: 'R1', body: true }, s))
  assert.ok(!inScope({ net: 'VCC', ref: 'R1' }, s))
  assert.ok(!inScope({ ref: 'C1', body: true }, s))
  assert.equal(hoverFill({ net: 'GND' }, s), GHOST_FILL)
  assert.ok(GHOST_FILL < 0.05)
})

test('a selected part: its pads and pins on any net, its body; a group counts every part', () => {
  const s = hoverScope({ ref: 'C1' }, true, board)
  assert.ok(inScope({ net: 'GND', ref: 'C1' }, s))
  assert.ok(inScope({ ref: 'C1', body: true }, s))
  assert.ok(!inScope({ net: 'GND', ref: 'U1' }, s))
  const g = hoverScope({ refs: ['U1', 'R1'] }, true, board)
  assert.ok(inScope({ ref: 'R1', body: true }, g))
  assert.ok(inScope({ refs: ['R1', 'Q9'], body: true }, g))
  assert.ok(!inScope({ ref: 'C1', body: true }, g))
})

test('a pinned pair net takes its partner', () => {
  const s = hoverScope({ net: 'DN', nets: ['DN', 'DP'] }, true, board)
  assert.ok(inScope({ net: 'DP' }, s))
  assert.ok(!inScope({ net: 'GND' }, s))
})

test('a 3D hover outside the focus keeps its outline and nearly no fill', () => {
  const v = new Variants(() => '#ffffff')
  const base = new THREE.MeshStandardMaterial({ color: '#336699', emissive: '#000000' })
  const ghost = v.get(base, 'ghost')
  assert.ok(ghost.transparent && ghost.opacity <= FADE_OPACITY)
  assert.ok(Math.abs(ghost.color.r - base.color.r) < 0.01 && ghost.emissive.r < 0.03, 'the tint is next to nothing')
  const hover = v.get(base, 'hover')
  assert.ok(hover.emissive.r > 0.5, 'a hover in scope keeps its full tint')
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), base)
  mesh.userData.noOutline = true
  setState(mesh, 'ghost', v)
  assert.ok(mesh.userData.outline?.visible, 'the outline is drawn even for a part body')
  setState(mesh, null, v)
  assert.equal(mesh.userData.outline.visible, false)
})
