// created once per page and never disposed
import * as THREE from 'three'
import { LED_GLOW } from '@pcbjs/export/internal/scene/colors'
import type { MeshMaterial } from '@pcbjs/step'
import { normalizeMaterial } from '@pcbjs/step/internal/mesh'
import type { Rgb } from './sink'

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

/** An opaque LED lens in its colour, glowing a little so it reads as that colour. */
export function lens(color: string, clear: boolean): THREE.MeshStandardMaterial {
  return standard(color, 0.25, 0, { emissive: color, emissiveIntensity: clear ? LED_GLOW.clear : LED_GLOW.tinted })
}

const files = new Map<string, THREE.MeshStandardMaterial>()

/** A model file's material: light greys and golds as metal, the rest plastic. */
export function stepMaterial(c: Rgb, material?: MeshMaterial): THREE.MeshStandardMaterial {
  const key = JSON.stringify([c, material])
  let m = files.get(key)
  if (!m) {
    // light greys and golds are the metal of pins and shells, the rest plastic
    const col = new THREE.Color().setRGB(c[0], c[1], c[2])
    const hsl = col.getHSL({ h: 0, s: 0, l: 0 })
    const metal = hsl.l > 0.25 && (hsl.s < 0.15 || (hsl.h > 0.08 && hsl.h < 0.17 && hsl.s > 0.3))
    m = new THREE.MeshStandardMaterial(
      material
        ? {
            ...(material.name ? { name: material.name } : {}),
            color: col,
            roughness: material.roughness ?? 1,
            metalness: material.metalness ?? 1,
            opacity: material.alphaMode === 'OPAQUE' || !material.alphaMode ? 1 : (material.opacity ?? 1),
            transparent: material.alphaMode === 'BLEND',
            alphaTest: material.alphaMode === 'MASK' ? (material.alphaCutoff ?? 0.5) : 0,
            side: material.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
            emissive: new THREE.Color().setRGB(...(material.emissive ?? [0, 0, 0])),
          }
        : { color: col, roughness: metal ? 0.35 : 0.6, metalness: metal ? 0.7 : 0.05 },
    )
    if (material) m.userData.pcbjsMaterial = normalizeMaterial(material)
    files.set(key, m)
  }
  return m
}

/** Scalar material properties retained by model caches and exports. */
export function meshMaterial(m: THREE.MeshStandardMaterial): MeshMaterial {
  if (m.userData.pcbjsMaterial) return normalizeMaterial(m.userData.pcbjsMaterial)
  return {
    ...(m.name ? { name: m.name } : {}),
    metalness: m.metalness ?? 0,
    roughness: m.roughness ?? 1,
    opacity: m.opacity,
    alphaMode: m.transparent ? 'BLEND' : m.alphaTest > 0 ? 'MASK' : 'OPAQUE',
    ...(m.alphaTest > 0 ? { alphaCutoff: m.alphaTest } : {}),
    doubleSided: m.side === THREE.DoubleSide,
    emissive: m.emissive ? (m.emissive.toArray().map(c => c * m.emissiveIntensity) as Rgb) : [0, 0, 0],
  }
}
