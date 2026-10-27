// the background grid of the 2D, schematic and 3D views; free of Vue and the DOM, so Node imports it in the tests
export type Box = [number, number, number, number]
export interface Steps { minor: number; major: number }

/** screen pixels the minor step spans at least */
export const MIN_PX = 8

/** The board grid in mm at `ppm` screen pixels per mm: 1 and 10 at normal zoom, 0.1 and 1 zoomed in, 10 and 100 zoomed out. */
export function gridStep(ppm: number): Steps {
  const minor = ppm * 0.1 >= MIN_PX ? 0.1 : ppm >= MIN_PX ? 1 : 10
  return { minor, major: minor * 10 }
}

/** The schematic grid: the drawing's grid, 2.54 mm, and ten of it. */
export const schStep = (grid: number): Steps => ({ minor: grid, major: grid * 10 })

/** The grid's paths in view units for a view box `vb` at `px` units per screen pixel, lines through `origin` snapped to pixel centres; a step under 4 pixels is left out. */
export function gridPaths(vb: Box, px: number, steps: Steps, origin: [number, number] = [0, 0]): { minor: string; major: string; axes: string } {
  const [x0, y0, w, h] = vb, x1 = x0 + w, y1 = y0 + h
  const snap = (v: number, o: number) => +(o + (Math.round((v - o) / px - 0.5) + 0.5) * px).toFixed(5)
  const lines = (step: number, skip?: number) => {
    if (step / px < 4) return ''
    const keep = (k: number) => !skip || Math.abs((k * step) / skip - Math.round((k * step) / skip)) > 1e-6
    let d = ''
    for (let k = Math.ceil((x0 - origin[0]) / step); origin[0] + k * step <= x1; k++) if (keep(k)) d += `M${snap(origin[0] + k * step, x0)} ${y0}V${y1}`
    for (let k = Math.ceil((y0 - origin[1]) / step); origin[1] + k * step <= y1; k++) if (keep(k)) d += `M${x0} ${snap(origin[1] + k * step, y0)}H${x1}`
    return d
  }
  let axes = ''
  if (origin[0] >= x0 && origin[0] <= x1) axes += `M${snap(origin[0], x0)} ${y0}V${y1}`
  if (origin[1] >= y0 && origin[1] <= y1) axes += `M${x0} ${snap(origin[1], y0)}H${x1}`
  const major = lines(steps.major)
  return { minor: lines(steps.minor, major ? steps.major : undefined), major, axes }
}

/** A colour token as three takes it: `#rrggbb`, `#rgb` or `rgb()` and `rgba()` with commas, alpha 1 when it has none. */
export function parseColor(css: string): { hex: string; alpha: number } | null {
  const s = css.trim()
  if (/^#[0-9a-f]{6}$/i.test(s)) return { hex: s.toLowerCase(), alpha: 1 }
  if (/^#[0-9a-f]{3}$/i.test(s)) return { hex: '#' + [...s.slice(1)].map(c => c + c).join('').toLowerCase(), alpha: 1 }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s)
  if (!m) return null
  const hex = '#' + [m[1], m[2], m[3]].map(v => Math.round(+v).toString(16).padStart(2, '0')).join('')
  return { hex, alpha: m[4] === undefined ? 1 : +m[4] }
}
