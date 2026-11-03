// The Math of V8 as Node builds it: the fdlibm of V8's base/ieee754.cc, its expressions kept as written. Chromium builds V8 with another
// libm, whose last bits differ for most inputs, so the browser compile installs these. Node's own build fuses a*b+c into one rounding
// where the C compiler contracts it, as clang does on arm64, and not on x86-64; `mad` is that step, plain or fused. Bit for bit, see tests.
const buf = new ArrayBuffer(8)
const f64 = new Float64Array(buf)
const u32 = new Uint32Array(buf)
// a little-endian double: u32[1] the high word with sign and exponent, u32[0] the low word
const hi = (x: number): number => ((f64[0] = x), u32[1] | 0)
const lo = (x: number): number => ((f64[0] = x), u32[0])
const words = (h: number, l: number): number => ((u32[1] = h), (u32[0] = l), f64[0])
const withLo = (x: number, l: number): number => ((f64[0] = x), (u32[0] = l), f64[0])
/** x times 2^k by its exponent field, as fdlibm adds k to the high word */
const scale = (x: number, k: number): number => ((f64[0] = x), (u32[1] = (u32[1] + (k << 20)) >>> 0), f64[0])

const SPLIT = 134217729
/** a * b + c in one rounding, by Dekker's exact product and an exact sum */
function fused(a: number, b: number, c: number): number {
  const p = a * b
  if (!Number.isFinite(p) || !Number.isFinite(c)) return p + c
  let t = SPLIT * a
  const ah = t - (t - a),
    al = a - ah
  t = SPLIT * b
  const bh = t - (t - b),
    bl = b - bh
  const e = ah * bh - p + ah * bl + al * bh + al * bl
  const s = p + c
  const v = s - p
  return s + (p - (s - v) + (c - v) + e)
}
const plain = (a: number, b: number, c: number): number => a * b + c

/** How Node computes a*b+c where its C compiler may contract: `fused` on arm64 builds, `plain` on x86-64. */
export type MathKind = 'plain' | 'fused'
let mad = plain

const NPIO2_HW = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c, 0x4025fdbb, 0x402921fb, 0x402c463a, 0x402f6a7a, 0x4031475c, 0x4032d97c, 0x40346b9c, 0x4035fdbb,
  0x40378fdb, 0x403921fb, 0x403ab41b, 0x403c463a, 0x403dd85a, 0x403f6a7a, 0x40407e4c, 0x4041475c, 0x4042106c, 0x4042d97c, 0x4043a28c, 0x40446b9c, 0x404534ac, 0x4045fdbb,
  0x4046c6cb, 0x40478fdb, 0x404858eb, 0x404921fb,
]
const INVPIO2 = 6.36619772367581382433e-1
const PIO2_1 = 1.57079632673412561417
const PIO2_1T = 6.07710050650619224932e-11
const PIO2_2 = 6.0771005063039659766e-11
const PIO2_2T = 2.02226624879595063154e-21
const PIO2_3 = 2.0222662487111664558e-21
const PIO2_3T = 8.47842766036889956997e-32

/** x reduced by n pi/2 as y0 + y1, for |x| up to 2^19 pi/2; null beyond, where fdlibm needs its long reduction. */
function remPio2(x: number, y: [number, number]): number | null {
  const hx = hi(x)
  const ix = hx & 0x7fffffff
  if (ix < 0x4002d97c) {
    const s = hx > 0 ? 1 : -1
    let z = x - s * PIO2_1
    if (ix !== 0x3ff921fb) {
      y[0] = z - s * PIO2_1T
      y[1] = z - y[0] - s * PIO2_1T
    } else {
      z -= s * PIO2_2
      y[0] = z - s * PIO2_2T
      y[1] = z - y[0] - s * PIO2_2T
    }
    return s
  }
  if (ix > 0x413921fb) return null
  let t = Math.abs(x)
  const n = mad(t, INVPIO2, 0.5) | 0
  const fn = n
  let r = mad(-fn, PIO2_1, t)
  let w = fn * PIO2_1T
  if (n < 32 && ix !== NPIO2_HW[n - 1]) y[0] = r - w
  else {
    const j = ix >> 20
    y[0] = r - w
    let i = j - ((hi(y[0]) >> 20) & 0x7ff)
    if (i > 16) {
      t = r
      w = fn * PIO2_2
      r = t - w
      w = mad(fn, PIO2_2T, -(t - r - w))
      y[0] = r - w
      i = j - ((hi(y[0]) >> 20) & 0x7ff)
      if (i > 49) {
        t = r
        w = fn * PIO2_3
        r = t - w
        w = mad(fn, PIO2_3T, -(t - r - w))
        y[0] = r - w
      }
    }
  }
  y[1] = r - y[0] - w
  if (hx < 0) {
    y[0] = -y[0]
    y[1] = -y[1]
    return -n
  }
  return n
}

const S1 = -1.66666666666666324348e-1,
  S2 = 8.33333333332248946124e-3,
  S3 = -1.98412698298579493134e-4,
  S4 = 2.75573137070700676789e-6,
  S5 = -2.50507602534068634195e-8,
  S6 = 1.58969099521155010221e-10

function kSin(x: number, y: number, iy: number): number {
  const ix = hi(x) & 0x7fffffff
  if (ix < 0x3e400000 && (x | 0) === 0) return x
  const z = x * x
  const v = z * x
  const r = mad(z, mad(z, mad(z, mad(z, S6, S5), S4), S3), S2)
  if (iy === 0) return mad(v, mad(z, r, S1), x)
  return x - mad(-v, S1, mad(z, mad(0.5, y, -(v * r)), -y))
}

const C1 = 4.16666666666666019037e-2,
  C2 = -1.38888888888741095749e-3,
  C3 = 2.48015872894767294178e-5,
  C4 = -2.75573143513906633035e-7,
  C5 = 2.0875723212981748279e-9,
  C6 = -1.13596475577881948265e-11

function kCos(x: number, y: number): number {
  const ix = hi(x) & 0x7fffffff
  if (ix < 0x3e400000 && (x | 0) === 0) return 1
  const z = x * x
  const r = z * mad(z, mad(z, mad(z, mad(z, mad(z, C6, C5), C4), C3), C2), C1)
  if (ix < 0x3fd33333) return 1 - mad(0.5, z, -mad(z, r, -(x * y)))
  const qx = ix > 0x3fe90000 ? 0.28125 : words(ix - 0x00200000, 0)
  const iz = mad(0.5, z, -qx)
  const a = 1 - qx
  return a - (iz - mad(z, r, -(x * y)))
}

const T = [
  3.33333333333334091986e-1, 1.33333333333201242699e-1, 5.39682539762260521377e-2, 2.18694882948595424599e-2, 8.86323982359930005737e-3, 3.59207910759131235356e-3,
  1.45620945432529025516e-3, 5.88041240820264096874e-4, 2.46463134818469906812e-4, 7.817944429395570923e-5, 7.14072491382608190305e-5, -1.85586374855275456654e-5,
  2.59073051863633712884e-5,
]
const PIO4 = 7.85398163397448278999e-1
const PIO4LO = 3.06161699786838301793e-17

/** -1 / w with w = x + r, carefully */
function negInverse(w: number, x: number, r: number): number {
  const z = withLo(w, 0)
  const v = r - (z - x)
  const a = -1 / w
  const t = withLo(a, 0)
  const s = mad(t, z, 1)
  return mad(a, mad(t, v, s), t)
}

function kTan(x: number, y: number, iy: number): number {
  const hx = hi(x)
  const ix = hx & 0x7fffffff
  if (ix < 0x3e300000 && (x | 0) === 0) {
    if ((ix | lo(x) | (iy + 1)) === 0) return 1 / Math.abs(x)
    if (iy === 1) return x
    return negInverse(x + y, x, y)
  }
  if (ix >= 0x3fe59428) {
    if (hx < 0) {
      x = -x
      y = -y
    }
    x = PIO4 - x + (PIO4LO - y)
    y = 0
  }
  const z = x * x
  const w = z * z
  let r = mad(w, mad(w, mad(w, mad(w, mad(w, T[11], T[9]), T[7]), T[5]), T[3]), T[1])
  const v = z * mad(w, mad(w, mad(w, mad(w, mad(w, T[12], T[10]), T[8]), T[6]), T[4]), T[2])
  const s = z * x
  r = mad(z, mad(s, r + v, y), y)
  r = mad(T[0], s, r)
  const sum = x + r
  if (ix >= 0x3fe59428) return (1 - ((hx >> 30) & 2)) * mad(-2, x - ((sum * sum) / (sum + iy) - r), iy)
  return iy === 1 ? sum : negInverse(sum, x, r)
}

const y2: [number, number] = [0, 0]

export function sin(x: number): number {
  const ix = hi(x) & 0x7fffffff
  if (ix <= 0x3fe921fb) return kSin(x, 0, 0)
  if (ix >= 0x7ff00000) return x - x
  const n = remPio2(x, y2)
  if (n === null) return Math.sin(x)
  switch (n & 3) {
    case 0:
      return kSin(y2[0], y2[1], 1)
    case 1:
      return kCos(y2[0], y2[1])
    case 2:
      return -kSin(y2[0], y2[1], 1)
    default:
      return -kCos(y2[0], y2[1])
  }
}

export function cos(x: number): number {
  const ix = hi(x) & 0x7fffffff
  if (ix <= 0x3fe921fb) return kCos(x, 0)
  if (ix >= 0x7ff00000) return x - x
  const n = remPio2(x, y2)
  if (n === null) return Math.cos(x)
  switch (n & 3) {
    case 0:
      return kCos(y2[0], y2[1])
    case 1:
      return -kSin(y2[0], y2[1], 1)
    case 2:
      return -kCos(y2[0], y2[1])
    default:
      return kSin(y2[0], y2[1], 1)
  }
}

export function tan(x: number): number {
  const ix = hi(x) & 0x7fffffff
  if (ix <= 0x3fe921fb) return kTan(x, 0, 1)
  if (ix >= 0x7ff00000) return x - x
  const n = remPio2(x, y2)
  if (n === null) return Math.tan(x)
  return kTan(y2[0], y2[1], 1 - ((n & 1) << 1))
}

const ATANHI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.570796326794896558]
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17]
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.1111110405462355788e-1, 9.09088713343650656196e-2, -7.69187620504482999495e-2,
  6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2, -3.6531572744216915527e-2, 1.62858201153657823623e-2,
]

export function atan(x: number): number {
  const hx = hi(x)
  const ix = hx & 0x7fffffff
  let id: number
  if (ix >= 0x44100000) {
    if (x !== x) return x + x
    return hx > 0 ? ATANHI[3] + ATANLO[3] : -ATANHI[3] - ATANLO[3]
  }
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e400000) return x
    id = -1
  } else {
    x = Math.abs(x)
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) {
        id = 0
        x = mad(2, x, -1) / (2 + x)
      } else {
        id = 1
        x = (x - 1) / (x + 1)
      }
    } else if (ix < 0x40038000) {
      id = 2
      x = (x - 1.5) / mad(1.5, x, 1)
    } else {
      id = 3
      x = -1 / x
    }
  }
  const z = x * x
  const w = z * z
  const s1 = z * mad(w, mad(w, mad(w, mad(w, mad(w, AT[10], AT[8]), AT[6]), AT[4]), AT[2]), AT[0])
  const s2 = w * mad(w, mad(w, mad(w, mad(w, AT[9], AT[7]), AT[5]), AT[3]), AT[1])
  if (id < 0) return mad(-x, s1 + s2, x)
  const r = ATANHI[id] - (mad(x, s1 + s2, -ATANLO[id]) - x)
  return hx < 0 ? -r : r
}

const TINY = 1e-300
const PI_O_4 = 7.85398163397448279e-1
const PI_O_2 = 1.570796326794896558
const PI = 3.141592653589793116
const PI_LO = 1.2246467991473531772e-16

export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return x + y
  const hx = hi(x),
    ix = hx & 0x7fffffff,
    lx = lo(x)
  const hy = hi(y),
    iy = hy & 0x7fffffff,
    ly = lo(y)
  if (((hx - 0x3ff00000) | lx) === 0) return atan(y)
  const m = ((hy >> 31) & 1) | ((hx >> 30) & 2)
  if ((iy | ly) === 0) return m < 2 ? y : m === 2 ? PI + TINY : -PI - TINY
  if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) return [PI_O_4 + TINY, -PI_O_4 - TINY, mad(3, PI_O_4, TINY), mad(-3, PI_O_4, -TINY)][m]
    return [0, -0, PI + TINY, -PI - TINY][m]
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY
  const k = (iy - ix) >> 20
  let z: number
  let n = m
  if (k > 60) {
    z = mad(0.5, PI_LO, PI_O_2)
    n &= 1
  } else if (hx < 0 && k < -60) z = 0
  else z = atan(Math.abs(y / x))
  switch (n) {
    case 0:
      return z
    case 1:
      return -z
    case 2:
      return PI - (z - PI_LO)
    default:
      return z - PI_LO - PI
  }
}

const PIO2_HI = 1.570796326794896558
const PIO2_LO = 6.12323399573676603587e-17
const PS0 = 1.66666666666666657415e-1,
  PS1 = -3.25565818622400915405e-1,
  PS2 = 2.01212532134862925881e-1,
  PS3 = -4.00555345006794114027e-2,
  PS4 = 7.91534994289814532176e-4,
  PS5 = 3.4793310759602116757e-5,
  QS1 = -2.40339491173441421878,
  QS2 = 2.02094576023350569471,
  QS3 = -6.8828397160545329303e-1,
  QS4 = 7.70381505559019352791e-2
const pOf = (z: number) => z * mad(z, mad(z, mad(z, mad(z, mad(z, PS5, PS4), PS3), PS2), PS1), PS0)
const qOf = (z: number) => mad(z, mad(z, mad(z, mad(z, QS4, QS3), QS2), QS1), 1)

export function acos(x: number): number {
  const hx = hi(x)
  const ix = hx & 0x7fffffff
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | lo(x)) === 0) return hx > 0 ? 0 : mad(2, PIO2_LO, PI)
    return (x - x) / (x - x)
  }
  if (ix < 0x3fe00000) {
    if (ix <= 0x3c600000) return PIO2_HI + PIO2_LO
    const z = x * x
    const r = pOf(z) / qOf(z)
    return PIO2_HI - (x - mad(-x, r, PIO2_LO))
  }
  if (hx < 0) {
    const z = (1 + x) * 0.5
    const p = pOf(z),
      q = qOf(z)
    const s = Math.sqrt(z)
    const w = mad(p / q, s, -PIO2_LO)
    return mad(-2, s + w, PI)
  }
  const z = (1 - x) * 0.5
  const s = Math.sqrt(z)
  const df = withLo(s, 0)
  const c = mad(-df, df, z) / (s + df)
  const p = pOf(z),
    q = qOf(z)
  const w = mad(p / q, s, c)
  return 2 * (df + w)
}

const O_THRESHOLD = 7.09782712893383973096e2
const U_THRESHOLD = -7.4513321910194110842e2
const LN2_HI = 6.9314718036912381649e-1
const LN2_LO = 1.90821492927058770002e-10
const INVLN2 = 1.442695040888963387
const TWOM1000 = 9.3326361850321887899e-302
const P1 = 1.66666666666666019037e-1,
  P2 = -2.77777777770155933842e-3,
  P3 = 6.61375632143793436117e-5,
  P4 = -1.6533902205465251539e-6,
  P5 = 4.13813679705723846039e-8

export function exp(x: number): number {
  let hx = hi(x)
  const xsb = (hx >>> 31) & 1
  hx &= 0x7fffffff
  if (hx >= 0x40862e42) {
    if (hx >= 0x7ff00000) return x !== x ? x + x : xsb === 0 ? x : 0
    if (x > O_THRESHOLD) return Infinity
    if (x < U_THRESHOLD) return 0
  }
  let hiPart = 0,
    loPart = 0,
    k = 0
  if (hx > 0x3fd62e42) {
    if (hx < 0x3ff0a2b2) {
      // V8's own special case: the reduction below gets the last bit of e wrong
      if (x === 1) return Math.E
      hiPart = x - (xsb ? -LN2_HI : LN2_HI)
      loPart = xsb ? -LN2_LO : LN2_LO
      k = 1 - xsb - xsb
    } else {
      k = mad(INVLN2, x, xsb ? -0.5 : 0.5) | 0
      hiPart = mad(-k, LN2_HI, x)
      loPart = k * LN2_LO
    }
    x = hiPart - loPart
  } else if (hx < 0x3e300000) return 1 + x
  const t = x * x
  const c = mad(-t, mad(t, mad(t, mad(t, mad(t, P5, P4), P3), P2), P1), x)
  if (k === 0) return 1 - ((x * c) / (c - 2) - x)
  const y = 1 - (loPart - (x * c) / (2 - c) - hiPart)
  return k >= -1021 ? (k === 1024 ? y * 2 * 2 ** 1023 : scale(y, k)) : scale(y, k + 1000) * TWOM1000
}

const TWO54 = 1.8014398509481984e16
const LG1 = 6.66666666666673513e-1,
  LG2 = 3.999999999940941908e-1,
  LG3 = 2.857142874366239149e-1,
  LG4 = 2.222219843214978396e-1,
  LG5 = 1.818357216161805012e-1,
  LG6 = 1.531383769920937332e-1,
  LG7 = 1.479819860511658591e-1

export function log(x: number): number {
  let hx = hi(x)
  const lx = lo(x)
  let k = 0
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity
    if (hx < 0) return NaN
    k -= 54
    x *= TWO54
    hx = hi(x)
  }
  if (hx >= 0x7ff00000) return x + x
  k += (hx >> 20) - 1023
  hx &= 0x000fffff
  const i0 = (hx + 0x95f64) & 0x100000
  x = words(hx | (i0 ^ 0x3ff00000), lo(x))
  k += i0 >> 20
  const f = x - 1
  const dk = k
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0) return k === 0 ? 0 : mad(dk, LN2_HI, dk * LN2_LO)
    const R = f * f * mad(-0.33333333333333333, f, 0.5)
    return k === 0 ? f - R : mad(dk, LN2_HI, -(mad(-dk, LN2_LO, R) - f))
  }
  const s = f / (2 + f)
  const z = s * s
  let i = hx - 0x6147a
  const w = z * z
  const j = 0x6b851 - hx
  const t1 = w * mad(w, mad(w, LG6, LG4), LG2)
  const t2 = z * mad(w, mad(w, mad(w, LG7, LG5), LG3), LG1)
  i |= j
  const R = t2 + t1
  if (i > 0) {
    const hfsq = 0.5 * f * f
    return k === 0 ? f - mad(-s, hfsq + R, hfsq) : mad(dk, LN2_HI, -(hfsq - mad(s, hfsq + R, dk * LN2_LO) - f))
  }
  return k === 0 ? mad(-s, f - R, f) : mad(dk, LN2_HI, -(mad(s, f - R, -(dk * LN2_LO)) - f))
}

const IVLN10 = 4.34294481903251816668e-1
const LOG10_2HI = 3.01029995663611771306e-1
const LOG10_2LO = 3.69423907715893078616e-13

export function log10(x: number): number {
  let hx = hi(x)
  const lx = lo(x)
  let k = 0
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity
    if (hx < 0) return NaN
    k -= 54
    x *= TWO54
    hx = hi(x)
  }
  if (hx >= 0x7ff00000) return x + x
  k += (hx >> 20) - 1023
  const i = (k >>> 31) & 1
  hx = (hx & 0x000fffff) | ((0x3ff - i) << 20)
  const y = k + i
  x = words(hx, lo(x))
  const z = mad(y, LOG10_2LO, IVLN10 * log(x))
  return mad(y, LOG10_2HI, z)
}

const Q1 = -3.33333333333331316428e-2,
  Q2 = 1.58730158725481460165e-3,
  Q3 = -7.93650757867487942473e-5,
  Q4 = 4.00821782732936239552e-6,
  Q5 = -2.01099218183624371326e-7

export function expm1(x: number): number {
  let hx = hi(x)
  const xsb = hx & 0x80000000
  hx &= 0x7fffffff
  if (hx >= 0x4043687a) {
    if (hx >= 0x40862e42) {
      if (hx >= 0x7ff00000) return x !== x ? x + x : xsb === 0 ? x : -1
      if (x > O_THRESHOLD) return Infinity
    }
    if (xsb !== 0) return -1
  }
  let k = 0,
    c = 0
  if (hx > 0x3fd62e42) {
    let h: number, l: number
    if (hx < 0x3ff0a2b2) {
      if (xsb === 0) {
        h = x - LN2_HI
        l = LN2_LO
        k = 1
      } else {
        h = x + LN2_HI
        l = -LN2_LO
        k = -1
      }
    } else {
      k = mad(INVLN2, x, xsb === 0 ? 0.5 : -0.5) | 0
      h = mad(-k, LN2_HI, x)
      l = k * LN2_LO
    }
    x = h - l
    c = h - x - l
  } else if (hx < 0x3c900000) return x
  const hfx = 0.5 * x
  const hxs = x * hfx
  const r1 = mad(hxs, mad(hxs, mad(hxs, mad(hxs, mad(hxs, Q5, Q4), Q3), Q2), Q1), 1)
  const t = mad(-r1, hfx, 3)
  let e = hxs * ((r1 - t) / mad(-x, t, 6))
  if (k === 0) return x - mad(x, e, -hxs)
  e = mad(x, e - c, -c)
  e -= hxs
  if (k === -1) return mad(0.5, x - e, -0.5)
  if (k === 1) return x < -0.25 ? -2 * (e - (x + 0.5)) : mad(2, x - e, 1)
  if (k <= -2 || k > 56) {
    const y = 1 - (e - x)
    return (k === 1024 ? y * 2 * 2 ** 1023 : scale(y, k)) - 1
  }
  if (k < 20) return scale(words(0x3ff00000 - (0x200000 >> k), 0) - (e - x), k)
  return scale(x - (e + words((0x3ff - k) << 20, 0)) + 1, k)
}

export function cosh(x: number): number {
  const ix = hi(x) & 0x7fffffff
  if (ix < 0x3fd62e43) {
    const t = expm1(Math.abs(x))
    const w = 1 + t
    if (ix < 0x3c800000) return w
    return 1 + (t * t) / (w + w)
  }
  if (ix < 0x40360000) {
    const t = exp(Math.abs(x))
    return mad(0.5, t, 0.5 / t)
  }
  if (ix < 0x40862e42) return 0.5 * exp(Math.abs(x))
  if (Math.abs(x) <= 710.4758600739439) {
    const w = exp(0.5 * Math.abs(x))
    return 0.5 * w * w
  }
  return ix >= 0x7ff00000 ? x * x : Infinity
}

export function tanh(x: number): number {
  const jx = hi(x)
  const ix = jx & 0x7fffffff
  if (ix >= 0x7ff00000) return jx >= 0 ? 1 / x + 1 : 1 / x - 1
  let z: number
  if (ix < 0x40360000) {
    if (ix < 0x3e300000) return x
    if (ix >= 0x3ff00000) {
      const t = expm1(2 * Math.abs(x))
      z = 1 - 2 / (t + 2)
    } else {
      const t = expm1(-2 * Math.abs(x))
      z = -t / (t + 2)
    }
  } else z = 1
  return jx >= 0 ? z : -z
}

/** Which of the two this realm's Math is, by inputs whose results tell them apart; null for another libm, a browser's. */
export function mathKind(m: Pick<Math, 'sin' | 'exp' | 'log'> = Math): MathKind | null {
  // another libm agrees with fdlibm on most inputs, so many, spread over the reductions
  const probe = Array.from({ length: 256 }, (_, i) => (((i * 0.6180339887498949) % 1) - 0.5) * 2 ** ((i % 9) - 2))
  for (const kind of ['plain', 'fused'] as const) {
    setMathKind(kind)
    if (probe.every(x => m.sin(x) === sin(x) && m.exp(x) === exp(x) && m.log(Math.abs(x)) === log(Math.abs(x)))) return kind
  }
  return null
}

/** Which `mad` the functions above use. */
export function setMathKind(kind: MathKind): void {
  mad = kind === 'fused' ? fused : plain
}

/** Node's Math in this realm, of the kind its build has: the functions above on the global Math, for a browser compile worker. */
export function installNodeMath(kind: MathKind): void {
  setMathKind(kind)
  Object.assign(Math, { sin, cos, tan, atan, atan2, acos, exp, expm1, log, log10, cosh, tanh })
}
