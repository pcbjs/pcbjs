// pads along x, pad 1 at -x; z = 0 is the board face
import * as THREE from 'three'
import type { ModelSpec } from '@pcbjs/core/internal/types'
import { M } from './materials'
import { box, mesh, roundedBox } from './geom'

type ChipSpec = Extract<ModelSpec, { kind: 'chip' }>

const PX_PER_MM = 320
const COAT = 0.025

/** White sans-serif text centred on a transparent canvas of the face's aspect, reading along +x. */
function markingTexture(text: string, w: number, h: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(16, Math.round(w * PX_PER_MM))
  canvas.height = Math.max(16, Math.round(h * PX_PER_MM))
  const g = canvas.getContext('2d')!
  let size = canvas.height * 0.62
  g.font = `600 ${size}px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`
  const fit = (canvas.width * 0.86) / Math.max(1, g.measureText(text).width)
  if (fit < 1) {
    size *= fit
    g.font = `600 ${size}px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`
  }
  g.fillStyle = '#f2f2f2'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, canvas.width / 2, canvas.height / 2 + size * 0.04)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

const thick = (spec: ChipSpec) => Math.max(0.2, spec.height)
const between = (spec: ChipSpec) => spec.body[0] - 2 * spec.cap - 0.04
/** where the overglaze of a resistor starts, under its top coat */
const glazeAt = (spec: ChipSpec) => thick(spec) - 0.03 + 0.01 - 0.012

export function chipModel(spec: ChipSpec): THREE.Object3D {
  const [l, w] = spec.body
  const { cap } = spec
  const t = thick(spec)
  const r = Math.min(0.06, w * 0.1)
  const g = new THREE.Group()
  const bodyMat = spec.part === 'C' ? M.ceramicCap : spec.part === 'L' ? M.ferrite : spec.part === 'D' ? M.diode : M.alumina
  // the body sits a hair inside the caps so the caps wrap over its ends
  g.add(mesh(roundedBox(l - 0.02, w, t - 0.03, r, 0.01), bodyMat))
  for (const s of [-1, 1]) g.add(mesh(roundedBox(cap, w + 0.03, t, r * 1.2), M.tin, s * (l / 2 - cap / 2)))
  const inner = between(spec)
  if (spec.part === 'R') g.add(mesh(roundedBox(inner, w - 0.06, COAT, 0.01, glazeAt(spec)), M.overglaze))
  else if (spec.part === 'D') g.add(mesh(box(inner * 0.14, w * 0.96, 0.01), M.band, -inner / 2 + inner * 0.12, 0, t - 0.025))
  return g
}

/** The printed code of a resistor as a decal on its overglaze: a canvas texture, so the live view draws it and Node does not. */
export function markingDecal(spec: ChipSpec, marking: string): THREE.Mesh {
  const fw = between(spec) * 0.96,
    fh = (spec.body[1] - 0.06) * 0.9
  const mat = new THREE.MeshStandardMaterial({
    map: markingTexture(marking, fw, fh),
    transparent: true,
    roughness: 0.5,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  })
  return mesh(new THREE.PlaneGeometry(fw, fh), mat, 0, 0, glazeAt(spec) + COAT + 0.002)
}
