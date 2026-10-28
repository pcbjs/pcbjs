// Models fetched on first use into the project's .pcbjs/models; none ships with @pcbjs/lib.
import type { ModelSpec, StepModelSpec } from '@pcbjs/core/types'

type Box = Extract<ModelSpec, { kind: 'box' }>
type Xyz = [number, number, number]

/** The dashed outline a part shows until its model is fetched, or for good with a `reason`. */
export const outline = (w: number, h: number, height: number, color?: string, reason?: string): Box => ({
  kind: 'box',
  w,
  h,
  height,
  ...(color ? { color } : {}),
  ...(reason ? { reason } : {}),
})

/** A model from `kicad:<Lib>.3dshapes/<Name>.step`, `lcsc:C123` or an https URL, in KiCad's transform: offset in mm with y up, rotate in degrees. */
export function fetched(source: string, box: Box, offset?: Xyz, rotate?: Xyz): StepModelSpec {
  return { kind: 'step', step: source, ...(offset ? { offset } : {}), ...(rotate ? { rotate } : {}), fallback: box }
}

/** A model of KiCad's 3D library, by its path under the library root. */
export const kicad3d = (path: string, box: Box, offset?: Xyz, rotate?: Xyz): StepModelSpec => fetched(`kicad:${path}`, box, offset, rotate)
