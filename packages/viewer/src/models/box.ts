// an IC package body; one with no width, depth or height draws nothing
import * as THREE from 'three'
import type { ModelSpec } from '@pcbjs/core/types'
import { standard } from './materials'
import { mesh, roundedBox } from './geom'

type BoxSpec = Extract<ModelSpec, { kind: 'ic' }>

export function boxModel(spec: BoxSpec): THREE.Object3D {
  if (!(spec.w > 0 && spec.h > 0 && spec.height > 0)) return new THREE.Group()
  const w = Math.max(0.2, spec.w),
    h = Math.max(0.2, spec.h),
    d = Math.max(0.05, spec.height)
  const g = new THREE.Group()
  g.add(mesh(roundedBox(w, h, d, Math.min(0.1, w / 8, h / 8)), standard(spec.color ?? '#2b2b2b', 0.6)))
  return g
}
