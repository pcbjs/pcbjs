// chip LED: pad K at -x; PLCC-4: the pin 1 corner at -x and +y
import * as THREE from 'three'
import type { ModelSpec } from '@pcbjs/core/internal/types'
import { M, lens, standard } from './materials'
import { box, mesh, roundedBox } from './geom'
import { LED_CLEAR, LED_TINT, ledLens } from '@pcbjs/export/internal/scene/colors'

type LedSpec = Extract<ModelSpec, { kind: 'led' }>
type PlccSpec = Extract<LedSpec, { window: number }>

export function ledModel(spec: LedSpec): THREE.Object3D {
  if ('window' in spec) return plccModel(spec)
  const [l, w] = spec.body
  const { cap } = spec
  const t = Math.max(0.3, spec.height)
  const base = Math.min(0.3, t * 0.4)
  const colour = (spec.color ?? '').toLowerCase()
  const g = new THREE.Group()
  g.add(mesh(roundedBox(l - 0.02, w, base, 0.03, 0), M.ledBody))
  for (const s of [-1, 1]) g.add(mesh(roundedBox(cap, w + 0.02, base + 0.01, 0.04), M.tin, s * (l / 2 - cap / 2)))
  if (colour === 'white') g.add(mesh(box(w * 0.6, w * 0.6, 0.02), M.phosphor, 0, 0, base))
  else g.add(mesh(box(0.22, 0.22, 0.06), M.die, 0, 0, base))
  const tint = ledLens(colour)
  const lensMat = lens(tint.color, tint.clear)
  const lt = t - base
  if (spec.lens === 'dome') {
    g.add(mesh(roundedBox(l - 0.06, w - 0.04, lt * 0.25, 0.02, base), lensMat))
    const dome = new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2)
    dome.rotateX(Math.PI / 2)
    dome.scale(Math.min(l, w) * 0.42, Math.min(l, w) * 0.42, lt * 0.75)
    g.add(mesh(dome, lensMat, 0, 0, base + lt * 0.25))
  } else {
    g.add(mesh(roundedBox(l - 0.06, w - 0.04, lt, 0.05, base), lensMat))
  }
  // cathode line across the top at the K end
  g.add(mesh(box(0.09, w * 0.8, 0.012), M.cathodeMark, -l / 2 + cap + 0.08, 0, spec.lens === 'dome' ? base + lt * 0.25 : t))
  return g
}

function plccModel(spec: PlccSpec): THREE.Object3D {
  const side = spec.body[0],
    t = Math.max(0.3, spec.height)
  const g = new THREE.Group()
  // the body, a notch cut at the pin 1 corner by a dark wedge laid on its top edge
  g.add(mesh(roundedBox(side, side, t, Math.min(0.08, side / 20)), M.ledBody))
  const notch = side * 0.12
  g.add(mesh(box(notch, notch, 0.02), M.die, -side / 2 + notch / 2, side / 2 - notch / 2, t))
  const [ll, lw] = spec.lead
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) g.add(mesh(box(ll, lw, Math.min(0.2, t * 0.3)), M.tin, sx * (side / 2 - ll / 2 + 0.01), sy * (side / 2 - lw / 2 - side * 0.05)))
  const r = spec.window / 2,
    depth = t * 0.35
  const frame = new THREE.CylinderGeometry(r, r, 0.02, 40)
  frame.rotateX(Math.PI / 2)
  g.add(mesh(frame, M.tin, 0, 0, t - depth))
  const colour = (spec.color ?? '').toLowerCase()
  const die = Math.max(0.12, side * 0.06)
  const rgb = LED_TINT[colour] ? [LED_TINT[colour]] : [LED_TINT.red, LED_TINT.green, LED_TINT.blue]
  rgb.forEach((c, i) => g.add(mesh(box(die, die, 0.05), standard(c, 0.4, 0, { emissive: c, emissiveIntensity: 0.4 }), (i - (rgb.length - 1) / 2) * die * 1.8, 0, t - depth + 0.02)))
  const fill = new THREE.CylinderGeometry(r, r, depth - 0.02, 40)
  fill.rotateX(Math.PI / 2)
  g.add(mesh(fill, lens(LED_CLEAR, true), 0, 0, t - depth / 2 + 0.01))
  return g
}
