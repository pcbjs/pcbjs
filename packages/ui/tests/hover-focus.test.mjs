// A selected 3D mesh takes a faint Fresnel rim in the accent and keeps its colour: the selection itself is the outline.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import * as THREE from 'three'

// the client imports its modules without an extension, as Vite resolves them
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
const { RIM, Variants, setState } = await import('../src/scene/highlight.ts')

test('a selected 3D mesh keeps its colour and opacity and takes the Fresnel rim in the accent, no outline geometry', () => {
  const v = new Variants(() => '#2563eb')
  const base = new THREE.MeshStandardMaterial({ color: '#336699' })
  const rim = v.get(base, 'rim')
  assert.ok(!rim.transparent && rim.opacity === 1)
  assert.ok(Math.abs(rim.color.r - base.color.r) < 1e-9, 'no tint of the colour itself')
  const sh = { uniforms: {}, fragmentShader: 'varying vec3 vViewPosition;\nvoid main() {\n#include <opaque_fragment>\n}' }
  rim.onBeforeCompile(sh)
  assert.match(sh.fragmentShader, /uRimColor/)
  assert.equal(sh.uniforms.uRim.value, RIM)
  v.setLevel('rim', 0.5)
  assert.equal(sh.uniforms.uRim.value, RIM * 0.5, 'the rim fades in with its level')
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), base)
  setState(mesh, 'rim', v)
  assert.equal(mesh.material, rim)
  assert.equal(mesh.children.length, 0)
  setState(mesh, null, v)
  assert.equal(mesh.material, base)
})
