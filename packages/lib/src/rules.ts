// Millimetres. Sources: the fabs' capability pages on the dates given.
import type { Rules } from '@pcbjs/core'
import { BASE, deepFreeze, mergeRules } from '@pcbjs/core/rules'

// deepFreeze, cloneData, mergeRules, BASE and defaultVia live in @pcbjs/core, which the board defaults need
export { deepFreeze, cloneData, mergeRules, BASE, defaultVia, THERMAL, thermalRules, resolveRules, holeClearanceOn, holeToHole, withMaskColor } from '@pcbjs/core/rules'

const fab = (overrides: Partial<Rules>): Readonly<Rules> => deepFreeze(mergeRules(BASE, overrides))

/** JLCPCB standard, 2 to 8 layers, 1 oz outer: https://jlcpcb.com/capabilities/pcb-capabilities 2026-10-23; 0.127 and via 0.20 / 0.45 are the no-review, no-surcharge figures. */
export const JLCPCB: Readonly<Rules> = fab({
  clearance: 0.127,
  minTrackWidth: 0.127,
  edgeClearance: 0.2, // routed edge; V-cut edges need 0.4
  holeClearance: { inner: 0.28, outer: 0.28, via: 0.2 }, // PTH to track 0.28, via hole to track 0.2
  minViaDrill: 0.2,
  minViaDiameter: 0.45,
  minAnnularRing: 0.125,
  minPadAnnularRing: 0.18, // 2-layer 1 oz absolute; multilayer 0.15, 0.25 recommended
  minDrill: 0.2,
  minHoleToHole: { pad: 0.45, via: 0.2 }, // pad hole to pad hole 0.45, via hole to via hole 0.2
  silkMinWidth: 0.15,
  silkToPad: 0.15,
  silkMinHeight: 1,
  maskWeb: 0.1, // soldermask bridge at 1 oz: green, red, yellow, blue, purple
  maskWebByColor: { Black: 0.13, White: 0.13 },
})

/** PCBWay standard: https://www.pcbway.com/capabilities.html 2026-10-23; hole spacings are the advanced tier's, the standard tier states none. */
export const PCBWAY: Readonly<Rules> = fab({
  clearance: 0.1,
  minTrackWidth: 0.1,
  edgeClearance: 0.25,
  holeClearance: 0.2,
  minViaDrill: 0.2,
  minViaDiameter: 0.5,
  minAnnularRing: 0.15,
  minPadAnnularRing: 0.15,
  minDrill: 0.2,
  minHoleToHole: 0.41,
  silkMinWidth: 0.15,
  silkMinHeight: 0.8,
})

/** OSH Park 2 and 4 layers: https://docs.oshpark.com/services/two-layer/ and /four-layer/ 2026-10-23; the 2-layer 6 / 6 mil is taken for both. */
export const OSHPARK: Readonly<Rules> = fab({
  clearance: 0.1524,
  minTrackWidth: 0.1524,
  edgeClearance: 0.381,
  maskExpansion: 0.0508,
  holeClearance: 0.254,
  minViaDrill: 0.254,
  minViaDiameter: 0.508,
  minAnnularRing: 0.127,
  minPadAnnularRing: 0.127,
  minDrill: 0.254,
  minHoleToHole: 0.127,
  silkMinWidth: 0.127,
})

/** Eurocircuits class 6C, its pooling class: the figures as commonly published, since the class table at https://www.eurocircuits.com/technical-guidelines/pcb-design-guidelines/classification/ is an image; verify before ordering. */
export const EUROCIRCUITS: Readonly<Rules> = fab({
  clearance: 0.15,
  minTrackWidth: 0.15,
  holeClearance: 0.2,
  minViaDrill: 0.25,
  minViaDiameter: 0.55,
  minAnnularRing: 0.15,
  minPadAnnularRing: 0.15,
  minDrill: 0.25,
})

/** Advanced PCB standard spec, anything finer is a custom order: https://www.advancedpcb.com/en-us/resources/manufacturing-capabilities/ 2026-10-23. */
export const ADVANCEDPCB: Readonly<Rules> = fab({
  clearance: 0.127,
  minTrackWidth: 0.127,
  edgeClearance: 0.254,
  maskExpansion: 0.0762,
  holeClearance: 0.254,
  minViaDrill: 0.254,
  minViaDiameter: 0.508,
  minAnnularRing: 0.127,
  minPadAnnularRing: 0.1778,
  minDrill: 0.254,
  minHoleToHole: 0.305,
  silkMinWidth: 0.127,
})
