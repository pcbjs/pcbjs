// Toggling explode frames the stack at its target separation, the camera landing with the layers; the slider hangs under its button and a drag keeps the framing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { fitDistance, stackBox } from '../src/scene/fit.ts'
import { StackFit, poseOf, positionOf } from '../src/scene/stack-fit.ts'

const view3d = readFileSync(new URL('../src/View3D.vue', import.meta.url), 'utf8')
// offsets() of scene/explode.ts, whose extensionless import node cannot load
const offsets = (order, sep) => new Map(order.map((n, i) => [n, (i - 4) * sep]))
const order = ['bodies:B', 'B.SilkS', 'B.Mask', 'B.Cu', 'diel:0', 'F.Cu', 'F.Mask', 'F.SilkS', 'bodies:F']

function board() {
  const b = new THREE.Group()
  for (const [i, name] of order.entries()) {
    const g = new THREE.Group(); g.name = name
    const m = new THREE.Mesh(new THREE.BoxGeometry(40, 30, 0.1)); m.position.z = i * 0.2
    g.add(m); b.add(g)
  }
  return b
}
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} near ${b}`)

test('the slider hangs in a popover under the explode button, out of the button row', () => {
  const row = /<div class="view3d-buttons">([\s\S]*?)\n    <\/div>/.exec(view3d)[1]
  const anchor = /<span class="view3d-anchor">\s*(<button[^>]*aria-label="Explode"[\s\S]*?)<\/span>\n/.exec(row)[1]
  assert.match(anchor, /aria-label="Explode"[\s\S]*<span v-if="ui.explode" class="view3d-pop"><input class="view3d-range" type="range"/)
  assert.equal(anchor.match(/type="range"/g).length, 1)
  const pop = /\.view3d-pop \{([^}]*)\}/.exec(view3d)[1]
  assert.match(pop, /position: absolute/)
  assert.match(pop, /top: calc\(100% \+ 4px\)/)
  assert.doesNotMatch(pop, /transition|animation/)
  assert.match(view3d, /\.view3d-anchor \{[^}]*position: relative/)
})

test('explode on frames the stack at its target gap, explode off the assembled board', () => {
  const b = board()
  const flat = stackBox(b, offsets(order, 0)), open = stackBox(b, offsets(order, 4))
  near(flat.max.z - flat.min.z, 1.7)
  near(open.max.z - open.min.z, 1.7 + 8 * 4)
  const dir = new THREE.Vector3(1, -1, 0.8).normalize(), up = new THREE.Vector3(0, 0, 1)
  assert.ok(fitDistance(open, dir, up, Math.PI / 5, 1.6) > fitDistance(flat, dir, up, Math.PI / 5, 1.6))
  // turning it off while exploded aims at the assembled board, wherever the groups stand now
  for (const [name, z] of offsets(order, 4)) b.getObjectByName(name).position.z = z
  const back = stackBox(b, offsets(order, 0))
  near(back.min.z, flat.min.z); near(back.max.z, flat.max.z)
})

test('the fit lands with the separation: halfway there, halfway framed', () => {
  const from = poseOf(new THREE.Vector3(0, 0, 0), new THREE.Vector3(30, -30, 30))
  const to = poseOf(new THREE.Vector3(0, 0, 16), new THREE.Vector3(60, -60, 76))
  const fit = new StackFit()
  assert.ok(fit.start(from, to, 0, 4))
  const mid = fit.at(2)
  near(mid.target.z, 8); near(mid.r, (from.r + to.r) / 2)
  const end = fit.at(4)
  assert.ok(positionOf(end).distanceTo(new THREE.Vector3(60, -60, 76)) < 1e-9)
  assert.equal(fit.active, false)
  assert.equal(fit.start(from, to, 4, 4), false, 'no separation change, nothing to follow')
})

test('a slider drag never refits: it stops a fit in flight and only the explode toggle starts one', () => {
  const fit = new StackFit(), p = poseOf(new THREE.Vector3(), new THREE.Vector3(1, 1, 1))
  fit.start(p, p, 0, 4)
  fit.stop()
  assert.equal(fit.at(2), null)
  assert.equal(view3d.match(/stackFit\.start\(/g).length, 1)
  assert.match(view3d, /function onExplode\(\)[\s\S]*?stackFit\.start\(/)
  assert.match(view3d, /watch\(\(\) => ui\.explode, onExplode\)/)
  assert.match(view3d, /watch\(\(\) => ui\.separation, \(\) => \{ if \(ui\.explode\) startExplode\(\) \}\)/)
  assert.match(view3d, /function onSeparation\(e: Event\) \{\n  stackFit\.stop\(\)/)
  assert.doesNotMatch(/function startExplode\(\) \{[\s\S]*?\n\}/.exec(view3d)[0], /view\(|frame\(|moveCamera/)
})

test('an exploded fit leaves the label column free on the right of the pane', async () => {
  const { fitBeside } = await import('../src/scene/fit.ts')
  const b = board()
  for (const [name, z] of offsets(order, 4)) b.getObjectByName(name).position.z = z
  const box = stackBox(b, offsets(order, 4))
  const w = 600, h = 500, column = 110
  const cam = new THREE.PerspectiveCamera(40, w / h, 0.1, 5000)
  const dir = new THREE.Vector3(1, -1.2, 0.9).normalize()
  const px = (target, dist) => {
    cam.position.copy(target).addScaledVector(dir, dist); cam.up.set(0, 0, 1); cam.lookAt(target); cam.updateMatrixWorld(true)
    const xs = [], ys = []
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new THREE.Vector3(x, y, z).project(cam); xs.push((p.x + 1) / 2 * w); ys.push((1 - p.y) / 2 * h)
    }
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
  }
  const vfov = (40 * Math.PI) / 180, up = new THREE.Vector3(0, 0, 1)
  const plain = px(box.getCenter(new THREE.Vector3()), fitDistance(box, dir, up, vfov, w / h))
  assert.ok(plain.right > w - column, 'a plain fit runs into the column')
  const { dist, shift } = fitBeside(box, dir, up, vfov, w / h, column / w)
  const s = px(box.getCenter(new THREE.Vector3()).add(shift), dist)
  assert.ok(s.left >= 0 && s.right <= w - column + 1e-6, `${s.left} to ${s.right} inside 0 to ${w - column}`)
  assert.ok(s.top >= 0 && s.bottom <= h)
  assert.ok(shift.dot(new THREE.Vector3().crossVectors(up, dir)) > 0, 'the target moves right, so the board sits left')
  const none = fitBeside(box, dir, up, vfov, w / h, 0)
  assert.ok(Math.abs(none.dist - fitDistance(box, dir, up, vfov, w / h)) < 1e-6 * none.dist || none.dist <= fitDistance(box, dir, up, vfov, w / h))
})

test('the explode fit takes the column from the longest label', () => {
  assert.match(view3d, /fitBeside\(box, dir, camera\.up, vfov, camera\.aspect, share\)/)
  assert.match(view3d, /\(GAP \+ Math\.max\(\.\.\.shown\.map\(width\)\) \+ EDGE\) \/ w/)
})
