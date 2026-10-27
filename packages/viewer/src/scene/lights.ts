// the sun stands front left so its glint in the glossy mask falls outside the preset views
export type Dir = [number, number, number]

/** the main light, from the front left and above, and a weak one from below for the back */
export const SUN: Dir = [-30, -60, 100]
export const UNDER: Dir = [30, -40, -80]
/** the camera direction of the iso preset and of a part's close-up, from the target toward the camera */
export const ISO_DIR: Dir = [0.55, -0.95, 0.9]
export const FOCUS_DIR: Dir = [0.4, -0.8, 1]

/** The angle in degrees between a camera direction and the glint of a light in a horizontal face, its mirror image. */
export function glintAngle(light: Dir, camera: Dir): number {
  const n = (v: Dir) => Math.hypot(...v)
  const g: Dir = [-light[0], -light[1], light[2]]
  const c = (g[0] * camera[0] + g[1] * camera[1] + g[2] * camera[2]) / (n(g) * n(camera))
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI
}
