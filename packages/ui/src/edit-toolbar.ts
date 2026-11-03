import { parseToken, LENGTH_UNITS } from '@pcbjs/core/internal/units'

export const GRID_STEPS = [2.54, 1.27, 1, 0.5, 0.25, 0.1, 0.05, 0.0254, 0.01]
export const segmentIndices = (steps: readonly { op: string }[]): number[] => steps.flatMap((s, i) => /^[HhVvLlAaXZ]$/.test(s.op) ? [i] : [])
export const TRACE_METHODS = [
  { value: 'L', label: '↗ Straight · L', description: 'Draw a straight segment to a point' },
  { value: 'H', label: '↔ Horizontal · H', description: 'Draw horizontally, keeping the start Y' },
  { value: 'V', label: '↕ Vertical · V', description: 'Draw vertically, keeping the start X' },
  { value: 'A', label: '◜ Arc · A', description: 'Draw an arc to a point, using the current sweep or 90°' },
  { value: 'X', label: '⌁ Autoroute · X', description: 'Find a routed path to the endpoint' },
  { value: 'Z', label: '→ Finish straight · Z', description: 'Draw straight to the route destination' },
]
export const gridChoices = (pitch: number): number[] => [...new Set([...GRID_STEPS, pitch, pitch / 2, pitch / 4, pitch / 10])].filter(n => n > 0).sort((a, b) => b - a)
type Placement = { at?: [number, number, number]; m: [number, number, number, number, number, number] }
export function localPoint(m: Placement['m'], point: [number, number]): [number, number] {
  const [a, b, c, d, x, y] = m, det = a * d - b * c, u = point[0] - x, v = point[1] - y
  return [(d * u - c * v) / det, (-b * u + a * v) / det]
}
export const worldPoint = (m: Placement['m'], point: [number, number]): [number, number] => [m[0] * point[0] + m[2] * point[1] + m[4], m[1] * point[0] + m[3] * point[1] + m[5]]
export function localPose(node: Placement): [number, number, number] | null {
  if (!node.at) return null
  const [a, b, c, d, x, y] = node.m, det = a * d - b * c
  const u = node.at[0] - x, v = node.at[1] - y
  const angle = -Math.atan2(det < 0 ? -b : b, det < 0 ? -a : a) * 180 / Math.PI
  return [+((d * u - c * v) / det).toFixed(6), +((-b * u + a * v) / det).toFixed(6), +((node.at[2] - angle) * (det < 0 ? -1 : 1)).toFixed(4)]
}
export const worldDelta = (node: Placement, delta: [number, number]): [number, number] => [node.m[0] * delta[0] + node.m[2] * delta[1], node.m[1] * delta[0] + node.m[3] * delta[1]]
export function lengthValue(text: string): number | null {
  const token = parseToken(text.trim()), scale = token && LENGTH_UNITS[token.unit]
  return token && scale !== undefined && Number.isFinite(token.num * scale) ? token.num * scale : null
}
