// Out of a focus: a popover under the focus fade button sets the opacity, monochrome, shaded or edges, and grouped or stacked transparency of everything unfocused.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import * as THREE from 'three'

registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
const { BLEND, FADE_OPACITY, LOOK, PREPASS, Variants, setState, withSaturation } = await import('../src/scene/highlight.ts')

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} near ${b}`)
const mesh = (opacity = 1) => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#c87533', transparent: opacity < 1, opacity }))
function lit(look) {
  const v = new Variants(() => '#888888')
  v.setLevel('fade', 1)
  v.setLook(look)
  return v
}

test('the opacity applies to unfocused materials, never to focused ones, and the plain fade comes back without a focus', () => {
  const v = lit({ ...LOOK, opacity: 0.1 })
  const out = mesh(),
    sel = mesh(),
    mask = mesh(0.94)
  setState(out, 'fade', v)
  setState(sel, 'rim', v)
  setState(mask, 'fade', v)
  near(out.material.opacity, 0.1)
  near(mask.material.opacity, 0.1)
  assert.equal(sel.material.opacity, 1)
  assert.equal(sel.material.transparent, false)
  v.setLook({ ...LOOK, opacity: 0.4 })
  near(out.material.opacity, 0.4)
  v.setLook(null)
  near(out.material.opacity, FADE_OPACITY)
})

test('monochrome sets one saturation uniform, ramped with the fade, and the shader mixes toward grey', () => {
  const v = lit({ ...LOOK, mono: true })
  assert.equal(v.sat.value, 0)
  v.setLevel('fade', 0.5)
  assert.equal(v.sat.value, 0.5)
  v.setLook({ ...LOOK, mono: false })
  assert.equal(v.sat.value, 1)
  const m = mesh()
  setState(m, 'fade', v)
  const sh = { uniforms: {}, fragmentShader: 'void main() {\n\t#include <opaque_fragment>\n}' }
  m.material.onBeforeCompile(sh)
  assert.equal(sh.uniforms.uSat, v.sat)
  assert.match(sh.fragmentShader, /^uniform float uSat;/)
  assert.match(withSaturation(sh.fragmentShader.replace(/^uniform float uSat;\n/, '')), /#include <opaque_fragment>\n\tgl_FragColor\.rgb = mix\(vec3\(dot\(/)
  assert.equal(m.material.customProgramCacheKey(), 'pcbjs-sat', 'one program for every faded variant')
})

test('edges mode hides the faces and draws cached edge lines, and shaded brings the faces back', () => {
  const v = lit({ ...LOOK, edges: true, grouped: false })
  const m = mesh()
  setState(m, 'fade', v)
  assert.equal(m.material, v.hidden)
  assert.equal(m.material.visible, false)
  const wire = m.userData.wire
  assert.ok(wire instanceof THREE.LineSegments && wire.visible)
  assert.ok(wire.geometry instanceof THREE.EdgesGeometry)
  assert.equal(wire.geometry.parameters.thresholdAngle, 30)
  v.setLook({ ...LOOK, edges: false, grouped: false })
  setState(m, 'fade', v)
  assert.notEqual(m.material, v.hidden)
  assert.equal(wire.visible, false)
  v.setLook({ ...LOOK, edges: true, grouped: false })
  setState(m, 'fade', v)
  assert.equal(m.userData.wire, wire, 'the edge lines are made once per mesh')
  assert.equal(v.edgesOf(m.geometry), wire.geometry)
  setState(m, null, v)
  assert.equal(wire.visible, false)
})

test('stacked blends every unfocused mesh with depth writes off and no prepass', () => {
  const v = lit({ ...LOOK, grouped: false })
  const m = mesh()
  setState(m, 'fade', v)
  assert.equal(m.material.depthWrite, false)
  assert.equal(m.material.depthFunc, THREE.LessEqualDepth)
  assert.equal(m.renderOrder, 0)
  assert.ok(!m.userData.prepass?.visible)
})

test('grouped runs a depth-only prepass, then the blend with depthFunc EQUAL, and focused items stay out of both', () => {
  const v = lit(LOOK)
  const m = mesh(),
    sel = mesh()
  setState(m, 'fade', v)
  setState(sel, 'rim', v)
  const pre = m.userData.prepass
  assert.ok(pre.visible && pre.geometry === m.geometry)
  assert.equal(pre.material.colorWrite, false)
  assert.equal(pre.material.depthWrite, true)
  assert.equal(pre.renderOrder, PREPASS)
  assert.equal(m.renderOrder, BLEND)
  assert.ok(PREPASS < BLEND)
  assert.equal(m.material.depthFunc, THREE.EqualDepth)
  assert.equal(m.material.depthWrite, false)
  assert.equal(sel.userData.prepass, undefined)
  assert.equal(sel.renderOrder, 0)
  assert.equal(sel.material.depthFunc, THREE.LessEqualDepth)
  v.setLook({ ...LOOK, grouped: false })
  setState(m, 'fade', v)
  assert.equal(pre.visible, false)
  assert.equal(m.renderOrder, 0)
  assert.equal(m.material.depthFunc, THREE.LessEqualDepth)
  setState(m, null, v)
  assert.equal(m.material.depthFunc, THREE.LessEqualDepth)
})

test('grouped edges: the prepass sits a hair back so the edges pass it, hidden lines stay hidden', () => {
  const v = lit({ ...LOOK, edges: true })
  const m = mesh()
  setState(m, 'fade', v)
  assert.equal(m.material, v.hidden)
  assert.ok(m.userData.prepass.visible && m.userData.prepass.material.polygonOffset)
  assert.equal(m.userData.wire.renderOrder, BLEND)
})

test('shaded, grouped, 25 percent with a selection draws no edge geometry, a faded pour included', () => {
  const v = lit(LOOK)
  const item = kind => {
    const m = mesh()
    Object.assign(m.userData, { kind })
    return m
  }
  const meshes = [
    ['rim', item('track')],
    ['fade', item('track')],
    ['fade', item('zone')],
  ]
  for (const [s, m] of meshes) setState(m, s, v)
  const lines = meshes.flatMap(([, m]) => {
    const out = []
    m.traverseVisible(o => {
      if (o.isLineSegments) out.push(o)
    })
    return out
  })
  assert.deepEqual(lines, [])
})

test('grouped depth prepass preserves a material offset expressed only in depth units', () => {
  const variants = new Variants(() => '#888888')
  const base = new THREE.MeshStandardMaterial({ polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -4 })
  const depth = variants.depth(base, false)
  assert.equal(depth.polygonOffset, true)
  assert.equal(depth.polygonOffsetFactor, 0)
  assert.equal(depth.polygonOffsetUnits, -4)
  const unoffset = variants.depth(new THREE.MeshStandardMaterial({ polygonOffset: false, polygonOffsetFactor: 0, polygonOffsetUnits: -4 }), false)
  assert.notEqual(unoffset, depth)
  assert.equal(unoffset.polygonOffset, false)
})
