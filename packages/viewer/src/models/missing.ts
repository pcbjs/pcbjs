// a part with no model file and no generated body: dashed edges, faint faces and its ref, never a solid block
import * as THREE from 'three'
import { ISSUE_COLOR } from './outline'

const PX_PER_MM = 160
const AMBER = `#${ISSUE_COLOR.toString(16).padStart(6, '0')}`
// made on first use: three.js stays out of module scope for the prerender
let mats: { lines: THREE.LineDashedMaterial; faces: THREE.MeshBasicMaterial } | null = null
const materials = () => (mats ??= {
  lines: new THREE.LineDashedMaterial({ color: ISSUE_COLOR, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.95 }),
  faces: new THREE.MeshBasicMaterial({ color: ISSUE_COLOR, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }),
})

/** The ref over `no model`, amber on a transparent canvas of the top face's aspect. */
function tagTexture(ref: string, w: number, h: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(32, Math.round(w * PX_PER_MM))
  canvas.height = Math.max(32, Math.round(h * PX_PER_MM))
  const g = canvas.getContext('2d')!
  const font = (px: number) => `600 ${px}px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`
  const fit = (text: string, px: number, share: number) => { g.font = font(px); return Math.min(px, (px * canvas.width * share) / Math.max(1, g.measureText(text).width)) }
  const big = fit(ref, canvas.height * 0.4, 0.9), small = fit('no model', big * 0.55, 0.9)
  g.fillStyle = AMBER
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = font(big)
  g.fillText(ref, canvas.width / 2, canvas.height / 2 - small * 0.6)
  g.font = font(small)
  g.fillText('no model', canvas.width / 2, canvas.height / 2 + big * 0.55)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** The body box `w` by `h` by `height` mm as an outline in the model frame, z up from the board face. */
export function missingModel(w: number, h: number, height: number, ref: string): THREE.Object3D {
  const g = new THREE.Group()
  if (!(w > 0 && h > 0 && height > 0)) return g
  const { lines, faces } = materials()
  const box = new THREE.BoxGeometry(w, h, height)
  box.translate(0, 0, height / 2)
  const shell = new THREE.Mesh(box, faces)
  shell.renderOrder = 2
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), lines)
  edges.computeLineDistances()
  edges.userData.pick = false
  edges.renderOrder = 2
  g.add(shell, edges)
  if (ref) {
    const top = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tagTexture(ref, w, h), transparent: true, depthWrite: false }))
    top.position.z = height + 0.01
    top.renderOrder = 3
    top.userData.pick = false
    g.add(top)
  }
  g.name = 'no-model'
  return g
}
