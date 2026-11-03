// free of three.js, so Node imports it in the tests

/** The area in mm² up to which a highlight keeps its full strength: a 0.3 mm track 25 mm long. */
export const HL_REF_AREA = 8
/** The weakest tint of a large item, as a fraction of the full one. */
export const HL_MIN = 0.15
/** Below this strength an item also gets an outline at full strength, so a faint tint still shows where it ends. */
export const HL_OUTLINE_BELOW = 0.7
/** Strengths come in steps of 1/HL_STEPS, so the materials of a state have few variants. */
export const HL_STEPS = 16

/** 1 up to HL_REF_AREA mm², then 1 / sqrt(area / HL_REF_AREA), clamped at `min`; an unknown area counts as small. */
export function hlStrength(area: number | null | undefined, min = HL_MIN): number {
  if (area == null || !Number.isFinite(area) || area <= HL_REF_AREA) return 1
  return Math.max(min, Math.sqrt(HL_REF_AREA / area))
}

/** A strength rounded to its step, never 0. */
export function hlStep(s: number): number {
  const q = Math.round(Math.min(1, Math.max(0, s)) * HL_STEPS) / HL_STEPS
  return q > 0 ? q : 1 / HL_STEPS
}

/** The signed area in mm², holes winding against their ring taken out; the plain sum when that is under half the largest ring. */
export function ringsArea(rings: readonly (readonly (readonly [number, number])[])[]): number {
  let signed = 0,
    abs = 0,
    largest = 0
  for (const r of rings) {
    let a = 0
    for (let i = 0, n = r.length; i < n; i++) {
      const p = r[i],
        q = r[(i + 1) % n]
      a += p[0] * q[1] - q[0] * p[1]
    }
    a /= 2
    signed += a
    abs += Math.abs(a)
    largest = Math.max(largest, Math.abs(a))
  }
  return Math.abs(signed) >= largest / 2 ? Math.abs(signed) : abs
}
