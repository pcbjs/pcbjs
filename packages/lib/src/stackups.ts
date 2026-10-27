// Layers top to bottom, thicknesses in mm, copper weight in oz.
import type { Stackup } from '@pcbjs/core'
import { deepFreeze } from '@pcbjs/core/rules'
import { twoLayer } from '@pcbjs/core/stackups'

// the builders live in @pcbjs/core, which the board defaults need
export { OZ, twoLayer, fourLayer, sixLayer, eightLayer, defaultStackup, type StackupOptions } from '@pcbjs/core/stackups'

/** JLCPCB 2-layer default order: https://jlcpcb.com/capabilities/pcb-capabilities 2026-10-23. */
export const JLCPCB_2L: Readonly<Stackup> = deepFreeze(twoLayer({ finish: 'HASL' }))

/** JLCPCB JLC04161H-7628, the default 4-layer stackup: https://jlcpcb.com/impedance 2026-10-23. */
export const JLCPCB_4L_7628: Readonly<Stackup> = deepFreeze({
  layers: [
    { type: 'silk', side: 'F', color: 'White' }, { type: 'paste', side: 'F' }, { type: 'mask', side: 'F', color: 'Green' },
    { type: 'copper', name: 'F.Cu', thickness: 0.035, weight: 1 },
    { type: 'prepreg', material: '7628', thickness: 0.2104, er: 4.4, lossTangent: 0.02 },
    { type: 'copper', name: 'In1.Cu', thickness: 0.0152, weight: 0.5 },
    { type: 'core', material: 'FR4', thickness: 1.065, er: 4.6, lossTangent: 0.02 },
    { type: 'copper', name: 'In2.Cu', thickness: 0.0152, weight: 0.5 },
    { type: 'prepreg', material: '7628', thickness: 0.2104, er: 4.4, lossTangent: 0.02 },
    { type: 'copper', name: 'B.Cu', thickness: 0.035, weight: 1 },
    { type: 'mask', side: 'B', color: 'Green' }, { type: 'paste', side: 'B' }, { type: 'silk', side: 'B', color: 'White' },
  ],
  finish: 'HASL', maskColor: 'Green', silkColor: 'White', thickness: 1.6,
} satisfies Stackup)

/** JLCPCB JLC04161H-3313, thin prepreg for 50 ohm near 0.17 mm at fine pitch: https://jlcpcb.com/impedance 2026-10-25. */
export const JLCPCB_4L_3313: Readonly<Stackup> = deepFreeze({
  layers: [
    { type: 'silk', side: 'F', color: 'White' }, { type: 'paste', side: 'F' }, { type: 'mask', side: 'F', color: 'Green' },
    { type: 'copper', name: 'F.Cu', thickness: 0.035, weight: 1 },
    { type: 'prepreg', material: '3313', thickness: 0.0994, er: 4.1, lossTangent: 0.02 },
    { type: 'copper', name: 'In1.Cu', thickness: 0.0152, weight: 0.5 },
    { type: 'core', material: 'FR4', thickness: 1.265, er: 4.6, lossTangent: 0.02 },
    { type: 'copper', name: 'In2.Cu', thickness: 0.0152, weight: 0.5 },
    { type: 'prepreg', material: '3313', thickness: 0.0994, er: 4.1, lossTangent: 0.02 },
    { type: 'copper', name: 'B.Cu', thickness: 0.035, weight: 1 },
    { type: 'mask', side: 'B', color: 'Green' }, { type: 'paste', side: 'B' }, { type: 'silk', side: 'B', color: 'White' },
  ],
  finish: 'HASL', maskColor: 'Green', silkColor: 'White', thickness: 1.6,
} satisfies Stackup)

/** OSH Park 2-layer: https://docs.oshpark.com/services/two-layer/ 2026-10-23. */
export const OSHPARK_2L: Readonly<Stackup> = deepFreeze({
  layers: [
    { type: 'silk', side: 'F', thickness: 0.0152, color: 'White' }, { type: 'paste', side: 'F' }, { type: 'mask', side: 'F', thickness: 0.0152, color: 'Purple' },
    { type: 'copper', name: 'F.Cu', thickness: 0.0356, weight: 1 },
    { type: 'core', material: 'FR4', thickness: 1.524, er: 4.5 },
    { type: 'copper', name: 'B.Cu', thickness: 0.0356, weight: 1 },
    { type: 'mask', side: 'B', thickness: 0.0152, color: 'Purple' }, { type: 'paste', side: 'B' }, { type: 'silk', side: 'B', thickness: 0.0152, color: 'White' },
  ],
  finish: 'ENIG', maskColor: 'Purple', silkColor: 'White', thickness: 1.6,
} satisfies Stackup)

/** OSH Park 4-layer FR408-HR, er 3.61 at 1 GHz: https://docs.oshpark.com/services/four-layer/ 2026-10-23. */
export const OSHPARK_4L: Readonly<Stackup> = deepFreeze({
  layers: [
    { type: 'silk', side: 'F', thickness: 0.0152, color: 'White' }, { type: 'paste', side: 'F' }, { type: 'mask', side: 'F', thickness: 0.0152, color: 'Purple' },
    { type: 'copper', name: 'F.Cu', thickness: 0.0432, weight: 1 },
    { type: 'prepreg', material: 'FR408HR 2113', thickness: 0.2, er: 3.61 },
    { type: 'copper', name: 'In1.Cu', thickness: 0.0173, weight: 0.5 },
    { type: 'core', material: 'FR408HR', thickness: 0.9906, er: 3.61 },
    { type: 'copper', name: 'In2.Cu', thickness: 0.0173, weight: 0.5 },
    { type: 'prepreg', material: 'FR408HR 2113', thickness: 0.2, er: 3.61 },
    { type: 'copper', name: 'B.Cu', thickness: 0.0432, weight: 1 },
    { type: 'mask', side: 'B', thickness: 0.0152, color: 'Purple' }, { type: 'paste', side: 'B' }, { type: 'silk', side: 'B', thickness: 0.0152, color: 'White' },
  ],
  finish: 'ENIG', maskColor: 'Purple', silkColor: 'White', thickness: 1.6,
} satisfies Stackup)
