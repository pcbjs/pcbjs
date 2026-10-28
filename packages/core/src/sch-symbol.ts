// Schematic symbols in grid units, y down: a body drawn as SVG paths and pins whose ends sit on whole grid points.
import type { Pt } from './model.js'
import { strokeText } from './text.js'

export type PinSide = 'left' | 'right' | 'top' | 'bottom'

/** One pin of a symbol: `end` is where a wire connects, `side` the way the pin points out of the body. */
export interface SymbolPin {
  name: string
  end: Pt
  side: PinSide
  length: number
}
export interface SymbolShape {
  d: string
  fill?: boolean
}
/** A resolved symbol, grid units in its own frame. */
export interface SymbolDef {
  $$: 'symbol'
  /** 'resistor', 'box', 'custom' and so on */
  kind: string
  pins: SymbolPin[]
  body: SymbolShape[]
  /** the body's bounds, x0 y0 x1 y1 */
  box: [number, number, number, number]
  /** pin names drawn inside the body */
  names: boolean
}

export interface SymbolPinSpec {
  side: PinSide
  at: number
  length?: number
}
/** `defineSymbol` input: pins on the sides of a box `size` units large, `at` counted from its top or left corner. */
export interface SymbolSpec<P extends string = string> {
  pins: { readonly [K in P]: SymbolPinSpec }
  /** 'box', or SVG path data in grid units in the box frame, origin at its top left */
  body?: 'box' | string | readonly string[]
  size?: readonly [number, number]
  /** draw pin names inside the body; default true for a box */
  names?: boolean
}

/** Pin name size in mm, KiCad's 50 mil. */
export const PIN_TEXT = 1.27
const PITCH = 2.54
const SIDES: PinSide[] = ['left', 'right', 'top', 'bottom']

export const isSymbol = (v: unknown): v is SymbolDef => !!v && typeof v === 'object' && (v as SymbolDef).$$ === 'symbol'

/** Text width in grid units at the pin name size. */
export function textUnits(s: string, size = PIN_TEXT): number {
  return strokeText(s, { size, thickness: 0, anchor: 'start', font: 'newstroke' }).width / PITCH
}

/** A symbol from pins on the sides of a box; sizes default to fit the pins and their names. */
export function defineSymbol<const P extends string>(spec: SymbolSpec<P>): SymbolDef {
  if (!spec || typeof spec !== 'object' || !spec.pins || typeof spec.pins !== 'object') throw new TypeError('defineSymbol: needs { pins: { NAME: { side, at } } }')
  const pins = Object.entries(spec.pins) as [string, SymbolPinSpec][]
  if (!pins.length) throw new TypeError('defineSymbol: a symbol needs at least one pin')
  for (const [n, p] of pins) {
    if (!p || !SIDES.includes(p.side)) throw new TypeError(`defineSymbol: pin ${n} needs side 'left', 'right', 'top' or 'bottom'`)
    if (!Number.isInteger(p.at) || p.at < 0) throw new TypeError(`defineSymbol: pin ${n} needs a whole grid position at, got ${JSON.stringify(p.at)}`)
    if (p.length !== undefined && !(Number.isInteger(p.length) && p.length > 0)) throw new TypeError(`defineSymbol: pin ${n} needs a whole positive length`)
  }
  const box = spec.body === undefined || spec.body === 'box'
  const names = spec.names ?? box
  const most = (s: PinSide[]) => Math.max(0, ...pins.filter(([, p]) => s.includes(p.side)).map(([, p]) => p.at))
  const wide = (s: PinSide) => Math.max(0, ...pins.filter(([, p]) => p.side === s).map(([n]) => textUnits(n)))
  let [w, h] = spec.size ?? [0, 0]
  if (!spec.size) {
    w = Math.max(most(['top', 'bottom']) + 1, names ? Math.ceil(wide('left') + wide('right') + 1.4) : 2)
    h = Math.max(most(['left', 'right']) + 1, names ? Math.ceil(wide('top') + wide('bottom') + 1.4) : 2)
  }
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) throw new TypeError(`defineSymbol: size must be two whole grid units, got ${JSON.stringify(spec.size)}`)
  const out: SymbolPin[] = pins.map(([name, p]) => {
    const l = p.length ?? 1
    const end: Pt = p.side === 'left' ? [-l, p.at] : p.side === 'right' ? [w + l, p.at] : p.side === 'top' ? [p.at, -l] : [p.at, h + l]
    return { name, end, side: p.side, length: l }
  })
  const body = box ? [{ d: `M0 0H${w}V${h}H0Z` }] : (typeof spec.body === 'string' ? [spec.body] : [...(spec.body as readonly string[])]).map(d => ({ d }))
  return { $$: 'symbol', kind: box ? 'box' : 'custom', pins: out, body, box: [0, 0, w, h], names }
}

/** What the default symbol of a part goes by. */
export interface SymbolPart {
  prefix: string
  pins: readonly string[]
  id?: string
  value?: string
  name?: string
}

const GROUND = /^(A|D|P|S|C)?GND\w*$|^GND[A-Z]?$|^VSS\w*$|^V-$|^0V$|^EP$|^PAD$|^SHIELD$|^MH\d*$/i
const POWER = /^(VCC|VDD|VBUS|VBAT|VIN|VSYS|VREG|VIO|VCORE|VPP|VREF|VUSB|AVDD|DVDD|IOVDD|V\+|\+)\w*$|^V(CC|DD)\w*$|^\+?\d+V\d*$|^\d+V\d+$|^3V3$|^VDD\w*$|^V\d+V\d*$/i
const OUTPUT = /OUT|^TX|TXD|^SDO|^DO$|^Q\d*$|^SW$|^LX$|^PG(OOD)?$|^INT|^IRQ|^MISO|^CLKOUT|^XO$|^X2$/i

/** The side a pin of a generic box goes on, by its name. */
export function pinSide(name: string): PinSide {
  if (GROUND.test(name)) return 'bottom'
  if (POWER.test(name)) return 'top'
  if (OUTPUT.test(name)) return 'right'
  return 'left'
}

/** A generic box from a pin list: power on top, ground at the bottom, outputs right, the rest left, numbered pins DIP-style. */
export function boxSymbol(pins: readonly string[]): SymbolDef {
  const numbered = pins.every(p => /^\d+$/.test(p))
  const sides: Record<PinSide, string[]> = { left: [], right: [], top: [], bottom: [] }
  if (numbered) {
    const half = Math.ceil(pins.length / 2)
    sides.left = pins.slice(0, half)
    sides.right = pins.slice(half).reverse()
  } else {
    for (const p of pins) sides[pinSide(p)].push(p)
    // a lopsided box is tall and thin: move the tail of the longer side across
    const [a, b] = sides.left.length >= sides.right.length ? (['left', 'right'] as const) : (['right', 'left'] as const)
    if (sides[a].length > 2 * sides[b].length + 2) {
      const move = Math.floor((sides[a].length - sides[b].length) / 2)
      sides[b].push(...sides[a].splice(sides[a].length - move))
    }
  }
  const wide = (s: PinSide) => Math.max(0, ...sides[s].map(n => textUnits(n)))
  const top0 = sides.top.length ? Math.ceil(wide('top') + 0.8) : 0
  const bot = sides.bottom.length ? Math.ceil(wide('bottom') + 0.8) : 0
  const rows = Math.max(sides.left.length, sides.right.length)
  const h = Math.max(2, top0 + rows + 1 + bot)
  const across = Math.max(sides.top.length, sides.bottom.length)
  const w = Math.max(4, across + 1, Math.ceil(wide('left') + wide('right') + 1.6))
  const spec: Record<string, SymbolPinSpec> = {}
  sides.left.forEach((p, i) => {
    spec[p] = { side: 'left', at: top0 + 1 + i }
  })
  sides.right.forEach((p, i) => {
    spec[p] = { side: 'right', at: top0 + 1 + i }
  })
  const spread = (list: string[], side: PinSide) => {
    const x0 = Math.floor((w - (list.length - 1)) / 2)
    list.forEach((p, i) => {
      spec[p] = { side, at: x0 + i }
    })
  }
  spread(sides.top, 'top')
  spread(sides.bottom, 'bottom')
  return defineSymbol({ pins: spec, size: [w, h] })
}

/** A connector as one column of pins pointing right, in pin order. */
export function rowSymbol(pins: readonly string[]): SymbolDef {
  const spec: Record<string, SymbolPinSpec> = {}
  pins.forEach((p, i) => {
    spec[p] = { side: 'right', at: i + 1 }
  })
  const w = Math.max(2, Math.ceil(Math.max(...pins.map(p => textUnits(p))) + 1))
  return { ...defineSymbol({ pins: spec, size: [w, pins.length + 1] }), kind: 'connector' }
}

const pin = (name: string, end: Pt, side: PinSide, length = 1): SymbolPin => ({ name, end, side, length })
/** A two terminal symbol along x, `a` left and `b` right, the body between x = -root and root. */
function twoPin(kind: string, a: string, b: string, body: SymbolShape[], root = 1): SymbolDef {
  return { $$: 'symbol', kind, pins: [pin(a, [-2, 0], 'left', 2 - root), pin(b, [2, 0], 'right', 2 - root)], body, box: [-root, -0.8, root, 0.8], names: false }
}

const ARROWS = 'M-0.1 -0.75L0.4 -1.25M0.15 -1.25H0.4V-1M0.35 -0.75L0.85 -1.25M0.6 -1.25H0.85V-1'

/** The built-in symbols by kind; pins are the part's, in its pin order. */
export const SYMBOLS = {
  resistor: (a: string, b: string) => twoPin('resistor', a, b, [{ d: 'M-1 -0.4H1V0.4H-1Z' }]),
  capacitor: (a: string, b: string) => twoPin('capacitor', a, b, [{ d: 'M-1 0H-0.2M0.2 0H1M-0.2 -0.8V0.8M0.2 -0.8V0.8' }]),
  inductor: (a: string, b: string) => twoPin('inductor', a, b, [{ d: 'M-1 0A0.25 0.25 0 0 1 -0.5 0A0.25 0.25 0 0 1 0 0A0.25 0.25 0 0 1 0.5 0A0.25 0.25 0 0 1 1 0' }]),
  diode: (anode: string, cathode: string) => twoPin('diode', anode, cathode, [{ d: 'M-1 0H1' }, { d: 'M-0.5 -0.6L0.5 0L-0.5 0.6Z', fill: true }, { d: 'M0.5 -0.6V0.6' }]),
  led: (anode: string, cathode: string) =>
    twoPin('led', anode, cathode, [{ d: 'M-1 0H1' }, { d: 'M-0.5 -0.6L0.5 0L-0.5 0.6Z', fill: true }, { d: 'M0.5 -0.6V0.6' }, { d: ARROWS }]),
  crystal: (a: string, b: string, gnd?: string): SymbolDef => {
    const s = twoPin('crystal', a, b, [{ d: 'M-1 0H-0.6M0.6 0H1M-0.6 -0.8V0.8M0.6 -0.8V0.8M-0.35 -1H0.35V1H-0.35Z' }])
    if (gnd) {
      s.pins.push(pin(gnd, [0, 2], 'bottom', 1))
      s.box = [-1, -1, 1, 1]
    }
    return s
  },
  switch: (a: string, b: string) =>
    twoPin('switch', a, b, [
      { d: 'M-1 0H-0.8M0.8 0H1M-0.6 0L0.6 -0.7' },
      { d: 'M-0.6 0m-0.2 0a0.2 0.2 0 1 0 0.4 0a0.2 0.2 0 1 0 -0.4 0M0.8 0m-0.2 0a0.2 0.2 0 1 0 0.4 0a0.2 0.2 0 1 0 -0.4 0' },
    ]),
  battery: (plus: string, minus: string): SymbolDef => ({
    $$: 'symbol',
    kind: 'battery',
    names: false,
    box: [-0.8, -1, 0.8, 1],
    pins: [pin(plus, [0, -2], 'top', 1), pin(minus, [0, 2], 'bottom', 1)],
    body: [{ d: 'M0 -1V-0.25M0 0.25V1M-0.8 -0.25H0.8M-0.4 0.25H0.4M-0.25 -0.75H0.25M0 -1V-0.5' }],
  }),
  npn: (b: string, c: string, e: string): SymbolDef => ({
    $$: 'symbol',
    kind: 'npn',
    names: false,
    box: [-1, -1.2, 1.4, 1.2],
    pins: [pin(b, [-2, 0], 'left', 2), pin(c, [1, -2], 'top', 1), pin(e, [1, 2], 'bottom', 1)],
    body: [{ d: 'M0 -0.7V0.7M0 -0.3L1 -1M0 0.3L1 1M1.4 0A1.2 1.2 0 1 0 1.4 0.001' }, { d: 'M1 1L0.55 0.95L0.8 0.6Z', fill: true }],
  }),
  nfet: (g: string, d: string, s: string): SymbolDef => ({
    $$: 'symbol',
    kind: 'nfet',
    names: false,
    box: [-0.2, -1, 1, 1],
    pins: [pin(g, [-2, 0], 'left', 1.8), pin(d, [1, -2], 'top', 1), pin(s, [1, 2], 'bottom', 1)],
    body: [{ d: 'M-0.2 -0.6V0.6M0.1 -0.7V-0.3M0.1 -0.2V0.2M0.1 0.3V0.7M0.1 -0.5H1V-1M0.1 0.5H1V1M0.1 0H1V0.5' }, { d: 'M0.1 0L0.5 -0.2V0.2Z', fill: true }],
  }),
  testpoint: (a: string): SymbolDef => ({
    $$: 'symbol',
    kind: 'testpoint',
    names: false,
    box: [-0.4, -0.8, 0.4, 0],
    pins: [pin(a, [0, 1], 'bottom', 1)],
    body: [{ d: 'M0 0m-0.4 -0.4a0.4 0.4 0 1 0 0.8 0a0.4 0.4 0 1 0 -0.8 0' }],
  }),
} as const

const by = (pins: readonly string[], re: RegExp) => pins.find(p => re.test(p))

/** The default symbol of a part: by its prefix, pin names and footprint, else a generic box. */
export function autoSymbol(p: SymbolPart): SymbolDef {
  const pins = p.pins,
    n = pins.length
  const prefix = p.prefix.toUpperCase()
  const tag = `${p.id ?? ''} ${p.name ?? ''}`
  if (n === 2) {
    const [a, b] = pins
    if (prefix === 'R') return SYMBOLS.resistor(a, b)
    if (prefix === 'C') return SYMBOLS.capacitor(a, b)
    if (prefix === 'L' || prefix === 'FB') return SYMBOLS.inductor(a, b)
    if (prefix === 'Y' || prefix === 'X') return SYMBOLS.crystal(a, b)
    if (prefix === 'SW' || prefix === 'S') return SYMBOLS.switch(a, b)
    if (prefix === 'D' || prefix === 'LED') {
      const an = by(pins, /^(A|ANODE|\+)$/i) ?? (pins.includes('1') && pins.includes('2') ? '2' : b)
      const k = pins.find(x => x !== an)!
      return /LED/i.test(tag) || prefix === 'LED' ? SYMBOLS.led(an, k) : SYMBOLS.diode(an, k)
    }
    if (prefix === 'BT') {
      const plus = by(pins, /^(\+|P|POS|VBAT|1)$/i) ?? a
      return SYMBOLS.battery(
        plus,
        pins.find(x => x !== plus)!,
      )
    }
  }
  if (n === 3 && prefix === 'Q') {
    const role = (re: RegExp) => by(pins, re)
    const g = role(/^G(ATE)?$/i),
      d = role(/^D(RAIN)?$/i),
      s = role(/^S(OURCE)?$/i)
    if (g && d && s) return SYMBOLS.nfet(g, d, s)
    const b = role(/^B(ASE)?$/i),
      c = role(/^C(OLLECTOR)?$/i),
      e = role(/^E(MITTER)?$/i)
    if (b && c && e) return SYMBOLS.npn(b, c, e)
    // SOT-23 numbering: 1 base or gate, 2 emitter or source, 3 collector or drain
    if (pins.includes('1') && pins.includes('2') && pins.includes('3'))
      return /FET|^(BSS|2N7002|AO|SI|IRLM|DMG|DMN)/i.test(`${p.value ?? ''} ${tag}`) ? SYMBOLS.nfet('1', '3', '2') : SYMBOLS.npn('1', '3', '2')
  }
  if (n === 3 && (prefix === 'Y' || prefix === 'X')) {
    const g = by(pins, GROUND)
    if (g) {
      const [a, b] = pins.filter(x => x !== g)
      return SYMBOLS.crystal(a, b, g)
    }
  }
  if (n === 1 && (prefix === 'TP' || prefix === 'H' || prefix === 'MH')) return SYMBOLS.testpoint(pins[0])
  if ((prefix === 'J' || prefix === 'P' || prefix === 'CN' || prefix === 'TP') && pins.every(x => /^\d+$/.test(x))) return rowSymbol(pins)
  return boxSymbol(pins)
}
