// Plain Errors; flatten wraps them.
import type { AutoRouteParams, BoardProps, Length, ResolvedRules, Rules, Stackup, StackupLayer } from './types.js'
import { BASE, mergeRules, resolveRules, THERMAL } from './rules.js'
import { defaultStackup } from './stackups.js'
import { mm } from './units.js'
import { checkClasses, mergeClasses, resolveClasses, type ResolvedNetClass } from './netclass.js'
import { checkTeardrops, resolveTeardrops, type ResolvedTeardrops } from './teardrop.js'

/** The board spec a default layer may set: everything but the name and the children. */
export type BoardSpec = Partial<Omit<BoardProps, 'name' | 'children'>>
/** A resolved board spec: what the compiler uses where props and defaults leave a key out. */
export interface ResolvedBoardSpec {
  title?: string
  revision: string
  copper: 2 | 4 | 6 | 8
  thickness: number
  stackup: Stackup
  rules: ResolvedRules
  /** the ordered sourcing tags, [] for the catch-all MPN alone */
  sourcing: string[]
  /** the board-wide autoroute parameters */
  autoroute: AutoRouteParams
  /** the net classes by name, lengths in mm, {} when none */
  classes: Record<string, ResolvedNetClass>
  /** where cpl.csv places a part, absent when no level sets it: the footprint origin */
  cpl?: { origin: 'footprint' | 'center' }
  /** the README-fab notes of every level, lowest first, each line once */
  fabNotes: string[]
  /** on or off, and the parameters a class's `teardrops: true` takes */
  teardrops: { on: boolean; spec: ResolvedTeardrops }
}

/** The built-in autoroute parameters; the optional ones are absent and mean automatic or unlimited. */
export const BASE_AUTOROUTE: AutoRouteParams = { algorithm: 'maze', viaCost: 5, clearance: 0.02, bend: '45', priority: 0 }
const AUTO_KEYS = new Set(['algorithm', 'pitch', 'viaCost', 'layers', 'via', 'clearance', 'bend', 'prefer', 'maxVias', 'avoid', 'priority', 'ripup', 'maxDetour', 'tune'])

/** Check partial autoroute parameters; throws a plain Error. */
export function checkAutoroute(v: unknown, where: string): Partial<AutoRouteParams> {
  if (v === undefined || v === null) return {}
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${where} autoroute must be an object`)
  const o = v as Record<string, any>
  const bad = (k: string, what: string): never => {
    throw new Error(`${where} autoroute: ${k} must be ${what}, got ${typeof o[k] === 'function' ? 'a function' : JSON.stringify(o[k])}`)
  }
  const num = (k: string, ok: (x: number) => boolean, what: string) => {
    if (o[k] !== undefined && !(typeof o[k] === 'number' && Number.isFinite(o[k]) && ok(o[k]))) bad(k, what)
  }
  for (const k of Object.keys(o)) if (!AUTO_KEYS.has(k)) throw new Error(`${where} autoroute: unknown parameter ${JSON.stringify(k)} (known: ${[...AUTO_KEYS].join(', ')})`)
  if (o.algorithm !== undefined && o.algorithm !== 'maze' && o.algorithm !== 'straight' && typeof o.algorithm !== 'function') bad('algorithm', "'maze', 'straight' or a function")
  num('pitch', x => x > 0, 'a positive number of mm')
  num('viaCost', x => x >= 0, 'a number of mm, 0 or more')
  num('clearance', x => x >= 0, 'a number of mm, 0 or more')
  num('maxVias', x => x >= 0 && Number.isInteger(x), 'a whole number, 0 or more')
  num('priority', () => true, 'a number')
  num('ripup', x => x >= 0 && Number.isInteger(x), 'a whole number, 0 or more')
  if (o.maxDetour !== undefined) {
    const m = o.maxDetour,
      ok = (x: unknown) => x === undefined || (typeof x === 'number' && Number.isFinite(x) && x >= 0)
    if (
      !(typeof m === 'number' ? ok(m) : m && typeof m === 'object' && !Array.isArray(m) && Object.keys(m).every(k => k === 'ratio' || k === 'floor') && ok(m.ratio) && ok(m.floor))
    )
      bad('maxDetour', 'a ratio, 0 or more, or an object { ratio?, floor? } of numbers, 0 or more')
  }
  if (o.bend !== undefined && o.bend !== '45' && o.bend !== '90') bad('bend', "'45' or '90'")
  if (o.layers !== undefined && !(Array.isArray(o.layers) && o.layers.length && o.layers.every((l: unknown) => typeof l === 'string')))
    bad('layers', 'a list of copper layer names')
  if (o.via !== undefined && !(o.via && typeof o.via === 'object' && !Array.isArray(o.via))) bad('via', 'an object { drill?, size? }')
  if (o.prefer !== undefined && !(o.prefer && typeof o.prefer === 'object' && !Array.isArray(o.prefer) && Object.values(o.prefer).every(d => d === 'h' || d === 'v')))
    bad('prefer', "an object of layer names to 'h' or 'v'")
  if (o.avoid !== undefined && !Array.isArray(o.avoid)) bad('avoid', 'a list of positions and rectangles { x, y, w, h }')
  if (o.tune !== undefined) {
    if (!o.tune || typeof o.tune !== 'object' || Array.isArray(o.tune)) bad('tune', 'an object { amplitude?, spacing?, maxAmplitude? }')
    for (const [k, x] of Object.entries(o.tune)) {
      if (k !== 'amplitude' && k !== 'spacing' && k !== 'maxAmplitude')
        throw new Error(`${where} autoroute: tune has an unknown field ${JSON.stringify(k)} (known: amplitude, spacing, maxAmplitude)`)
      let n = NaN
      try {
        n = mm(x as Length)
      } catch {
        /* reported below */
      }
      if (!(Number.isFinite(n) && n > 0)) throw new Error(`${where} autoroute: tune.${k} must be a positive length, got ${JSON.stringify(x)}`)
    }
  }
  return o as Partial<AutoRouteParams>
}

/** Autoroute parameters merged lowest first; `via` and `tune` merge their keys, the rest replace whole. */
export function mergeAutoroute<T extends object>(base: T, ...levels: (object | null | undefined)[]): T {
  const out: Record<string, any> = { ...base }
  for (const l of levels) {
    if (!l) continue
    for (const [k, v] of Object.entries(l)) {
      if (v === undefined) continue
      out[k] = (k === 'via' || k === 'tune') && out[k] ? { ...out[k], ...(v as object) } : v
    }
  }
  return out as T
}

/** boolean rules absent from BASE: false unless set */
const FLAG_KEYS = new Set(['strictNets', 'requireSourcing'])
const RULE_KEYS = new Set([...Object.keys(BASE), ...FLAG_KEYS, 'thermal', 'islands', 'edge', 'maskWeb', 'maskWebByColor'])
const FINISHES = new Set(['HASL', 'LeadFreeHASL', 'ENIG', 'ImmersionSilver', 'ImmersionTin', 'OSP', 'HardGold'])
const r4 = (v: number) => Math.round(v * 1e4) / 1e4

/** The sum of the layers, as a fab measures the finished board. */
export function stackupSum(s: Stackup): number {
  return r4(s.layers.reduce((t, l) => t + (l.type === 'copper' || l.type === 'core' || l.type === 'prepreg' || l.type === 'mask' ? (l.thickness ?? 0) : 0), 0))
}
export const stackupThickness = (s: Stackup): number => s.thickness ?? stackupSum(s)
export const copperOf = (s: Stackup) => s.layers.filter((l): l is Extract<StackupLayer, { type: 'copper' }> => l.type === 'copper')

/** Check a stackup and return its copper count. */
export function validateStackup(s: Stackup): number {
  if (!s || typeof s !== 'object' || !Array.isArray(s.layers)) throw new Error('stackup needs a layers array, listed top to bottom')
  const cu = copperOf(s)
  const n = cu.length
  if (n < 2) throw new Error(`stackup has ${n} copper layer${n === 1 ? '' : 's'}, it needs F.Cu and B.Cu at least`)
  if (n > 8) throw new Error(`stackup has ${n} copper layers, at most 8 are supported`)
  if (n % 2) throw new Error(`stackup has ${n} copper layers, the count must be even`)
  const want = ['F.Cu', ...Array.from({ length: n - 2 }, (_, i) => `In${i + 1}.Cu`), 'B.Cu']
  cu.forEach((l, i) => {
    if (l.name !== want[i]) throw new Error(`stackup copper layer ${i + 1} is ${JSON.stringify(l.name)}, expected ${want[i]} (order: ${want.join(', ')})`)
  })
  const first = s.layers.indexOf(cu[0]),
    last = s.layers.indexOf(cu[n - 1])
  s.layers.forEach((l, i) => {
    const what = `stackup layer ${i + 1} (${l.type}${l.type === 'copper' ? ` ${l.name}` : ''})`
    switch (l.type) {
      case 'copper':
      case 'core':
      case 'prepreg':
        if (!(typeof l.thickness === 'number' && l.thickness > 0)) throw new Error(`${what} needs a positive thickness, got ${l.thickness}`)
        if (l.type !== 'copper' && (i < first || i > last)) throw new Error(`${what} is outside the copper layers`)
        if (l.type === 'copper' && l.weight !== undefined && !(l.weight > 0)) throw new Error(`${what} needs a positive weight, got ${l.weight}`)
        if (l.type !== 'copper' && l.er !== undefined && !(l.er >= 1)) throw new Error(`${what} has er ${l.er}, expected 1 or more`)
        break
      case 'mask':
      case 'silk':
      case 'paste':
        if (l.side !== 'F' && l.side !== 'B') throw new Error(`${what} needs side 'F' or 'B'`)
        if (l.side === 'F' ? i > first : i < last) throw new Error(`${what} on side ${l.side} must be ${l.side === 'F' ? 'above F.Cu' : 'below B.Cu'}`)
        if (l.thickness !== undefined && !(l.thickness >= 0)) throw new Error(`${what} has a negative thickness`)
        break
      default:
        throw new Error(`stackup layer ${i + 1} has an unknown type ${JSON.stringify((l as any).type)}`)
    }
  })
  for (let k = 0; k + 1 < n; k++) {
    const a = s.layers.indexOf(cu[k]),
      b = s.layers.indexOf(cu[k + 1])
    if (!s.layers.slice(a + 1, b).some(l => l.type === 'core' || l.type === 'prepreg'))
      throw new Error(`stackup has no core or prepreg between ${cu[k].name} and ${cu[k + 1].name}`)
  }
  if (s.finish !== undefined && !FINISHES.has(s.finish)) throw new Error(`stackup finish ${JSON.stringify(s.finish)} is not one of ${[...FINISHES].join(', ')}`)
  if (s.thickness !== undefined) {
    if (!(s.thickness > 0)) throw new Error(`stackup thickness must be positive, got ${s.thickness}`)
    const sum = stackupSum(s)
    if (Math.abs(sum - s.thickness) > 0.1 * s.thickness) throw new Error(`stackup layers add up to ${sum} mm, more than 10% off its thickness ${s.thickness} mm`)
  }
  return n
}

function checkRules(r: unknown, where: string): Partial<Rules> {
  if (r === undefined || r === null) return {}
  if (typeof r !== 'object') throw new Error(`${where} rules must be an object`)
  for (const [k, v] of Object.entries(r)) {
    if (!RULE_KEYS.has(k)) throw new Error(`${where} rules: unknown rule ${JSON.stringify(k)} (known: ${[...RULE_KEYS].join(', ')})`)
    if (k === 'thermal') {
      checkThermal(v, where)
      continue
    }
    if (k === 'islands') {
      checkIslands(v, `${where} rules`)
      continue
    }
    if (k === 'edge') {
      checkEdgeBand(v, `${where} rules`)
      continue
    }
    if (k === 'maskWebByColor') {
      if (!v || typeof v !== 'object' || Array.isArray(v) || Object.values(v).some(x => !(typeof x === 'number' && x >= 0 && Number.isFinite(x))))
        throw new Error(`${where} rules: maskWebByColor must map mask colours to mm, such as { Black: 0.13 }, got ${JSON.stringify(v)}`)
      continue
    }
    if ((k === 'holeClearance' || k === 'minHoleToHole') && v && typeof v === 'object' && !Array.isArray(v)) {
      const sides = k === 'holeClearance' ? ['inner', 'outer', 'via'] : ['pad', 'via']
      const ks = Object.keys(v).filter(s => (v as any)[s] !== undefined)
      if (!ks.length || ks.some(s => !sides.includes(s) || !(typeof (v as any)[s] === 'number' && (v as any)[s] >= 0 && Number.isFinite((v as any)[s]))))
        throw new Error(`${where} rules: ${k} must be a number of mm or { ${sides.join(', ')} } of mm, got ${JSON.stringify(v)}`)
      continue
    }
    if (FLAG_KEYS.has(k)) {
      if (v !== undefined && typeof v !== 'boolean') throw new Error(`${where} rules: ${k} must be true or false, got ${JSON.stringify(v)}`)
      continue
    }
    if (v !== undefined && !(typeof v === 'number' && v >= 0 && Number.isFinite(v))) throw new Error(`${where} rules: ${k} must be a number of mm, got ${JSON.stringify(v)}`)
  }
  return r as Partial<Rules>
}

/** Check an island mode: 'remove', 'keep' or { minArea } in mm². Throws naming `where`. */
export function checkIslands(v: unknown, where: string): void {
  if (v === undefined || v === 'remove' || v === 'keep') return
  if (
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).every(k => k === 'minArea') &&
    typeof (v as any).minArea === 'number' &&
    (v as any).minArea >= 0 &&
    Number.isFinite((v as any).minArea)
  )
    return
  throw new Error(`${where}: islands must be 'remove', 'keep' or { minArea } in mm², got ${JSON.stringify(v)}`)
}

const EDGE_KINDS = ['courtyard', 'silk', 'pad']
/** Check an edge band: { width, kinds?, except? }, see EdgeBand. Throws naming `where`. */
export function checkEdgeBand(v: unknown, where: string): void {
  if (v === undefined) return
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${where}: edge must be an object such as { width: 1.2, except: [J1] }`)
  for (const [k, x] of Object.entries(v)) {
    if (x === undefined) continue
    if (k === 'width') {
      if (!(typeof x === 'number' && x >= 0 && Number.isFinite(x))) throw new Error(`${where}: edge.width must be a number of mm, got ${JSON.stringify(x)}`)
      continue
    }
    if (k === 'kinds') {
      if (!Array.isArray(x) || x.some(q => !EDGE_KINDS.includes(q)))
        throw new Error(`${where}: edge.kinds must list ${EDGE_KINDS.map(q => `'${q}'`).join(', ')}, got ${JSON.stringify(x)}`)
      continue
    }
    if (k === 'except') {
      // a Part is a function, a handle an object branded 'pin', a ref a string such as 'J1.3'
      const ok = (q: unknown) => (typeof q === 'string' && q.trim() !== '') || typeof q === 'function' || (!!q && typeof q === 'object' && (q as any).$$ === 'pin')
      if (!Array.isArray(x) || !x.every(ok)) throw new Error(`${where}: edge.except must list parts, pads such as J1.pad(3), or refs such as 'J1' and 'J1.3'`)
      continue
    }
    throw new Error(`${where}: edge has no key ${JSON.stringify(k)} (known: width, kinds, except)`)
  }
}

function checkThermal(v: unknown, where: string): void {
  if (v === undefined) return
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${where} rules: thermal must be an object such as { gap: 0.5, spokeWidth: 0.5 }`)
  for (const [k, x] of Object.entries(v)) {
    if (x === undefined) continue
    if (!(k in THERMAL)) throw new Error(`${where} rules: thermal has no key ${JSON.stringify(k)} (known: ${Object.keys(THERMAL).join(', ')})`)
    if (
      k === 'angle'
        ? x !== 90 && x !== 45
        : k === 'spokes' || k === 'minSpokes'
          ? !(Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 16)
          : !(typeof x === 'number' && x > 0 && Number.isFinite(x))
    )
      throw new Error(
        `${where} rules: thermal.${k} ${k === 'angle' ? 'must be 90 or 45' : k === 'spokes' || k === 'minSpokes' ? 'must be a whole number from 0 to 16' : 'must be a positive number of mm'}, got ${JSON.stringify(x)}`,
      )
  }
}

function checkSourcing(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || v.some(t => typeof t !== 'string' || !t.trim() || t.includes(':')))
    throw new Error(`${where} sourcing must be a list of tags such as ['LCSC', 'CN'], got ${JSON.stringify(v)}`)
  return v.map(t => t.trim())
}

function checkFabNotes(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || v.some(t => typeof t !== 'string'))
    throw new Error(`${where} fabNotes must be a list of lines such as ['Single board, no panel.'], got ${JSON.stringify(v)}`)
  return v
    .flatMap(t => t.split(/\r?\n/))
    .map(t => t.trim())
    .filter(Boolean)
}

const has = (o: BoardSpec, k: keyof BoardSpec) => o[k] !== undefined && o[k] !== null

/** Resolve levels over the base, lowest first; the highest level giving `copper` or `stackup` decides the layers, and a `thickness` must agree. */
export function resolveBoardSpec(levels: BoardSpec[], levelNames?: string[]): ResolvedBoardSpec {
  const names = levelNames ?? (levels.length === 1 ? ['default'] : levels.map((_, i) => (i === levels.length - 1 ? '<PCB>' : 'default')))
  const rules = resolveRules(mergeRules(BASE, ...levels.map((l, i) => checkRules(l.rules, names[i]))))
  const autoroute = mergeAutoroute(BASE_AUTOROUTE, ...levels.map((l, i) => checkAutoroute(l.autoroute, names[i])))
  const classes = resolveClasses(mergeClasses(...levels.map((l, i) => checkClasses(l.classes, names[i]))))
  let title: string | undefined,
    revision = '',
    sourcing: string[] = [],
    cpl: ResolvedBoardSpec['cpl']
  const fabNotes: string[] = []
  levels.forEach((l, i) => {
    if (has(l, 'fabNotes')) for (const n of checkFabNotes(l.fabNotes, names[i])) if (!fabNotes.includes(n)) fabNotes.push(n)
    if (has(l, 'cpl')) {
      const o = (l.cpl as any)?.origin
      if (typeof l.cpl !== 'object' || (o !== undefined && o !== 'footprint' && o !== 'center'))
        throw new Error(`${names[i]} cpl must be { origin: 'footprint' } or { origin: 'center' }, got ${JSON.stringify(l.cpl)}`)
      if (o !== undefined) cpl = { origin: o }
    }
    if (has(l, 'title')) title = String(l.title)
    if (has(l, 'revision')) revision = String(l.revision)
    if (has(l, 'sourcing')) sourcing = checkSourcing(l.sourcing, names[i])
  })
  let top = -1
  levels.forEach((l, i) => {
    if (has(l, 'copper') || has(l, 'stackup')) top = i
  })
  let thickAt = -1,
    thick: number | undefined
  levels.forEach((l, i) => {
    if (has(l, 'thickness')) {
      thickAt = i
      thick = mm(l.thickness as any)
    }
  })
  if (thick !== undefined && !(thick > 0)) throw new Error(`thickness must be positive, got ${thick}`)
  const lv = top >= 0 ? levels[top] : {}
  let copper: number, stackup: Stackup, thickness: number
  if (has(lv, 'stackup')) {
    const where = `${names[top]} stackup`
    try {
      copper = validateStackup(lv.stackup!)
    } catch (e) {
      throw new Error(`${where}: ${(e as Error).message}`)
    }
    if (has(lv, 'copper') && Number(lv.copper) !== copper) throw new Error(`${names[top]}: copper={${lv.copper}} disagrees with the stackup, which has ${copper} copper layers`)
    stackup = structuredClone(lv.stackup!)
    thickness = stackupThickness(stackup)
    if (thick !== undefined && thickAt >= top && Math.abs(thick - thickness) > 0.005)
      throw new Error(`${names[thickAt]}: thickness ${thick} mm disagrees with the stackup, which is ${thickness} mm`)
  } else {
    copper = has(lv, 'copper') ? Number(lv.copper) : 2
    if (![2, 4, 6, 8].includes(copper)) throw new Error(`${names[top] ?? '<PCB>'}: copper must be 2, 4, 6 or 8, got ${JSON.stringify(lv.copper)}`)
    thickness = thick ?? 1.6
    stackup = defaultStackup(copper, thickness)
  }
  const teardrops = resolveTeardrops(levels.map((l, i) => (has(l, 'teardrops') ? checkTeardrops(l.teardrops, names[i]) : undefined)))
  const out: ResolvedBoardSpec = { revision, copper: copper as 2 | 4 | 6 | 8, thickness, stackup, rules, sourcing, autoroute, classes, fabNotes, teardrops }
  if (title !== undefined) out.title = title
  if (cpl) out.cpl = cpl
  return out
}
