// pads along x, pad 1 at -x; z = 0 is the board face
import * as THREE from 'three'
import type { ModelSpec } from '@pcbjs/core/types'
import { M } from './materials'
import { box, mesh, roundedBox } from './geom'
import { chipSize } from './sizes'

type ChipSpec = Extract<ModelSpec, { kind: 'chip' }>

const PX_PER_MM = 320

/** White sans-serif text centred on a transparent canvas of the face's aspect, reading along +x. */
function markingTexture(text: string, w: number, h: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(16, Math.round(w * PX_PER_MM))
  canvas.height = Math.max(16, Math.round(h * PX_PER_MM))
  const g = canvas.getContext('2d')!
  let size = canvas.height * 0.62
  g.font = `600 ${size}px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`
  const fit = (canvas.width * 0.86) / Math.max(1, g.measureText(text).width)
  if (fit < 1) { size *= fit; g.font = `600 ${size}px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif` }
  g.fillStyle = '#f2f2f2'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, canvas.width / 2, canvas.height / 2 + size * 0.04)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

export function chipModel(spec: ChipSpec, height: number, marking: string): THREE.Object3D {
  const { l, w, cap } = chipSize(spec.size)
  const t = Math.max(0.2, height)
  const r = Math.min(0.06, w * 0.1)
  const g = new THREE.Group()
  const bodyMat = spec.part === 'C' ? M.ceramicCap : spec.part === 'L' ? M.ferrite : spec.part === 'D' ? M.diode : M.alumina
  // the body sits a hair inside the caps so the caps wrap over its ends
  g.add(mesh(roundedBox(l - 0.02, w, t - 0.03, r, 0.01), bodyMat))
  for (const s of [-1, 1]) g.add(mesh(roundedBox(cap, w + 0.03, t, r * 1.2), M.tin, s * (l / 2 - cap / 2)))
  const inner = l - 2 * cap - 0.04
  if (spec.part === 'R') {
    const coat = 0.025, top = t - 0.03 + 0.01
    g.add(mesh(roundedBox(inner, w - 0.06, coat, 0.01, top - 0.012), M.overglaze))
    if (marking) {
      const fw = inner * 0.96, fh = (w - 0.06) * 0.9
      const mat = new THREE.MeshStandardMaterial({ map: markingTexture(marking, fw, fh), transparent: true, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
      g.add(mesh(new THREE.PlaneGeometry(fw, fh), mat, 0, 0, top - 0.012 + coat + 0.002))
    }
  } else if (spec.part === 'D') {
    g.add(mesh(box(inner * 0.14, w * 0.96, 0.01), M.band, -inner / 2 + inner * 0.12, 0, t - 0.025))
  }
  return g
}
