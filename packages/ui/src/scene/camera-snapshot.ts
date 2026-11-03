// A complete orbit-camera pose, independent of the transient framing animations.
import type { PerspectiveCamera, Quaternion, Vector3 } from 'three'

export interface OrbitCameraControls {
  target: Vector3
  cursor: Vector3
  enableDamping: boolean
  autoRotate: boolean
  update(): unknown
}

export interface CameraSnapshot {
  position: Vector3
  target: Vector3
  cursor: Vector3
  up: Vector3
  quaternion: Quaternion
  near: number
  far: number
  fov: number
  zoom: number
  fitRadius: number
}

export function snapshotCamera(camera: PerspectiveCamera, controls: OrbitCameraControls, fitRadius: number): CameraSnapshot {
  return {
    position: camera.position.clone(), target: controls.target.clone(), cursor: controls.cursor.clone(),
    up: camera.up.clone(), quaternion: camera.quaternion.clone(),
    near: camera.near, far: camera.far, fov: camera.fov, zoom: camera.zoom, fitRadius,
  }
}

/** Stop every automatic move before draining orbit inertia, so the next frame cannot overwrite the restored pose. */
export function restoreCamera(camera: PerspectiveCamera, controls: OrbitCameraControls, pose: CameraSnapshot, stop: () => void): number {
  stop()
  const damping = controls.enableDamping, autoRotate = controls.autoRotate
  controls.enableDamping = false
  controls.autoRotate = false
  controls.update()
  controls.target.copy(pose.target)
  controls.cursor.copy(pose.cursor)
  camera.position.copy(pose.position)
  camera.up.copy(pose.up)
  camera.near = pose.near
  camera.far = pose.far
  camera.fov = pose.fov
  camera.zoom = pose.zoom
  controls.update()
  camera.quaternion.copy(pose.quaternion)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  controls.enableDamping = damping
  controls.autoRotate = autoRotate
  return pose.fitRadius
}
