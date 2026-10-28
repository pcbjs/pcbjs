// `.kicad_dru` custom rules as part overrides, class clearances or new classes; the rest stays a comment in pcb.config.ts.
import type { KCustomRule } from './board.js'

/** A term of a condition, `A.Parent == 'J1'`, or with `neg` `B.NetName != 'GND'`. */
interface Term {
  side: 'A' | 'B'
  field: string
  value: string
  neg?: true
}
type Conjunction = Term[]

/** KindClearance of @pcbjs/core in mm. */
export type KindMM = Partial<Record<'track' | 'via' | 'zone' | 'text' | 'self', number>> & { pad?: number | PadTypeMM }
export type PadTypeMM = { tht?: number; smd?: number }
type Kind = keyof KindMM | 'pad.tht' | 'pad.smd'
/** The rule overrides a part takes from the custom rules, in mm; `clearance` may be by kind. */
export type PartRuleSet = Partial<Record<'edgeClearance' | 'holeClearance' | 'trackWidth', number>> & { clearance?: number | KindMM }

export interface DruMapping {
  parts: Map<string, PartRuleSet>
  /** an existing class -> its clearance, by kind where a rule scopes it */
  classes: Map<string, number | KindMM>
  /** a KiCad net -> its clearance by kind, as `net.rules()` */
  nets: Map<string, KindMM>
  /** a class made of a rule's nets: its name, the KiCad net names and the clearance */
  netGroups: { name: string; nets: string[]; clearance: number }[]
  /** what each mapped rule became, for the config's comments */
  mapped: { rule: KCustomRule; as: string }[]
  unmapped: KCustomRule[]
}

const KINDS: Record<string, keyof PartRuleSet> = { clearance: 'clearance', edge_clearance: 'edgeClearance', hole_clearance: 'holeClearance', track_width: 'trackWidth' }

/** `0.26mm`, `10mil`, `0.01in` or a bare number, in mm. */
function length(s: string): number | null {
  const m = /^(-?[\d.]+)\s*(mm|mil|in)?$/.exec(s.trim())
  if (!m) return null
  const v = Number(m[1]) * (m[2] === 'mil' ? 0.0254 : m[2] === 'in' ? 25.4 : 1)
  return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null
}

/** The condition in disjunctive normal form, or null when it uses anything but ==, !=, && and ||. */
export function parseCondition(src: string, limit = 5000): Conjunction[] | null {
  const toks: string[] = []
  const re = /\s*(\(|\)|&&|\|\||(?:A|B)\.\w+\s*[=!]=\s*'[^']*')/y
  let i = 0
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break
    re.lastIndex = i
    const m = re.exec(src)
    if (!m) return null
    toks.push(m[1])
    i = re.lastIndex
  }
  let k = 0
  const or = (): Conjunction[] | null => {
    let out = and()
    while (out && toks[k] === '||') {
      k++
      const r = and()
      if (!r) return null
      out = [...out, ...r]
      if (out.length > limit) return null
    }
    return out
  }
  const and = (): Conjunction[] | null => {
    let out = atom()
    while (out && toks[k] === '&&') {
      k++
      const r = atom()
      if (!r) return null
      const next: Conjunction[] = []
      for (const a of out) for (const b of r) next.push([...a, ...b])
      if (next.length > limit) return null
      out = next
    }
    return out
  }
  const atom = (): Conjunction[] | null => {
    const t = toks[k++]
    if (t === '(') {
      const r = or()
      if (toks[k++] !== ')') return null
      return r
    }
    const m = t ? /^(A|B)\.(\w+)\s*([=!])=\s*'([^']*)'$/.exec(t) : null
    return m ? [[{ side: m[1] as 'A' | 'B', field: m[2], value: m[4], ...(m[3] === '!' ? { neg: true as const } : {}) }]] : null
  }
  const out = or()
  return out && k === toks.length ? out : null
}

const REF_FIELDS = new Set(['Parent', 'Reference'])

const TYPE_KINDS: Record<string, keyof KindMM> = { Pad: 'pad', Track: 'track', Via: 'via', Zone: 'zone', Text: 'text' }
const PAD_TYPES: Record<string, string> = { 'Through-hole': 'thru_hole', SMD: 'smd', 'NPTH, mechanical': 'np_thru_hole' }
const PAD_SCOPES: Record<string, 'tht' | 'smd'> = { 'Through-hole': 'tht', SMD: 'smd' }
export function maxPad(a: number | PadTypeMM | undefined, b: number | PadTypeMM | undefined): number | PadTypeMM | undefined {
  if (a === undefined || b === undefined) return a ?? b
  if (typeof a === 'number' && typeof b === 'number') return Math.max(a, b)
  const both = (x: number | PadTypeMM): PadTypeMM => (typeof x === 'number' ? { tht: x, smd: x } : x)
  const x = both(a),
    y = both(b),
    o: PadTypeMM = {}
  for (const t of ['tht', 'smd'] as const) if (x[t] !== undefined || y[t] !== undefined) o[t] = Math.max(x[t] ?? 0, y[t] ?? 0)
  return o
}
const maxKinds = (a: KindMM, b: KindMM): KindMM => {
  const o: KindMM = { ...a }
  for (const [k, v] of Object.entries(b) as [keyof KindMM, number | PadTypeMM][]) {
    if (k === 'pad') o.pad = maxPad(o.pad, v)
    else o[k] = Math.max(o[k] ?? 0, v as number)
  }
  return o
}
const kindsOf = (kinds: Kind[], v: number): KindMM => {
  const o: KindMM = {}
  for (const k of kinds) {
    if (k === 'pad.tht' || k === 'pad.smd') {
      if (typeof o.pad !== 'number') o.pad = { ...o.pad, [k.slice(4)]: v }
    } else o[k] = v
  }
  return o
}
const kindName = (k: Kind) => (k === 'pad.tht' ? 'through-hole pads' : k === 'pad.smd' ? 'SMD pads' : `${k}s`)
export const allKinds = (v: number): KindMM => ({ pad: v, track: v, via: v, zone: v, text: v, self: v })
/** Two part clearances merged kind by kind, the larger of each. */
export function mergePartClearance(a: number | KindMM | undefined, b: number | KindMM | undefined): number | KindMM | undefined {
  if (a === undefined || b === undefined) return a ?? b
  if (typeof a === 'number' && typeof b === 'number') return Math.max(a, b)
  return maxKinds(typeof a === 'number' ? allKinds(a) : a, typeof b === 'number' ? allKinds(b) : b)
}

/** Map custom rules; `refs` maps KiCad refs to pcbjs's, `name` makes a class name from a rule name, `padKinds` is by pcbjs ref. */
export function mapDru(
  rules: KCustomRule[],
  refs: Map<string, string>,
  classOfNet: Map<string, string>,
  classes: Set<string>,
  nets: Set<string>,
  name: (rule: string) => string,
  padKinds: Map<string, Set<string>> = new Map(),
): DruMapping {
  const out: DruMapping = { parts: new Map(), classes: new Map(), nets: new Map(), netGroups: [], mapped: [], unmapped: [] }
  const taken = new Set(classes)
  for (const rule of rules) {
    const one = rule.constraints.length === 1 ? /^(\w+)\s+\(min\s+([^)]+)\)$/.exec(rule.constraints[0]) : null
    const key = one ? KINDS[one[1]] : undefined
    const v = one ? length(one[2]) : null
    const dnf = rule.condition ? parseCondition(rule.condition) : null
    if (!key || v === null || v < 0 || !dnf || !dnf.length) {
      out.unmapped.push(rule)
      continue
    }
    const kinds = dnf.some(c => c.some(t => t.neg || t.field === 'Pad_Type' || (t.field === 'Type' && t.value !== 'Pad')))
    const as = kinds ? (key === 'clearance' ? mapKinds(dnf, v) : null) : mapOne(dnf, key, v, rule.name)
    if (as) out.mapped.push({ rule, as })
    else out.unmapped.push(rule)
  }
  return out

  // one target per conjunction: a pad side becomes a part override, a net side a clearance by kind on that net or class;
  // terms that cannot be said are dropped, which only makes the rule stricter, and named in the result
  function mapKinds(dnf: Conjunction[], v: number): string | null {
    type Target = { parts?: string[]; what: string; net?: string[]; cls?: string; kinds: Kind[]; loose: string[] }
    const targets: Target[] = []
    for (const c of dnf) {
      let t: Target | null = null
      for (const [s, o] of [
        ['A', 'B'],
        ['B', 'A'],
      ] as const) {
        const S = c.filter(x => x.side === s),
          O = c.filter(x => x.side === o)
        const oTypes = O.filter(x => x.field === 'Type' && !x.neg)
        if (oTypes.length !== 1 || !TYPE_KINDS[oTypes[0].value]) continue
        let kinds: Kind[] = [TYPE_KINDS[oTypes[0].value]]
        let oRest = O.filter(x => x !== oTypes[0])
        const scoped = kinds[0] === 'pad' ? oRest.filter(x => x.field === 'Pad_Type' && !x.neg && PAD_SCOPES[x.value]) : []
        if (scoped.length === 1) {
          kinds = [`pad.${PAD_SCOPES[scoped[0].value]}` as Kind]
          oRest = oRest.filter(x => x !== scoped[0])
        }
        const sType = S.filter(x => x.field === 'Type')
        if (sType.length !== 1 || sType[0].neg) continue
        if (sType[0].value === 'Pad') {
          if (oRest.length) continue
          const rest = S.filter(x => x !== sType[0])
          if (rest.some(x => x.neg) || rest.length > 1) continue
          if (!rest.length) {
            t = { parts: [...padKinds.keys()].filter(r => padKinds.get(r)!.size), what: 'every part', kinds, loose: [] }
            break
          }
          const x = rest[0]
          if (x.field === 'Pad_Type') {
            const pk = PAD_TYPES[x.value]
            if (!pk) continue
            const has = [...padKinds].filter(([, ks]) => ks.has(pk))
            // a part with pads of other types too cannot take a part override for some of them
            if (has.some(([, ks]) => ks.size > 1)) continue
            t = { parts: has.map(([r]) => r), what: `every part of ${x.value.toLowerCase()} pads`, kinds, loose: [] }
            break
          }
          if (REF_FIELDS.has(x.field) && refs.has(x.value)) {
            t = { parts: [refs.get(x.value)!], what: refs.get(x.value)!, kinds, loose: [] }
            break
          }
          continue
        }
        if (sType[0].value !== 'Track' && sType[0].value !== 'Via') continue
        const sNets = S.filter(x => x.field === 'NetName' || x.field === 'NetClass')
        if (sNets.length !== 1 || sNets[0].neg || S.length !== 2) continue
        const loose = oRest.map(x => `${x.side}.${x.field} ${x.neg ? '!=' : '=='} '${x.value}'`)
        if (oRest.some(x => !['NetName', 'NetClass', 'Pad_Type'].includes(x.field))) continue
        const n = sNets[0]
        if (n.field === 'NetName') {
          if (!nets.has(n.value)) continue
          t = { net: [n.value], what: n.value, kinds, loose }
          break
        }
        if (!classes.has(n.value)) continue
        t = { cls: n.value, what: `class ${n.value}`, kinds, loose }
        break
      }
      if (!t) return null
      targets.push(t)
    }
    // the conjunctions of one target merge their kinds
    const by = new Map<string, Target>()
    for (const t of targets) {
      const k = JSON.stringify([t.parts ?? null, t.net ?? null, t.cls ?? null])
      const had = by.get(k)
      if (had) {
        had.kinds = [...new Set([...had.kinds, ...t.kinds])]
        had.loose = [...new Set([...had.loose, ...t.loose])]
      } else by.set(k, { ...t })
    }
    const said: string[] = []
    for (const t of by.values()) {
      // pads of every type take in pads of one
      if (t.kinds.includes('pad')) t.kinds = t.kinds.filter(k => k !== 'pad.tht' && k !== 'pad.smd')
      const kv = kindsOf(t.kinds, v)
      if (t.parts)
        for (const r of t.parts) {
          const pr = out.parts.get(r) ?? {}
          out.parts.set(r, { ...pr, clearance: mergePartClearance(pr.clearance, kv) })
        }
      for (const n of t.net ?? []) out.nets.set(n, maxKinds(out.nets.get(n) ?? {}, kv))
      if (t.cls) {
        const had = out.classes.get(t.cls)
        out.classes.set(t.cls, typeof had === 'number' ? had : maxKinds(had ?? {}, kv))
      }
      said.push(`clearance ${v} to ${t.kinds.map(kindName).join(', ')} on ${t.what}${t.loose.length ? `, also where ${t.loose.join(' and ')} does not hold` : ''}`)
    }
    return said.join('; ')
  }

  function mapOne(dnf: Conjunction[], key: keyof PartRuleSet, v: number, ruleName: string): string | null {
    // a type test keeps the rule to pads, which part overrides are
    const fields = (c: Conjunction, side: 'A' | 'B') => c.filter(t => t.side === side && t.field !== 'Type')
    const typeOk = dnf.every(c => c.every(t => t.field !== 'Type' || t.value === 'Pad'))
    if (!typeOk) return null
    // part: every conjunction names one footprint by A, and B names the same one or nothing
    const partRefs = new Set<string>()
    const isPart = dnf.every(c => {
      const a = fields(c, 'A'),
        b = fields(c, 'B')
      if (a.length !== 1 || !REF_FIELDS.has(a[0].field) || b.length > 1) return false
      if (b.length && (!REF_FIELDS.has(b[0].field) || b[0].value !== a[0].value)) return false
      partRefs.add(a[0].value)
      return true
    })
    if (isPart) {
      if (![...partRefs].every(r => refs.has(r))) return null
      for (const r of partRefs) {
        const ref = refs.get(r)!,
          pr = out.parts.get(ref) ?? {}
        out.parts.set(ref, { ...pr, [key]: key === 'clearance' ? mergePartClearance(pr.clearance, v) : v })
      }
      return `${key} ${v} on ${[...partRefs].map(r => refs.get(r)).join(', ')}`
    }
    if (key !== 'clearance') return null
    // class: A.NetClass == 'X', with B the same class or nothing
    const cls = new Set<string>()
    const isClass = dnf.every(c => {
      const a = fields(c, 'A'),
        b = fields(c, 'B')
      if (a.length !== 1 || a[0].field !== 'NetClass' || b.length > 1) return false
      if (b.length && (b[0].field !== 'NetClass' || b[0].value !== a[0].value)) return false
      cls.add(a[0].value)
      return true
    })
    if (isClass) {
      if (![...cls].every(c => classes.has(c))) return null
      for (const c of cls) out.classes.set(c, v)
      return `clearance ${v} of class ${[...cls].join(', ')}`
    }
    // a group of nets: every pair of one set listed, which a new class says when no net of the set has a class yet
    const as = new Set<string>(),
      bs = new Set<string>(),
      pairs = new Set<string>()
    const isGroup = dnf.every(c => {
      const a = fields(c, 'A'),
        b = fields(c, 'B')
      if (a.length !== 1 || b.length !== 1 || a[0].field !== 'NetName' || b[0].field !== 'NetName') return false
      as.add(a[0].value)
      bs.add(b[0].value)
      pairs.add(`${a[0].value}\u0000${b[0].value}`)
      return true
    })
    if (!isGroup || as.size !== bs.size || ![...as].every(n => bs.has(n)) || pairs.size !== as.size * as.size) return null
    const group = [...as].filter(n => nets.has(n))
    if (!group.length || group.some(n => classOfNet.has(n) || out.netGroups.some(g => g.nets.includes(n)))) return null
    const base = name(ruleName) || 'group'
    let gname = base,
      i = 2
    while (taken.has(gname)) gname = `${base}_${i++}`
    taken.add(gname)
    out.netGroups.push({ name: gname, nets: group, clearance: v })
    return `clearance ${v} of the new class ${gname}, ${group.length} nets`
  }
}
