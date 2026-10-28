// a retargeted spring keeps its value and velocity; a retargeted tween starts from where it is

/** A cubic bezier timing curve, as CSS cubic-bezier(x1, y1, x2, y2): progress in, eased progress out. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1,
    bx = 3 * (x2 - x1) - cx,
    ax = 1 - cx - bx
  const cy = 3 * y1,
    by = 3 * (y2 - y1) - cy,
    ay = 1 - cy - by
  const x = (t: number) => ((ax * t + bx) * t + cx) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  const y = (t: number) => ((ay * t + by) * t + cy) * t
  return (p: number) => {
    if (p <= 0) return 0
    if (p >= 1) return 1
    let t = p
    for (let i = 0; i < 6; i++) {
      const e = x(t) - p,
        d = dx(t)
      if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break
      t -= e / d
    }
    t = Math.min(1, Math.max(0, t))
    return y(t)
  }
}
/** The iOS ease-out standard curve, CSS `ease`: for opacity and tint ramps. */
export const EASE_OUT = cubicBezier(0.25, 0.1, 0.25, 1)
/** Apple's system ease-in-out curve. */
export const SYSTEM = cubicBezier(0.42, 0, 0.58, 1)
export const EASE_OUT_CSS = 'cubic-bezier(0.25, 0.1, 0.25, 1)'

/** A damped spring with unit mass, set like SwiftUI: `response` is the undamped period in seconds, `damping` the damping fraction. */
export class Spring {
  value: number
  target: number
  velocity = 0
  private k: number
  private c: number
  constructor(value: number, { response = 0.35, damping = 0.85 } = {}) {
    this.value = this.target = value
    this.k = ((2 * Math.PI) / response) ** 2
    this.c = (4 * Math.PI * damping) / response
  }
  /** Retarget: the value and velocity carry on from where they are. */
  set(target: number) {
    this.target = target
  }
  /** Jump to a value with no motion. */
  snap(v: number) {
    this.value = this.target = v
    this.velocity = 0
  }
  get settled() {
    return this.value === this.target && this.velocity === 0
  }
  /** Advance by dt seconds; returns true while still moving. */
  step(dt: number): boolean {
    if (this.settled) return false
    // semi-implicit Euler in steps of at most 4 ms, stable for the stiffness used here
    let left = Math.min(dt, 0.1)
    while (left > 0) {
      const h = Math.min(left, 0.004)
      const a = -this.k * (this.value - this.target) - this.c * this.velocity
      this.velocity += a * h
      this.value += this.velocity * h
      left -= h
    }
    const scale = Math.max(1e-3, Math.abs(this.target) * 1e-4)
    if (Math.abs(this.value - this.target) < scale && Math.abs(this.velocity) < scale * 10) {
      this.value = this.target
      this.velocity = 0
      return false
    }
    return true
  }
}

/** A value that follows a timing curve to its target over a fixed duration; a new target starts from the current value. */
export class Tween {
  value: number
  private from: number
  private to: number
  private start = 0
  constructor(
    value: number,
    private curve: (t: number) => number = EASE_OUT,
    private duration = 140,
  ) {
    this.value = this.from = this.to = value
  }
  get target() {
    return this.to
  }
  set(to: number, now = performance.now()) {
    if (to === this.to) return
    this.from = this.value
    this.to = to
    this.start = now
  }
  snap(v: number) {
    this.value = this.from = this.to = v
  }
  /** Advance to `now` in ms; returns true while still moving. */
  step(now: number): boolean {
    if (this.value === this.to) return false
    const k = Math.min(1, (now - this.start) / this.duration)
    this.value = this.from + (this.to - this.from) * this.curve(k)
    if (k >= 1) this.value = this.to
    return this.value !== this.to
  }
}

/** tween(from, to, { curve, duration }): a Tween already running toward `to`. */
export function tween(from: number, to: number, { curve = EASE_OUT, duration = 140 }: { curve?: (t: number) => number; duration?: number } = {}): Tween {
  const t = new Tween(from, curve, duration)
  t.set(to)
  return t
}
