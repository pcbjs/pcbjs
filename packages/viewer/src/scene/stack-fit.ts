// the camera move that frames an explode toggle, tied to the separation spring so both land together
import * as THREE from 'three'

export type Pose = { target: THREE.Vector3; r: number; polar: number; azimuth: number }

export function poseOf(target: THREE.Vector3, position: THREE.Vector3): Pose {
  const off = position.clone().sub(target), r = off.length() || 1
  return { target: target.clone(), r, polar: Math.acos(Math.max(-1, Math.min(1, off.z / r))), azimuth: Math.atan2(off.y, off.x) }
}

export function positionOf(p: Pose): THREE.Vector3 {
  const s = Math.sin(p.polar)
  return p.target.clone().add(new THREE.Vector3(p.r * s * Math.cos(p.azimuth), p.r * s * Math.sin(p.azimuth), p.r * Math.cos(p.polar)))
}

/** A fit that follows the separation from s0 to s1: at s1 the camera stands at `to`; a slider drag or a camera grab drops it. */
export class StackFit {
  private move: { from: Pose; to: Pose; s0: number; s1: number } | null = null
  get active() { return this.move !== null }
  /** False when the separation does not move, so there is nothing to follow. */
  start(from: Pose, to: Pose, s0: number, s1: number): boolean {
    if (s0 === s1) { this.move = null; return false }
    let az = to.azimuth
    while (az - from.azimuth > Math.PI) az -= 2 * Math.PI
    while (az - from.azimuth < -Math.PI) az += 2 * Math.PI
    this.move = { from, to: { ...to, azimuth: az }, s0, s1 }
    return true
  }
  stop() { this.move = null }
  /** The pose at separation s; the move ends when s reaches its target. */
  at(s: number): Pose | null {
    const m = this.move
    if (!m) return null
    const k = (s - m.s0) / (m.s1 - m.s0)
    if (s === m.s1) this.move = null
    const mix = (a: number, b: number) => a + (b - a) * k
    return { target: m.from.target.clone().lerp(m.to.target, k), r: mix(m.from.r, m.to.r), polar: mix(m.from.polar, m.to.polar), azimuth: mix(m.from.azimuth, m.to.azimuth) }
  }
}
