// SVG path data in mm; rectangles by their top-left corner, circles and slots by their centres.

// at most 4 decimals, no trailing zeros, so `rect(30, 20)` reads `M 0 0 H 30 V 20 H 0 Z`
function n(v: number): string {
  const r = Math.round(v * 1e4) / 1e4
  return String(Object.is(r, -0) ? 0 : r)
}

function check(name: string, values: Record<string, number>): void {
  for (const [k, v] of Object.entries(values))
    if (!Number.isFinite(v)) throw new TypeError(`${name}: ${k} must be a finite number in mm, got ${String(v)}`)
}

/** A w by h rectangle with its top-left corner at (x, y), clockwise from that corner. */
export function rect(w: number, h: number, x = 0, y = 0): string {
  check('rect', { w, h, x, y })
  return `M ${n(x)} ${n(y)} H ${n(x + w)} V ${n(y + h)} H ${n(x)} Z`
}

/** A w by h rectangle with its top-left corner at (x, y) and corners rounded to r, clamped to half the shorter side. */
export function roundedRect(w: number, h: number, r: number, x = 0, y = 0): string {
  check('roundedRect', { w, h, r, x, y })
  r = Math.min(r, w / 2, h / 2)
  if (r <= 0) return rect(w, h, x, y)
  const a = `A ${n(r)} ${n(r)} 0 0 1`
  return `M ${n(x + r)} ${n(y)} H ${n(x + w - r)} ${a} ${n(x + w)} ${n(y + r)} V ${n(y + h - r)} ${a} ${n(x + w - r)} ${n(y + h)} H ${n(x + r)} ${a} ${n(x)} ${n(y + h - r)} V ${n(y + r)} ${a} ${n(x + r)} ${n(y)} Z`
}

/** A circle of diameter d centred at (cx, cy), as two half arcs. A round board in the top-left frame is `circle(d, d / 2, d / 2)`. */
export function circle(d: number, cx = 0, cy = 0): string {
  check('circle', { d, cx, cy })
  const r = d / 2
  return `M ${n(cx - r)} ${n(cy)} A ${n(r)} ${n(r)} 0 1 0 ${n(cx + r)} ${n(cy)} A ${n(r)} ${n(r)} 0 1 0 ${n(cx - r)} ${n(cy)} Z`
}

/** A slot w wide with round ends whose centre line runs from (x1, y1) to (x2, y2). */
export function slot(x1: number, y1: number, x2: number, y2: number, w: number): string {
  check('slot', { x1, y1, x2, y2, w })
  const len = Math.hypot(x2 - x1, y2 - y1)
  if (len === 0) return circle(w, x1, y1)
  const r = w / 2
  // the normal to the centre line, half the width long
  const nx = (-(y2 - y1) / len) * r, ny = ((x2 - x1) / len) * r
  const a = `A ${n(r)} ${n(r)} 0 0 0`
  return `M ${n(x1 + nx)} ${n(y1 + ny)} L ${n(x2 + nx)} ${n(y2 + ny)} ${a} ${n(x2 - nx)} ${n(y2 - ny)} L ${n(x1 - nx)} ${n(y1 - ny)} ${a} ${n(x1 + nx)} ${n(y1 + ny)} Z`
}
