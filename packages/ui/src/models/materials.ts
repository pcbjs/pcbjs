// created once per page and never disposed
import * as THREE from 'three'
import { LED_GLOW } from '@pcbjs/export/internal/scene/colors'
import { colorKey, type Rgb } from './sink'

const cache = new Map<string, THREE.Material>()
// the first material made in each colour, which a generated mesh of that colour is drawn with
const byColor = new Map<string, THREE.MeshStandardMaterial>()

/** A shared MeshStandardMaterial, one instance per set of parameters. */
export function standard(color: string, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = JSON.stringify([color, roughness, metalness, extra])
  let m = cache.get(key) as THREE.MeshStandardMaterial | undefined
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra })
    cache.set(key, m)
    const c = colorKey([m.color.r, m.color.g, m.color.b])
    if (!byColor.has(c)) byColor.set(c, m)
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
export function stepMaterial(c: [number, number, number]): THREE.MeshStandardMaterial {
  const key = c.map(v => v.toFixed(3)).join()
  let m = files.get(key)
  if (!m) {
    // light greys and golds are the metal of pins and shells, the rest plastic
    const col = new THREE.Color().setRGB(c[0], c[1], c[2])
    const hsl = col.getHSL({ h: 0, s: 0, l: 0 })
    const metal = hsl.l > 0.25 && (hsl.s < 0.15 || (hsl.h > 0.08 && hsl.h < 0.17 && hsl.s > 0.3))
    m = new THREE.MeshStandardMaterial({ color: col, roughness: metal ? 0.35 : 0.6, metalness: metal ? 0.7 : 0.05 })
    files.set(key, m)
  }
  return m
}

/** The material a generated body's mesh of this colour was built with, else a model file's material of that colour. */
export function materialOf(c: Rgb): THREE.MeshStandardMaterial {
  return byColor.get(colorKey(c)) ?? stepMaterial(c)
}
