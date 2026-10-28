// created once per page and never disposed
import * as THREE from 'three'

const cache = new Map<string, THREE.Material>()

/** A shared MeshStandardMaterial, one instance per set of parameters. */
export function standard(color: string, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = JSON.stringify([color, roughness, metalness, extra])
  let m = cache.get(key) as THREE.MeshStandardMaterial | undefined
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra })
    cache.set(key, m)
  }
  return m
}

export const M = {
  get alumina() {
    return standard('#e9e5dc', 0.7)
  },
  get overglaze() {
    return standard('#121212', 0.18, 0, { envMapIntensity: 1 })
  },
  get tin() {
    return standard('#c9cccf', 0.28, 0.9)
  },
  get gold() {
    return standard('#e2b24a', 0.25, 1)
  },
  get ceramicCap() {
    return standard('#a77c4f', 0.6)
  },
  get ferrite() {
    return standard('#5d6064', 0.55, 0.1)
  },
  get diode() {
    return standard('#1a1a1a', 0.35)
  },
  get band() {
    return standard('#b9b9b9', 0.5)
  },
  get plastic() {
    return standard('#141414', 0.6)
  },
  get mould() {
    return standard('#1c1c1c', 0.45)
  },
  get dimple() {
    return standard('#3b3b3b', 0.8)
  },
  get ledBody() {
    return standard('#f2f0ea', 0.55)
  },
  get die() {
    return standard('#3a3d44', 0.4, 0.3)
  },
  get phosphor() {
    return standard('#f2cf2c', 0.6, 0, { emissive: '#6b5200' })
  },
  get cathodeMark() {
    return standard('#0d5e1f', 0.5)
  },
}

/** A tinted, translucent LED lens. */
export function lens(color: string, clear: boolean): THREE.MeshStandardMaterial {
  return standard(color, 0.12, 0, {
    transparent: true,
    opacity: clear ? 0.32 : 0.62,
    depthWrite: false,
    emissive: color,
    emissiveIntensity: clear ? 0.05 : 0.35,
  })
}
