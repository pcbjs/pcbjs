// No DOM: shared by the compiler and the 3D view.

const PREFIX: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 }

/** Parse a value with an SI prefix that may stand in for the decimal point: "4k7", "4.7k", "1M", "R47", "10R". */
function parseValue(text: string, unit: RegExp, point: string[]): number | null {
  let s = String(text ?? '').trim().replace(/\s+/g, '').replace(unit, '')
  if (!s) return null
  // the prefix letter, or R for ohms, used as the decimal point: 4k7, 1R5, R47, 4n7
  const m = /^(\d*)([a-zA-Zµμ])(\d*)$/.exec(s)
  if (m && (m[1] || m[3]) && (m[2] in PREFIX || point.includes(m[2]))) {
    const mult = point.includes(m[2]) ? 1 : PREFIX[m[2]]
    const v = Number(`${m[1] || '0'}.${m[3] || '0'}`) * mult
    return isFinite(v) ? v : null
  }
  const n = /^(\d+(?:\.\d*)?|\.\d+)([a-zA-Zµμ]?)$/.exec(s)
  if (!n) return null
  if (n[2] && !(n[2] in PREFIX) && !point.includes(n[2])) return null
  const mult = n[2] && !point.includes(n[2]) ? PREFIX[n[2]] : 1
  const v = Number(n[1]) * mult
  return isFinite(v) ? v : null
}

/** Ohms from a resistor value: "330", "4k7", "4.7k", "10R", "1M", "0R", "2.2", "47Ω", "1k5", "R47". Null when it is not a value. */
export function parseOhms(text: string): number | null {
  return parseValue(text, /(Ω|ohms?)$/i, ['R', 'r'])
}

/** Farads from a capacitor value: "100n", "4.7u", "22p", "0.1u", "4n7", "10uF". Null when it is not a value. */
export function parseFarads(text: string): number | null {
  return parseValue(text, /F$/, [])
}

/** The value with an engineering prefix: 4700 and "Ω" give "4.7 kΩ". */
export function formatValue(v: number, unit: string): string {
  if (v === 0) return `0 ${unit}`
  const steps: [number, string][] = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']]
  const [mult, p] = steps.find(([m]) => Math.abs(v) >= m * 0.9995) ?? steps[steps.length - 1]
  return `${Number((v / mult).toPrecision(4))} ${p}${unit}`
}

// index 0 is EIA-96 code 01
export const E96 = [
  100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130, 133, 137, 140, 143,
  147, 150, 154, 158, 162, 165, 169, 174, 178, 182, 187, 191, 196, 200, 205, 210,
  215, 221, 226, 232, 237, 243, 249, 255, 261, 267, 274, 280, 287, 294, 301, 309,
  316, 324, 332, 340, 348, 357, 365, 374, 383, 392, 402, 412, 422, 432, 442, 453,
  464, 475, 487, 499, 511, 523, 536, 549, 562, 576, 590, 604, 619, 634, 649, 665,
  681, 698, 715, 732, 750, 768, 787, 806, 825, 845, 866, 887, 909, 931, 953, 976,
]
// by power of ten applied to the three-digit E96 value
const EIA96_LETTER: Record<number, string> = { [-3]: 'Z', [-2]: 'Y', [-1]: 'X', 0: 'A', 1: 'B', 2: 'C', 3: 'D', 4: 'E', 5: 'F' }

export type ChipSize = '0201' | '0402' | '0603' | '0805' | '1206'

// v = mant * 10^exp with `digits` significant digits
function sig(v: number, digits: number): [number, number] {
  let exp = Math.floor(Math.log10(v)) - (digits - 1)
  let mant = Math.round(v / 10 ** exp)
  if (mant >= 10 ** digits) { mant = Math.round(mant / 10); exp++ }
  return [mant, exp]
}

/** EIA code with `digits` significant digits: 331, 4701, and R as the decimal point when the multiplier would be negative (4R7, 47R5). */
function eiaCode(ohms: number, digits: 2 | 3): string {
  const [mant, exp] = sig(ohms, digits)
  if (exp >= 0) return `${mant}${exp}`
  const s = String(mant).padStart(-exp + 1, '0')
  const cut = s.length + exp
  return `${s.slice(0, cut)}R${s.slice(cut)}`.replace(/^0R/, 'R')
}

/** EIA-96 code: two digits for the E96 value, a letter for the multiplier ("01A" is 100 Ω, "68B" 4.75 kΩ). Null for a value off the E96 series. */
export function eia96(ohms: number): string | null {
  if (!(ohms > 0)) return null
  const [mant, exp] = sig(ohms, 3)
  if (Math.abs(mant * 10 ** exp - ohms) > ohms * 1e-6) return null
  const i = E96.indexOf(mant), letter = EIA96_LETTER[exp]
  return i < 0 || !letter ? null : `${String(i + 1).padStart(2, '0')}${letter}`
}

/** The code printed on a chip resistor: none below 0603, EIA-96 on a 1% 0603, four digits on 0805 and up at 1%, else three; '' for none. */
export function resistorCode(ohms: number, size: string, tolerance?: string): string {
  if (!isFinite(ohms) || ohms < 0) return ''
  if (size === '0402' || size === '0201' || size === '01005') return ''
  if (ohms === 0) return '0'
  const tol = tolerance === undefined ? undefined : parseFloat(String(tolerance).replace('%', ''))
  const precise = tol !== undefined && isFinite(tol) && tol <= 1
  if (size === '0603') return (precise && eia96(ohms)) || eiaCode(ohms, 2)
  return tol !== undefined && isFinite(tol) && tol > 1 ? eiaCode(ohms, 2) : eiaCode(ohms, 3)
}
