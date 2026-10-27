// `pcbjs import board`: a `.kicad_pcb` as pcb.tsx, pcb.sch.ts, pcb.copper.tsx, pcb.art.tsx, lib/ and pcb.config.ts.
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { readKicadDru, readKicadPcb, readKicadPro, type KBoard, type KCustomRule, type KProject, type KTrack, type KVia } from './board.js'
import { footprintPadSpecs, footprintTextSpecs, graphicSpecs, zoneSpecs, padPins, pcbjsLayer, polyPath, polyRing, refAtOf, swapSide, textSpec, type ElementSpec, type KFootprint, type KPad, type KZone } from './footprint.js'
import { findFootprint, installedFootprints, isInstalled, libraryOf, loadFootprint, prefixOf } from './library.js'
import { code, footprintModule, ident, jsx, key, lit, str } from './emit.js'
import { fmt, nm, normAngle, rotate, svgArcTo, type Pt } from './geom.js'
import { mapDru, maxPad, mergePartClearance, type DruMapping, type PadTypeMM, type PartRuleSet } from './dru.js'
import { readSchematicFields, schematicFiles, type KSymbolFields } from './schematic.js'
import { findFont, kicadOutlineText, type FoundFont } from './fonts.js'

export interface ImportBoardOptions {
  /** the board file written, default pcb.tsx; the other files take its name: pcb.sch.ts, pcb.copper.tsx, pcb.art.tsx */
  out?: string
  /** the folder the footprint modules go to, relative to the board file, default lib */
  lib?: string
  /** default the file name */
  name?: string
  /** the project folder of the KiCad board, for ${KIPRJMOD}; default the board's folder */
  kicadProject?: string
  /** the absolute folder the files are written to, so project models are referenced relative to them */
  outDir?: string
  /** the board file as the entries of pcb.config.ts name it, when the config is written to another folder; default `out` */
  entry?: string
  /** the `.kicad_sch` to read part fields from, default the one beside the board; false reads none */
  schematic?: string | false
  /** the folders searched for TrueType faces, default the system, user and KiCad font folders */
  fontDirs?: string[]
}

export interface ImportResult {
  /** by path relative to the output folder */
  files: Map<string, string>
  /** absolute sources to copy as they are, such as fonts, by path relative to the output folder */
  copies: Map<string, string>
  counts: Record<string, number>
  /** what a person should look at */
  notes: string[]
}

const xy = (p: Pt) => `${fmt(p[0])} ${fmt(p[1])}`
const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })
const prefixOfRef = (ref: string) => /^[A-Za-z_]+/.exec(ref)?.[0].replace(/_+$/, '') || ref
const PCBJS_REF = /^[A-Za-z_]\w*$/
const AUTO_REF = /^[A-Z]+\d+$/
const COPPER = /^(F|B)\.Cu$|^In\d+\.Cu$/

/** Unique identifiers in the shared namespace of the generated files. */
class Names {
  private used = new Set(['PCB', 'nets', 'NC', 'route', 'via', 'pour', 'keepout', 'kicadFootprint', 'kicadModel', 'defineFootprint', 'defineConfig', 'defineDefaultRules', 'copper', 'Art', 'VIA', 'AS_DRAWN', 'source', 'React', 'h', 'Fragment', 'FootprintProps'])
  take(want: string): string {
    let s = want, i = 2
    while (this.used.has(s)) s = `${want}_${i++}`
    this.used.add(s)
    return s
  }
  has(s: string) { return this.used.has(s) }
}

/** A net name as an identifier: +5V is P5V, -12V is N12V, /D6 is D6. */
function netIdent(name: string): string {
  const s = name.replace(/^\//, '').replace(/^\+/, 'P').replace(/^-/, 'N').replace(/^~\{(.*)\}$/, 'n$1')
  return ident(s, 'NET')
}

function boardPoint(fp: KFootprint, p: Pt): Pt {
  const [x, y, a] = fp.at!
  const local: Pt = fp.side === 'B' ? [p[0], -p[1]] : p
  const r = rotate(local, a)
  return [nm(x + r[0]), nm(y + r[1])]
}
function padBoardLayers(fp: KFootprint, p: KPad, copper: string[]): string[] {
  const own = p.layers.flatMap(l => l === '*.Cu' || l === 'F&B.Cu' ? copper : COPPER.test(l) ? [l] : [])
  return fp.side === 'B' ? own.map(swapSide) : own
}

/** A key of a footprint's pads and fab-layer graphics, equal for a board copy KiCad rotated or rewrote. */
export function padKey(fp: KFootprint): string {
  const r = (v: number) => Math.round(v * 1e4) / 1e4
  const pads = JSON.stringify(footprintPadSpecs(fp), (_k, v) => typeof v === 'number' ? r(v) : v)
  return pads + '\n' + graphicKey(fp, /\.(Cu|Mask|Paste|SilkS|CrtYd)$|^Edge\.Cuts$/)
}
/** A canonical key of a whole footprint, the courtyard, `bom` and `pos` left out, equal for copies KiCad wrote differently. */
export function defKey(fp: KFootprint, copper: string[] = ['F.Cu', 'B.Cu']): string {
  const r = (v: number) => Math.round(v * 1e4) / 1e4
  const json = (v: unknown) => JSON.stringify(v, (_k, x) => typeof x === 'number' ? r(x) : x)
  const pads = footprintPadSpecs(fp, copper).map(json).sort()
  const graphics = graphicKey({ ...fp, graphics: fp.graphics.filter(g => !/CrtYd$|Courtyard$/.test(g.layer)) }, /./)
  const texts = footprintTextSpecs(fp).map(json).sort()
  const zones = zoneSpecs(fp.zones, copper).map(z => json({ ...z.props, d: canonicalRing(String(z.props.d)) })).sort()
  const models = fp.models.filter(m => !m.hidden).map(json)
  return [...pads, '', graphics, '', ...texts, '', ...zones, '', ...models].join('\n')
}
/** Graphics as sorted primitives: lines without direction, rings without a start. */
function graphicKey(fp: KFootprint, layers: RegExp): string {
  const r = (v: number) => Math.round(v * 1e4) / 1e4
  const p = (q: Pt) => `${r(q[0])},${r(q[1])}`
  const line = (l: string, w: number, a: Pt, b: Pt) => { const [u, v] = [p(a), p(b)].sort(); return u === v ? null : `L|${l}|${r(w)}|${u}|${v}` }
  const primitives: string[] = []
  for (const g of fp.graphics) {
    if (!layers.test(g.layer)) continue
    const l = g.layer, w = g.width
    if (g.kind === 'line') primitives.push(line(l, w, g.start!, g.end!) ?? '')
    else if (g.kind === 'arc') primitives.push(`A|${l}|${r(w)}|${[p(g.start!), p(g.end!)].sort().join('|')}|${p(g.mid!)}`)
    else if (g.kind === 'circle') primitives.push(`C|${l}|${r(w)}|${p(g.center!)}|${r(Math.hypot(g.end![0] - g.center![0], g.end![1] - g.center![1]))}|${g.fill}`)
    else if (g.kind === 'rect' || g.kind === 'poly') {
      const pts: Pt[] = g.kind === 'rect' ? [g.start!, [g.end![0], g.start![1]], g.end!, [g.start![0], g.end![1]]] : polyRing(g.pts ?? [])
      if (g.fill) primitives.push(`P|${l}|${r(w)}|${pts.map(p).sort().join('|')}`)
      else pts.forEach((q, i) => primitives.push(line(l, w, q, pts[(i + 1) % pts.length]) ?? ''))
    } else primitives.push(JSON.stringify(g))
  }
  return primitives.filter(Boolean).sort().join('\n')
}
const NUMBER = /-?\d+(?:\.\d+)?(?:e-?\d+)?/g
export const keyShape = (k: string) => k.replace(NUMBER, '#')
/** Two keys of padKey or defKey with every number within `tol` mm, for KiCad's nanometre noise such as -0.412499 for -0.4125. */
export function sameGeometry(a: string, b: string, tol = 1e-3): boolean {
  if (a === b) return true
  if (keyShape(a) !== keyShape(b)) return false
  const na = a.match(NUMBER) ?? [], nb = b.match(NUMBER) ?? []
  return na.length === nb.length && na.every((x, i) => Math.abs(Number(x) - Number(nb[i])) <= tol + 1e-9)
}

/** Each pad number's `thermal` as JSON; null when one number has two settings, which a placement's map cannot tell apart. */
export function padThermals(fp: KFootprint, copper: string[] = ['F.Cu', 'B.Cu']): Map<string, string> | null {
  const m = new Map<string, string>()
  for (const sp of footprintPadSpecs(fp, copper)) {
    const num = String(sp.props.num ?? ''), v = JSON.stringify(sp.props.thermal ?? null)
    if (m.has(num) && m.get(num) !== v) return null
    m.set(num, v)
  }
  return m
}
/** The pads of `nums`, or every numbered pad, put on the pour's own 90 degree relief; no map can name an unnumbered pad. */
function plainThermal(fp: KFootprint, nums?: Set<string>): KFootprint {
  return { ...fp, pads: fp.pads.map(p => (p.num !== '' && (!nums || nums.has(p.num)) ? { ...p, zoneConnect: 1, thermalAngle: 90 } : p)) }
}
/** A placement's `thermal` for a pad that wants `want` where its footprint has `has`, both as padThermals writes them. */
function thermalValue(want: string, has: string): unknown {
  const v = JSON.parse(want)
  if (v !== null) return v
  return JSON.parse(has)?.angle !== undefined ? { angle: 90 } : 'thermal'
}

const canonicalRing = (d: string) => (d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).join(' ').split(' ').reduce<string[]>((a, v, i, all) => (i % 2 ? a : [...a, `${all[i]},${all[i + 1]}`]), []).sort().join('|')
function courtyardArea(fp: KFootprint): number {
  const pts: Pt[] = []
  for (const g of fp.graphics) {
    if (!/CrtYd$|Courtyard$/.test(g.layer)) continue
    for (const q of [g.start, g.end, g.mid, g.center]) if (q) pts.push(q)
    if (g.pts) pts.push(...polyRing(g.pts))
    if (g.kind === 'circle' && g.center && g.end) { const rad = Math.hypot(g.end[0] - g.center[0], g.end[1] - g.center[1]); pts.push([g.center[0] - rad, g.center[1] - rad], [g.center[0] + rad, g.center[1] + rad]) }
  }
  if (!pts.length) return Infinity
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1])
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
}

const SOURCE_KEYS: [RegExp, string][] = [
  [/^(mpn|mfr\.? ?pn|manufacturer[ _]part[ _]number|part ?number|mfr part)$/i, 'MPN'],
  [/^(manufacturer|mfr|mfg)$/i, 'Manufacturer'],
  [/^(lcsc|lcsc ?part( ?#| ?number)?|jlcpcb ?part( ?#)?|jlc)$/i, 'MPN:LCSC'],
  [/^(digi-?key(_pn| ?part( ?#| ?number)?)?)$/i, 'MPN:DigiKey'],
  [/^(mouser( ?part( ?#| ?number)?)?)$/i, 'MPN:Mouser'],
]
const SKIP_FIELDS = /^(Reference|Value|Footprint|KiLib_Generator|ki_.*|Sim\..*|Sheetfile|Sheetname|Intersheetrefs|DNP)$/i

/** The board footprint's properties, the schematic symbol's fields over them. */
function sourceOf(fp: KFootprint, sym?: KSymbolFields): Record<string, string> {
  const out: Record<string, string> = {}
  for (const fields of [fp.properties, sym?.fields ?? {}]) for (const [k, v] of Object.entries(fields)) {
    if (SKIP_FIELDS.test(k) || !v || v === '~' || /\$\{[^}]*\}/.test(v)) continue
    const mapped = SOURCE_KEYS.find(([re]) => re.test(k))?.[1] ?? k
    out[mapped] = v
  }
  return out
}

interface FpDef {
  fp: KFootprint
  name: string
  /** `Lib:Name` when it is the KiCad library's own */
  kicadId?: string
  /** the module it is imported from, relative to the board file */
  module: string
  pins: string[]
  copies: KFootprint[]
  libThermals?: Map<string, string>
}
interface Inst {
  fp: KFootprint
  def: FpDef
  ref: string
  name: string
  part: boolean
  /** pin to net name, NC when undefined */
  conn: Map<string, string | undefined>
  /** board centres and layers */
  pads: { pin: string; at: Pt; layers: string[]; net?: string; split: boolean }[]
}

/** Import a `.kicad_pcb` as files relative to the board file's folder. */
export function importBoard(file: string, o: ImportBoardOptions = {}): ImportResult {
  const board = readKicadPcb(file)
  const pro = readKicadPro(file.replace(/\.kicad_pcb$/, '.kicad_pro'))
  const dru = readKicadDru(file.replace(/\.kicad_pcb$/, '.kicad_dru'))
  const sch = o.schematic === false ? [] : o.schematic ? [o.schematic] : schematicFiles(file)
  const symbols = sch.length ? readSchematicFields(sch) : undefined
  return importBoardData(board, pro, { dru, ...o, name: o.name ?? basename(file).replace(/\.kicad_pcb$/, ''), kicadProject: o.kicadProject ?? dirname(file), source: file, ...(symbols ? { symbols, schematicName: basename(sch[0]) } : {}) })
}

export function importBoardData(board: KBoard, pro: KProject | null, o: ImportBoardOptions & { source?: string; dru?: KCustomRule[]; symbols?: Map<string, KSymbolFields>; schematicName?: string } = {}): ImportResult {
  const out = o.out ?? 'pcb.tsx'
  const stem = basename(out).replace(/\.tsx$/, '')
  const libDir = o.lib ?? 'lib'
  const files = new Map<string, string>()
  const copies = new Map<string, string>()
  const notes: string[] = []
  const counts: Record<string, number> = {}
  const names = new Names()
  const copperLayers = board.copper
  const src = o.source ? basename(o.source) : 'the KiCad board'

  // refs first: parts are named by them, nets and footprints give way
  const refOf = new Map<KFootprint, string>()
  const refName = new Map<KFootprint, string>()
  {
    const refsSeen = new Map<string, number>()
    for (const fp of board.footprints) {
      let ref = fp.properties.Reference ?? ''
      if (!PCBJS_REF.test(ref)) {
        const fixed = ref.replace(/\W/g, '_').replace(/^(?=\d|$)/, 'X')
        notes.push(`ref ${JSON.stringify(ref)} is not a pcbjs ref, letters, digits and underscores: imported as ${fixed}`)
        ref = fixed
      }
      const seen = refsSeen.get(ref) ?? 0
      refsSeen.set(ref, seen + 1)
      if (seen) { const again = `${ref}_${seen + 1}`; notes.push(`ref ${ref} is on ${seen + 1} footprints: the later one is ${again}`); ref = again }
      refOf.set(fp, ref)
    }
    for (const fp of [...board.footprints].sort((a, b) => natural(refOf.get(a)!, refOf.get(b)!))) {
      const r = refOf.get(fp)!
      refName.set(fp, names.take(PCBJS_REF.test(r) ? r : ident(r, 'X')))
    }
  }

  const allNets = new Set<string>()
  for (const fp of board.footprints) for (const p of fp.pads) if (p.net) allNets.add(p.net)
  for (const t of board.tracks) if (t.net) allNets.add(t.net)
  for (const v of board.vias) if (v.net) allNets.add(v.net)
  for (const z of board.zones) if (z.net && !z.keepout) allNets.add(z.net)
  const isNC = (n: string | undefined) => !n || /^unconnected-/.test(n)
  const display = new Map<string, string>()
  const taken = new Set<string>()
  for (const n of [...allNets].sort(natural)) {
    if (isNC(n)) continue
    let d = n.replace(/^\//, '')
    if (!d || taken.has(d) || allNets.has(d) && d !== n) d = n
    display.set(n, d)
    taken.add(d)
  }
  const netId = new Map<string, string>()
  for (const [n] of display) { const want = netIdent(display.get(n)!); netId.set(n, names.take(names.has(want) ? `${want}_NET` : want)) }
  const netRef = (n: string | undefined) => (n && netId.has(n) ? netId.get(n)! : undefined)

  const classOf = new Map<string, string>()
  if (pro) {
    const glob = (p: string) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
    for (const [n] of display) {
      let c = pro.assignments[n]
      if (!c) for (const p of pro.patterns) if (glob(p.pattern).test(n) || glob(p.pattern).test(display.get(n)!)) { c = p.netclass; break }
      if (c && c !== 'Default') classOf.set(n, c)
    }
  }

  const kicadRefs = new Map<string, string>()
  for (const fp of board.footprints) { const k = fp.properties.Reference; if (k && !kicadRefs.has(k)) kicadRefs.set(k, refOf.get(fp)!) }
  const padKinds = new Map<string, Set<string>>()
  for (const fp of board.footprints) { const r = refOf.get(fp)!, ks = padKinds.get(r) ?? new Set<string>(); for (const p of fp.pads) ks.add(p.kind); padKinds.set(r, ks) }
  const dru: DruMapping = mapDru(o.dru ?? [], kicadRefs, classOf, new Set(pro?.classes.map(c => c.name) ?? []), new Set(display.keys()), r => ident(r.replace(/[^A-Za-z0-9]+/g, ' ').trim().replace(/ (\w)/g, (_m, c: string) => c.toUpperCase()).replace(/^\w/, c => c.toLowerCase()), 'rules'), padKinds)
  for (const g of dru.netGroups) for (const n of g.nets) classOf.set(n, g.name)
  // the custom rules' part overrides win over the footprint's own clearance
  const partRules = new Map<string, PartRuleSet>()
  for (const fp of board.footprints) if (fp.clearance !== undefined) partRules.set(refOf.get(fp)!, { clearance: nm(fp.clearance) })
  for (const [ref, r] of dru.parts) { const pr = partRules.get(ref) ?? {}, c = mergePartClearance(pr.clearance, r.clearance); partRules.set(ref, { ...pr, ...r, ...(c !== undefined ? { clearance: c } : {}) }) }

  const installed = installedFootprints()
  const defs: FpDef[] = []
  const byKey = new Map<string, FpDef>()
  const kicadDefs: FpDef[] = []
  const localDefs: FpDef[] = []
  const fpName = (fp: KFootprint) => names.take(ident(fp.name, 'Footprint'))
  const keyOf = new Map<KFootprint, string>()
  const kicadCache = new Map<string, { id: string; key: string; plain: string; thermals: Map<string, string> | null } | null>()
  // keys by their shape, to find a copy that differs by noise below 1 µm
  const byShape = new Map<string, string[]>()
  for (const fp of board.footprints) {
    // copies that differ only in zone connections are one footprint with a thermal map on each placement
    const thermals = padThermals(fp, copperLayers)
    const plain = thermals ? plainThermal(fp) : fp
    let kicadId: string | undefined, libThermals: Map<string, string> | undefined
    if (installed) {
      const want = fp.lib ? `${fp.lib}:${fp.name}` : fp.name
      if (!kicadCache.has(want)) {
        const f = findFootprint(want, { footprints: [] })
        let lib: KFootprint | null = null
        if (f && isInstalled(f)) try { lib = loadFootprint(f) } catch { lib = null }
        kicadCache.set(want, lib && f ? { id: `${libraryOf(f)}:${fp.name}`, key: padKey(lib), plain: padKey(plainThermal(lib)), thermals: padThermals(lib, copperLayers) } : null)
      }
      const hit = kicadCache.get(want)
      if (hit && (sameGeometry(hit.key, padKey(fp)) || (thermals && hit.thermals && sameGeometry(hit.plain, padKey(plain))))) { kicadId = hit.id; libThermals = hit.thermals ?? undefined }
    }
    let k = kicadId ? `kicad:${kicadId}` : `local:${thermals ? '' : 'thermal:'}${defKey(plain, copperLayers)}`
    if (!kicadId && !byKey.has(k)) {
      const shape = keyShape(k)
      const near = byShape.get(shape)?.find(x => sameGeometry(x, k))
      if (near) k = near
      else byShape.set(shape, [...(byShape.get(shape) ?? []), k])
    }
    keyOf.set(fp, k)
    const had = byKey.get(k)
    // equal copies make one module, written from the copy with the tightest courtyard
    if (had) { had.copies.push(fp); if (!kicadId && courtyardArea(fp) < courtyardArea(had.fp)) had.fp = fp; continue }
    const name = fpName(fp)
    const def: FpDef = { fp, name, module: kicadId ? `./${libDir}/kicad` : `./${libDir}/${name}`, pins: padPins(fp), copies: [fp], ...(kicadId ? { kicadId } : {}), ...(libThermals ? { libThermals } : {}) }
    byKey.set(k, def)
    defs.push(def)
    ;(kicadId ? kicadDefs : localDefs).push(def)
  }
  // what every copy shares stays on the pads, the rest is each placement's thermal map
  const thermalMap = new Map<KFootprint, Record<string, unknown>>()
  for (const def of defs) {
    const maps = def.copies.map(fp => [fp, padThermals(fp, copperLayers)] as const)
    if (maps.some(([, m]) => !m)) continue
    let base: Map<string, string>
    if (def.kicadId) {
      if (!def.libThermals) continue
      base = def.libThermals
    } else {
      const nums = [...new Set(maps.flatMap(([, m]) => [...m!.keys()]))]
      const differ = new Set(nums.filter(n => new Set(maps.map(([, m]) => m!.get(n) ?? 'null')).size > 1))
      if (!differ.size) continue
      def.fp = plainThermal(def.fp, differ)
      base = padThermals(def.fp, copperLayers)!
    }
    for (const [fp, m] of maps) {
      const out: Record<string, unknown> = {}
      for (const [n, v] of m!) if (v !== (base.get(n) ?? 'null')) out[n] = thermalValue(v, base.get(n) ?? 'null')
      if (Object.keys(out).length) thermalMap.set(fp, out)
    }
  }
  if (thermalMap.size) notes.push(`${thermalMap.size} placement${thermalMap.size === 1 ? '' : 's'} join pours differently from the other copies of their footprint: each carries a thermal map of those pads`)
  counts.footprints = defs.length
  counts.kicadLibrary = kicadDefs.length
  counts.lib = localDefs.length

  const insts: Inst[] = []
  for (const fp of board.footprints) {
    const def = byKey.get(keyOf.get(fp)!)!
    const ref = refOf.get(fp)!
    const pads = fp.pads.filter(p => p.num !== '' && p.kind !== 'np_thru_hole' && p.layers.some(l => COPPER.test(l) || l === '*.Cu' || l === 'F&B.Cu'))
      .map(p => ({ pin: p.num, at: boardPoint(fp, p.at), layers: padBoardLayers(fp, p, copperLayers), net: isNC(p.net) ? undefined : p.net, split: !!p.stack?.length }))
    const conn = new Map<string, string | undefined>()
    for (const pin of def.pins) {
      const ns = pads.filter(p => p.pin === pin).map(p => p.net)
      const count = new Map<string | undefined, number>()
      for (const n of ns) count.set(n, (count.get(n) ?? 0) + 1)
      const best = [...count].sort((a, b) => b[1] - a[1] || (a[0] ? -1 : 1))[0]?.[0]
      if (count.size > 1) notes.push(`${ref} pin ${pin}: its pads are on ${[...count.keys()].map(n => n ?? 'no net').join(' and ')}; connected to ${best ?? 'NC'}`)
      conn.set(pin, best)
    }
    const part = def.pins.length > 0
    insts.push({ fp, def, ref, name: '', part, conn, pads })
  }
  insts.sort((a, b) => natural(a.ref, b.ref))
  for (const i of insts) i.name = refName.get(i.fp)!
  counts.parts = insts.filter(i => i.part).length
  counts.plain = insts.filter(i => !i.part).length

  // remove_unused_layers: a through-hole pad's copper only where it connects in any placement
  {
    const inner = copperLayers.slice(1, -1)
    const padId = (p: KPad) => `${p.num}@${fmt(p.at[0])},${fmt(p.at[1])}`
    const want = new Map<FpDef, Map<string, Set<string>>>()
    let pads = 0
    for (const i of insts) {
      for (const p of i.fp.pads) {
        if (p.kind !== 'thru_hole' || !p.removeUnused || !inner.length) continue
        const at = boardPoint(i.fp, p.at), reach = Math.max(...p.size) / 2 + 1e-3
        const keep = new Set<string>(p.removeUnused.keepEnds ? [copperLayers[0], copperLayers[copperLayers.length - 1]] : [])
        // board layers, brought to the footprint's frame below, where a back part's layers swap
        for (const z of p.removeUnused.zones) keep.add(z)
        if (p.net) for (const t of board.tracks) if (t.net === p.net && [t.start, t.end].some(q => Math.hypot(q[0] - at[0], q[1] - at[1]) <= reach)) keep.add(t.layer)
        if (!want.has(i.def)) want.set(i.def, new Map())
        const m = want.get(i.def)!
        const k = padId(p)
        m.set(k, new Set([...(m.get(k) ?? []), ...[...keep].map(l => i.fp.side === 'B' ? swapSide(l) : l)]))
      }
    }
    for (const [def, m] of want) {
      def.fp = { ...def.fp, pads: def.fp.pads.map(p => {
        const ls = m.get(padId(p))
        if (!ls || p.kind !== 'thru_hole' || !p.removeUnused) return p
        // a pad keeps at least one copper layer
        const cu = copperLayers.filter(l => ls.has(l))
        pads++
        return { ...p, layers: [...(cu.length ? cu : [copperLayers[0]]), ...p.layers.filter(l => !COPPER.test(l) && l !== '*.Cu' && l !== 'F&B.Cu')] }
      }) }
    }
    if (pads) notes.push(`${pads} through-hole pad${pads === 1 ? '' : 's'} of the footprints have KiCad's remove_unused_layers: their copper is on the layers a track or zone joins them on in some placement, the outer layers too with keep_end_layers`)
  }

  if (kicadDefs.length) {
    const lines = [`// Footprints of the KiCad library that ${src} places, resolved by kicadFootprint against the installed library,`, '// KICAD_FOOTPRINTS or kicad.footprints of pcb.config.ts. `pcbjs import footprint <Lib:Name>` makes an own copy to edit.', `import { kicadFootprint } from '@pcbjs/kicad'`, '']
    for (const d of kicadDefs) lines.push(`export const ${d.name} = kicadFootprint(${str(d.kicadId!)})`)
    files.set(`${libDir}/kicad.ts`, lines.join('\n') + '\n')
  }
  for (const d of localDefs) {
    const fp = { ...d.fp, properties: { ...d.fp.properties, Value: d.fp.name } }
    const m = footprintModule(fp, { exportName: d.name, source: `${src}${d.fp.lib ? `, footprint ${d.fp.lib}:${d.fp.name}` : `, footprint ${d.fp.name}`}`, copper: copperLayers, prefix: prefixOf(d.fp.lib, d.fp.name), attrs: false, ...(o.kicadProject && o.outDir ? { kicadProject: o.kicadProject, fileDir: join(o.outDir, libDir) } : {}) })
    files.set(`${libDir}/${d.name}.tsx`, m.code)
  }

  const sourcing: { name: string; spec: string }[] = []
  const dnpRefs = new Set<string>()
  {
    const lines: string[] = [`// The nets and parts of ${src}: one part per footprint, named by its ref, each pad's net given by .connect().`, '// Pins are the pad numbers; rename them with pinNames on the footprint, then connect by name.']
    const imports = new Map<string, Set<string>>()
    const need = (mod: string, n: string) => { if (!imports.has(mod)) imports.set(mod, new Set()); imports.get(mod)!.add(n) }
    const usesNC = insts.some(i => i.part && [...i.conn.values()].some(v => v === undefined || !netId.has(v)))
    lines.push(`import { nets${usesNC ? ', NC' : ''} } from '@pcbjs/core'`)
    for (const i of insts) if (i.part) need(i.def.module, i.def.name)
    for (const [mod, ns] of [...imports].sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`import { ${[...ns].sort().join(', ')} } from '${mod}'`)
    lines.push('')
    const ids = [...netId]
    const classes: Record<string, unknown> = {}
    for (const [n, c] of classOf) classes[display.get(n)!] = { class: c }
    lines.push('export const {')
    for (const [n, id] of ids) lines.push(`  ${key(display.get(n)!) === id ? id : `${key(display.get(n)!)}: ${id}`},`)
    lines.push(`} = nets(${Object.keys(classes).length ? lit(classes) : ''})`)
    const ruled = [...dru.nets].filter(([n]) => netId.has(n))
    if (ruled.length) lines.push('', ...ruled.map(([n, k]) => `${netId.get(n)}.rules({ clearance: ${lit(k)} })`))
    counts.nets = ids.length
    let group = ''
    for (const i of insts) {
      if (!i.part) continue
      const g = prefixOfRef(i.ref)
      if (g !== group) { lines.push(''); group = g }
      const value = i.fp.properties.Value ?? ''
      const sym = o.symbols?.get(i.fp.properties.Reference ?? i.ref)
      const source = sourceOf(i.fp, sym)
      if (Object.keys(source).length) sourcing.push({ name: i.name, spec: lit(source) })
      const opts: Record<string, unknown> = {}
      if (!i.fp.attrs.bom) opts.bom = false
      if (!i.fp.attrs.pos) opts.pos = false
      if (i.fp.attrs.dnp || sym?.dnp) { opts.dnp = true; dnpRefs.add(i.ref) }
      let args: string
      if (Object.keys(opts).length) args = lit({ ...(value ? { value } : {}), ...opts })
      else args = value ? str(value) : ''
      const conn = [...i.conn].map(([pin, n]) => `${key(pin)}: ${netRef(n) ?? 'NC'}`)
      const refCall = AUTO_REF.test(i.ref) && i.name === i.ref ? '' : `.ref(${str(i.ref)})`
      const fns = i.fp.pads.filter(p => p.pinFunction && p.pinFunction !== p.num && !/^Pin_?\d+$/i.test(p.pinFunction)).map(p => `${p.num} ${p.pinFunction}`)
      const fnNote = fns.length ? ` // ${[...new Set(fns)].join(', ')}` : ''
      const pr = partRules.get(i.ref)
      const rulesCall = pr && Object.keys(pr).length ? `.rules(${lit(pr)})` : ''
      lines.push(`export const ${i.name} = ${i.def.name}(${args})${refCall}.connect({ ${conn.join(', ')} })${rulesCall}${fnNote}`)
    }
    files.set(`${stem}.sch.ts`, lines.join('\n') + '\n')
  }

  // one source() per set of equal fields
  if (sourcing.length) {
    const groups = new Map<string, string[]>()
    for (const x of sourcing) groups.set(x.spec, [...(groups.get(x.spec) ?? []), x.name])
    const from = o.schematicName ? `the symbols of ${o.schematicName} and the footprints of ${src}` : `the footprints of ${src}`
    const lines = [`// Part numbers and fields of ${src}, from ${from}: MPN, Manufacturer, LCSC as 'MPN:LCSC' and the project's own fields.`, "// A fab target orders its tag first, 'MPN:LCSC' for JLCPCB, then MPN; see the docs topic sourcing.", `import { source } from '@pcbjs/core'`]
    const used = sourcing.map(x => x.name)
    lines.push(used.length > 12 ? `import {\n  ${chunk(used, 12).map(c => c.join(', ')).join(',\n  ')},\n} from './${stem}.sch'` : `import { ${used.join(', ')} } from './${stem}.sch'`, '')
    for (const [spec, ns] of groups) lines.push(`source(${ns.length === 1 ? ns[0] : `[${ns.join(', ')}]`}, ${spec})`)
    files.set(`${stem}.sourcing.ts`, lines.join('\n') + '\n')
    counts.sourced = sourcing.length
  }

  const copperFile = buildCopper(board, insts, netRef, copperLayers, notes, counts)
  const copperNeeds = copperFile.parts
  {
    const lines = [`// The copper of ${src}: pours and keepouts, then each net's tracks as route chains, straight .Z() segments with .via() at`, '// each layer change, and the vias no chain passes through. Replace a chain with .X() legs to let the router redo it.']
    const coreNames = ['route', ...(copperFile.usesVia ? ['via'] : []), ...(copperFile.usesPour ? ['pour'] : []), ...(copperFile.usesKeepout ? ['keepout'] : [])]
    lines.push(`import { ${coreNames.join(', ')} } from '@pcbjs/core'`)
    const used = [...new Set([...copperNeeds, ...copperFile.nets])].sort(natural)
    if (used.length) lines.push(`import { ${used.join(', ')} } from './${stem}.sch'`)
    lines.push('')
    if (copperFile.via) lines.push(`/** the vias of ${src}, drill and copper size in mm */`, `const VIA = ${lit(copperFile.via)}`, '')
    if (copperFile.usesNeck) lines.push(`/** no neck-down at the pads: each track keeps the width KiCad gave it up to the pad, see the docs topic import */`, 'const AS_DRAWN = { length: 0 }', '')
    lines.push('export const copper = [')
    for (const l of copperFile.lines) lines.push(l === '' ? '' : `  ${l}`)
    lines.push(']')
    files.set(`${stem}.copper.tsx`, lines.join('\n') + '\n')
  }

  const art = graphicSpecs(board.graphics.filter(g => g.layer !== 'Edge.Cuts'))
  counts.graphics = art.length
  if (art.length) {
    const lines = [`// The graphics of ${src} itself: silk, Fab and user layers. Footprint graphics are in their footprints.`, '', 'export const Art = () => (', '  <>']
    for (const e of art) lines.push(`    ${jsx(e)}`)
    lines.push('  </>', ')')
    files.set(`${stem}.art.tsx`, lines.join('\n') + '\n')
  }

  {
    const outline = graphicSpecs(board.graphics.filter(g => g.layer === 'Edge.Cuts'))
    counts.outline = outline.length
    // an installed TrueType face is copied into fonts/ and named in <PCB fonts>, else the text is Hershey
    const faces = new Map<string, { key: string; found: FoundFont } | null>()
    const fontTable: Record<string, { file: string; weight?: number }> = {}
    const licences: string[] = []
    const textComments = new Map<ElementSpec, string>()
    const texts = board.texts.filter(t => !t.hidden && t.text && pcbjsLayer(t.layer)).map(t => {
      const layer = pcbjsLayer(t.layer)!
      if (!t.face) return textSpec(t, layer)
      const look = `${t.face}|${!!t.bold}|${!!t.italic}`
      if (!faces.has(look)) {
        const found = findFont(t.face, { bold: t.bold, italic: t.italic, ...(o.fontDirs ? { dirs: o.fontDirs } : {}) })
        if (!found) faces.set(look, null)
        else {
          let k = [t.face, t.bold ? 'bold' : '', t.italic ? 'italic' : ''].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'font'
          while (fontTable[k]) k += '-2'
          const file = basename(found.path)
          fontTable[k] = { file: `./fonts/${file}`, ...(found.weight !== undefined ? { weight: found.weight } : {}) }
          if (!copies.has(`fonts/${file}`)) {
            copies.set(`fonts/${file}`, found.path)
            licences.push(`- \`${file}\`: ${found.family}${found.copyright ? `, ${found.copyright.replace(/\s+/g, ' ')}` : ''}. ${found.license ? `${found.license.replace(/\s+/g, ' ').replace(/\.$/, '')}${found.licenseUrl ? `, ${found.licenseUrl}` : ''}.` : 'The font names no licence; check its terms before sharing the board.'} Copied from ${found.path} by pcbjs import.`)
          }
          faces.set(look, { key: k, found })
          notes.push(`text in "${t.face}"${t.bold ? ' bold' : ''}${t.italic ? ' italic' : ''}: ${found.family} ${found.style} from ${found.path}, copied to fonts/${file}${found.notBold ? '; no bold file was found and pcbjs draws no synthetic bold, so it is the regular weight' : ''}`)
        }
      }
      const hit = faces.get(look)
      if (!hit) {
        const spec = textSpec(t, layer, t.text, undefined, true)
        textComments.set(spec, `KiCad font "${t.face}"${t.bold ? ' bold' : ''}${t.italic ? ' italic' : ''} is not installed here: drawn in Hershey`)
        return spec
      }
      return textSpec(t, layer, t.text, { font: hit.key, ...kicadOutlineText(hit.found.font, t.size) })
    })
    const missingFaces = [...faces].filter(([, v]) => !v).map(([k]) => k.split('|')[0])
    if (missingFaces.length) notes.push(`text in ${[...new Set(missingFaces)].map(f => JSON.stringify(f)).join(', ')} is drawn in Hershey: the font is not installed here; install it and import again, or name it in fonts, see the docs topic fonts`)
    if (licences.length) files.set('fonts/LICENSES.md', ['# Fonts', '', 'The font files of the board text, copied by pcbjs import. Each keeps its own licence, which travels with the file.', '', ...licences, ''].join('\n'))
    counts.texts = texts.length
    const stack = stackupOf(board, notes)
    const classes = classTable(pro, classOf, dru)
    const boardProps: Record<string, unknown> = { name: o.name ?? stem }
    if (board.title && board.title !== boardProps.name) boardProps.title = board.title
    if (board.revision) boardProps.revision = board.revision
    if (stack) boardProps.stackup = code(lit(stack))
    else if (copperLayers.length !== 2) boardProps.copper = copperLayers.length
    if (classes) boardProps.classes = code(lit(classes))
    if (Object.keys(fontTable).length) boardProps.fonts = code(lit(fontTable))
    const lines = [`// ${boardProps.name}: imported from ${src} by pcbjs import board. A skeleton to refine, see the docs topic import.`, '// Frame: KiCad\'s, mm, x right, y down; a back part is side="B" at KiCad\'s angle plus 180.', `import PCB from '@pcbjs/core'`]
    const partNames = insts.filter(i => i.part).map(i => i.name)
    if (partNames.length) {
      const chunks: string[] = []
      for (let k = 0; k < partNames.length; k += 12) chunks.push(partNames.slice(k, k + 12).join(', '))
      lines.push(chunks.length === 1 ? `import { ${chunks[0]} } from './${stem}.sch'` : `import {\n  ${chunks.join(',\n  ')},\n} from './${stem}.sch'`)
    }
    const plainImports = new Map<string, Set<string>>()
    for (const i of insts) if (!i.part) { if (!plainImports.has(i.def.module)) plainImports.set(i.def.module, new Set()); plainImports.get(i.def.module)!.add(i.def.name) }
    for (const [mod, ns] of [...plainImports].sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`import { ${[...ns].sort().join(', ')} } from '${mod}'`)
    lines.push(`import { copper } from './${stem}.copper'`)
    if (sourcing.length) lines.push(`import './${stem}.sourcing'`)
    if (art.length) lines.push(`import { Art } from './${stem}.art'`)
    lines.push('', 'export default (')
    const attrs = Object.entries(boardProps).map(([k, v]) => jsx({ type: 'x', props: { [k]: v } }).slice(3, -3))
    lines.push(`  <PCB ${attrs.join(' ')}>`)
    if (outline.length) {
      lines.push('    {/* outline and cutouts */}')
      for (const e of outline) lines.push(`    ${jsx(e)}`)
    }
    let group = ''
    for (const i of insts) {
      const g = prefixOfRef(i.ref)
      if (g !== group) {
        const n = insts.filter(x => prefixOfRef(x.ref) === g).length
        lines.push('', `    {/* ${g}: ${n} part${n === 1 ? '' : 's'} */}`)
        group = g
      }
      const [x, y, a] = i.fp.at!
      const rot = normAngle(i.fp.side === 'B' ? a + 180 : a)
      const props: Record<string, unknown> = {}
      if (!i.part) props.ref = i.ref
      const pr = !i.part ? partRules.get(i.ref) : undefined
      if (pr && Object.keys(pr).length) props.rules = pr
      props.at = rot ? `${fmt(x)} ${fmt(y)} ${fmt(rot)}deg` : `${fmt(x)} ${fmt(y)}`
      if (i.fp.side === 'B') props.side = 'B'
      const tm = thermalMap.get(i.fp)
      if (tm) props.thermal = tm
      if (!i.part && !i.fp.attrs.bom) props.bom = false
      if (!i.part && !i.fp.attrs.pos) props.pos = false
      if (!i.part && (i.fp.attrs.dnp || o.symbols?.get(i.fp.properties.Reference ?? i.ref)?.dnp)) { props.dnp = true; dnpRefs.add(i.ref) }
      const refAt = refAtOf(i.fp)
      if (refAt === false) { if (i.part) props.ref = false; else props.refAt = false }
      else if (refAt !== undefined) props.refAt = refAt
      lines.push(`    ${jsx({ type: i.part ? i.name : i.def.name, props })}`)
    }
    if (texts.length) {
      lines.push('', '    {/* text */}')
      for (const t of texts) {
        const c = textComments.get(t)
        if (c) lines.push(`    {/* ${c} */}`)
        lines.push(`    ${jsx(t)}`)
      }
    }
    lines.push('', '    {copper}')
    if (art.length) lines.push('    <Art />')
    lines.push('  </PCB>', ')')
    files.set(out, lines.join('\n') + '\n')
  }

  {
    const rules = rulesOf(board, pro, notes)
    const lines = ["import { defineConfig, defineDefaultRules } from '@pcbjs/core'", '', `// The design rules of ${src} and its .kicad_pro.`]
    const show = (r: { name: string; constraints: string[]; condition: string }) => {
      const cond = r.condition.length > 110 ? r.condition.slice(0, 107) + '...' : r.condition
      return `${r.name}: ${r.constraints.join(', ')}${cond ? `, when ${cond}` : ''}`
    }
    if (dru.mapped.length) {
      lines.push(`// KiCad's custom rules of the .kicad_dru carried as overrides, see the docs topic rules, Overrides:`)
      for (const m of dru.mapped) lines.push(`//   ${m.rule.name}: ${m.as}`)
      notes.push(`${dru.mapped.length} custom rule${dru.mapped.length === 1 ? '' : 's'} of the .kicad_dru carried: ${dru.mapped.map(m => `${m.rule.name} as ${m.as}`).join('; ')}`)
    }
    if (dru.unmapped.length) {
      lines.push(`// KiCad's custom rules of the .kicad_dru that are not carried, since no pcbjs override says the same; check their findings by hand.`)
      for (const r of dru.unmapped) lines.push(`//   ${show(r)}`)
      notes.push(`${dru.unmapped.length} custom rule${dru.unmapped.length === 1 ? '' : 's'} of the .kicad_dru not carried, listed in pcb.config.ts: ${dru.unmapped.map(r => r.name).join('; ')}`)
    }
    lines.push(`defineDefaultRules(${lit(rules)})`, '', 'export default defineConfig({', `  entries: [${str(o.entry ?? out)}],`, '})')
    files.set('pcb.config.ts', lines.join('\n') + '\n')
  }

  if (dnpRefs.size) notes.push(`${dnpRefs.size} part${dnpRefs.size === 1 ? ' is' : 's are'} DNP in KiCad, imported with dnp: true: ${[...dnpRefs].slice(0, 8).join(', ')}${dnpRefs.size > 8 ? ', …' : ''}`)
  const own = board.footprints.flatMap(f => f.pads.filter(p => !!p.clearance && p.kind !== 'np_thru_hole').map(p => p.num ? `${refOf.get(f)}.${p.num}` : `${refOf.get(f)} unnumbered pad`))
  if (own.length) notes.push(`${own.length} pads have their own clearance in KiCad, carried as the pads' clearance in their footprints: ${own.slice(0, 8).join(', ')}${own.length > 8 ? ', …' : ''}`)
  const fpOwn = board.footprints.filter(f => f.clearance !== undefined).map(f => refOf.get(f)!)
  if (fpOwn.length) notes.push(`${fpOwn.length} footprints have their own clearance in KiCad, carried as part rules: ${fpOwn.slice(0, 8).join(', ')}${fpOwn.length > 8 ? ', …' : ''}`)
  for (const [k, n] of Object.entries(board.skipped)) notes.push(`${n} ${k} item${n === 1 ? '' : 's'} not imported`)
  return { files, copies, counts, notes }
}

interface CopperOut { lines: string[]; parts: Set<string>; nets: Set<string>; usesVia: boolean; usesPour: boolean; usesKeepout: boolean; usesNeck: boolean; via?: { drill: number; size: number } }

function buildCopper(board: KBoard, insts: Inst[], netRef: (n: string | undefined) => string | undefined, copper: string[], notes: string[], counts: Record<string, number>): CopperOut {
  const res: CopperOut = { lines: [], parts: new Set(), nets: new Set(), usesVia: false, usesPour: false, usesKeepout: false, usesNeck: false }
  const useNet = (n: string | undefined) => { const r = netRef(n); if (r) res.nets.add(r); return r }

  let pours = 0, keepouts = 0
  const zoneLayers = (z: KZone) => [...new Set(z.layers.flatMap(l => l === '*.Cu' || l === 'F&B.Cu' ? copper : COPPER.test(l) ? [l] : []))]
  const zoneD = (z: KZone) => z.polygons.filter(p => p.length >= 3).map(polyPath).join(' ')
  const zoneLines: string[] = [], keepLines: string[] = []
  for (const z of board.zones) {
    const d = zoneD(z)
    if (!d) continue
    const layers = zoneLayers(z)
    if (z.keepout) {
      const k = z.keepout
      if (!(k.tracks || k.vias || k.pours)) continue
      const opts: Record<string, boolean> = {}
      if (!k.tracks) opts.tracks = false
      if (!k.vias) opts.vias = false
      if (!k.pours) opts.pours = false
      if (!layers.length) continue
      const ls = layers.length === copper.length ? "'all'" : layers.length === 1 ? str(layers[0]) : lit(layers)
      keepLines.push(`keepout(${ls}, ${str(d)}${Object.keys(opts).length ? `, ${lit(opts)}` : ''}),${z.name ? ` // ${z.name}` : ''}`)
      keepouts++
      res.usesKeepout = true
      continue
    }
    const opts: Record<string, unknown> = {}
    if (z.clearance !== undefined) opts.clearance = z.clearance
    if (z.priority) opts.priority = z.priority
    if (z.minThickness !== undefined) opts.minWidth = z.minThickness
    if (z.connect === 'yes') opts.connect = 'solid'
    else if (z.connect === 'no') opts.connect = 'none'
    if (z.connect === 'thru_hole_only') notes.push(`a ${z.net ?? 'no-net'} zone joins only through-hole pads in KiCad: imported with thermal reliefs on every pad`)
    for (const l of layers) {
      const n = useNet(z.net)
      if (n) zoneLines.push(`pour(${n}, ${str(l)}, ${str(d)}${Object.keys(opts).length ? `, ${lit(opts)}` : ''}),`)
      else zoneLines.push(`pour(${lit({ layer: l, d, ...opts })}),`)
      pours++
      res.usesPour = true
    }
  }
  counts.pours = pours
  counts.keepouts = keepouts
  if (zoneLines.length) res.lines.push('// pours', ...zoneLines, '')
  if (keepLines.length) res.lines.push('// keepouts', ...keepLines, '')

  // the most common via size is VIA
  const sizes = new Map<string, number>()
  for (const v of board.vias) { const k = `${nm(v.drill)}|${nm(v.size)}`; sizes.set(k, (sizes.get(k) ?? 0) + 1) }
  const common = [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (common) { const [drill, size] = common.split('|').map(Number); res.via = { drill, size } }
  const viaArg = (v: KVia) => res.via && nm(v.drill) === res.via.drill && nm(v.size) === res.via.size ? 'VIA' : lit({ drill: nm(v.drill), size: nm(v.size) })

  // pads by point, for chain ends
  const pkey = (p: Pt) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`
  const padAt = new Map<string, { inst: Inst; pin: string; layers: string[]; net?: string }[]>()
  for (const i of insts) {
    if (!i.part) continue
    for (const p of i.pads) {
      const k = pkey(p.at)
      if (!padAt.has(k)) padAt.set(k, [])
      padAt.get(k)!.push({ inst: i, pin: p.pin, layers: p.layers, net: p.net })
    }
  }
  const padEnd = (p: Pt, layer: string, net: string | undefined): string | null => {
    const hits = (padAt.get(pkey(p)) ?? []).filter(q => q.layers.includes(layer) && q.net === net)
    if (hits.length !== 1) return null
    const { inst, pin } = hits[0]
    // only a pin with one pad: a pin handle lands on that pad
    if (inst.pads.filter(q => q.pin === pin).length !== 1 || inst.pads.some(q => q.pin === pin && q.split)) return null
    res.parts.add(inst.name)
    return /^\d+$/.test(pin) && Number(pin) > 0 && String(Number(pin)) === pin ? `${inst.name}[${pin}]` : `${inst.name}.pin(${str(pin)})`
  }

  const viaAt = new Map<string, KVia[]>()
  for (const v of board.vias) { const k = pkey(v.at); if (!viaAt.has(k)) viaAt.set(k, []); viaAt.get(k)!.push(v) }
  const usedVias = new Set<KVia>()

  const byNet = new Map<string, KTrack[]>()
  for (const t of board.tracks) {
    if (!t.mid && Math.hypot(t.end[0] - t.start[0], t.end[1] - t.start[1]) < 1e-6) continue
    const k = t.net ?? ''
    if (!byNet.has(k)) byNet.set(k, [])
    byNet.get(k)!.push(t)
  }
  let chains = 0, segs = 0, arcs = 0
  const netOrder = [...byNet.keys()].sort(natural)
  for (const net of netOrder) {
    const tracks = byNet.get(net)!
    const lines: string[] = []
    const nid = useNet(net || undefined)
    const straight = tracks.filter(t => !t.mid)
    for (const t of tracks.filter(t => t.mid)) {
      const d = `M ${xy(t.start)} ${svgArcTo(t.start, t.mid!, t.end)}`
      lines.push(`route(${lit({ ...(nid ? { net: code(nid) } : {}), layer: t.layer, width: nm(t.width), d })}),`)
      arcs++
    }
    const at = new Map<string, number[]>()
    const nodeKey = (p: Pt, l: string) => `${pkey(p)}|${l}`
    straight.forEach((t, i) => { for (const p of [t.start, t.end]) { const k = nodeKey(p, t.layer); if (!at.has(k)) at.set(k, []); at.get(k)!.push(i) } })
    const used = new Set<number>()
    const viaHere = (p: Pt): KVia | undefined => (viaAt.get(pkey(p)) ?? []).find(v => (v.net ?? '') === net)
    const viaDegree = (p: Pt) => copper.reduce((s, l) => s + (at.get(nodeKey(p, l))?.length ?? 0), 0)
    const padHere = (p: Pt, l: string) => (padAt.get(pkey(p)) ?? []).some(q => q.layers.includes(l) && (q.net ?? '') === net)
    const isEnd = (p: Pt, l: string) => {
      if (padHere(p, l)) return true
      const v = viaHere(p)
      if (v) return viaDegree(p) !== 2 || v.kind !== 'through'
      return (at.get(nodeKey(p, l))?.length ?? 0) !== 2
    }
    const walk = (startIdx: number, from: Pt) => {
      const seq: { p: Pt; layer: string; via?: KVia }[] = []
      let cur = startIdx, p = from, width = straight[startIdx].width
      seq.push({ p, layer: straight[cur].layer })
      for (;;) {
        used.add(cur)
        const t = straight[cur]
        const q = same(t.start, p) ? t.end : t.start
        seq.push({ p: q, layer: t.layer })
        p = q
        if (isEnd(p, t.layer)) break
        const v = viaHere(p)
        let next: number | undefined
        if (v) {
          for (const l of copper) for (const j of at.get(nodeKey(p, l)) ?? []) if (j !== cur && !used.has(j)) next = j
        } else next = (at.get(nodeKey(p, t.layer)) ?? []).find(j => j !== cur && !used.has(j))
        if (next === undefined || straight[next].width !== width) break
        // a via the chain changes layer at is the chain's own; one it passes on one layer stays separate
        if (v && straight[next].layer !== t.layer) { seq[seq.length - 1].via = v; usedVias.add(v) }
        cur = next
        width = straight[next].width
      }
      return { seq, width }
    }
    const emit = (seq: { p: Pt; layer: string; via?: KVia }[], width: number) => {
      const first = seq[0], last = seq[seq.length - 1]
      const a = padEnd(first.p, first.layer, net || undefined)
      const b = padEnd(last.p, last.layer, net || undefined)
      let s = `route(${a ?? str(xy(first.p))})`
      if (first.layer !== 'F.Cu') s += `.layer(${str(first.layer)})`
      s += `.width(${fmt(width)}).neck(AS_DRAWN)`
      res.usesNeck = true
      const vias = seq.filter(q => q.via)
      if (vias.length) {
        const arg = viaArg(vias[0].via!)
        if (vias.every(q => viaArg(q.via!) === arg)) s += `.vias(${arg})`
      }
      if (!a && !b && nid) s += `.net(${nid})`
      for (let k = 1; k < seq.length; k++) {
        const q = seq[k]
        if (k === seq.length - 1) s += `.Z(${b ?? str(xy(q.p))})`
        else {
          s += `.Z(${str(xy(q.p))})`
          if (q.via) {
            const nextLayer = seq[k + 1].layer
            if (nextLayer !== q.layer) s += `.via(${str(nextLayer)})`
          }
        }
        segs++
      }
      lines.push(s + ',')
      chains++
    }
    // ends first, then what is left, loops included
    for (let i = 0; i < straight.length; i++) {
      if (used.has(i)) continue
      for (const p of [straight[i].start, straight[i].end]) {
        if (used.has(i)) break
        if (isEnd(p, straight[i].layer)) { const w = walk(i, p); emit(w.seq, w.width) }
      }
    }
    for (let i = 0; i < straight.length; i++) if (!used.has(i)) { const w = walk(i, straight[i].start); emit(w.seq, w.width) }
    if (lines.length) res.lines.push(`// ${net || 'no net'}`, ...lines)
  }
  // a via between chains of different widths joins them only through copper: place it on its own
  const loose = board.vias.filter(v => !usedVias.has(v))
  if (loose.length) {
    res.usesVia = true
    res.lines.push('', '// vias')
    for (const v of loose) {
      const n = useNet(v.net)
      const extra = v.kind !== 'through' || v.layers[0] !== 'F.Cu' || v.layers[1] !== 'B.Cu'
      const arg = extra ? lit({ drill: nm(v.drill), size: nm(v.size), layers: v.layers }) : viaArg(v)
      res.lines.push(n ? `via(${n}, ${str(xy(v.at))}, ${arg}),` : `via(${lit({ at: xy(v.at), drill: nm(v.drill), size: nm(v.size) })}),`)
    }
  }
  counts.chains = chains
  counts.segments = segs
  counts.arcs = arcs
  counts.vias = board.vias.length
  if (res.lines[res.lines.length - 1] === '') res.lines.pop()
  return res
}

const chunk = <T>(xs: T[], n: number): T[][] => { const out: T[][] = []; for (let k = 0; k < xs.length; k += n) out.push(xs.slice(k, k + n)); return out }

const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4

const FINISH: Record<string, string> = { 'ENIG': 'ENIG', 'ENEPIG': 'ENIG', 'HAL SnPb': 'HASL', 'HAL lead-free': 'LeadFreeHASL', 'Immersion silver': 'ImmersionSilver', 'Immersion tin': 'ImmersionTin', 'OSP': 'OSP', 'Hard gold': 'HardGold', 'Immersion gold': 'ENIG' }

function stackupOf(board: KBoard, notes: string[]): Record<string, unknown> | null {
  if (!board.stackup.length) return null
  const layers: Record<string, unknown>[] = []
  let maskColor: string | undefined, silkColor: string | undefined
  for (const s of board.stackup) {
    const t = s.type.toLowerCase()
    if (t === 'copper') layers.push({ type: 'copper', name: s.name, thickness: s.thickness ?? 0.035 })
    else if (t === 'core' || t === 'prepreg') {
      const l: Record<string, unknown> = { type: t, thickness: s.thickness ?? 0.1 }
      if (s.material) l.material = s.material
      if (s.er !== undefined) l.er = s.er
      if (s.lossTangent !== undefined) l.lossTangent = s.lossTangent
      layers.push(l)
    } else if (/solder mask/.test(t)) {
      const l: Record<string, unknown> = { type: 'mask', side: s.name.startsWith('B.') ? 'B' : 'F' }
      if (s.thickness) l.thickness = s.thickness
      if (s.color) l.color = s.color
      maskColor ??= s.color
      layers.push(l)
    } else if (/silk screen/.test(t)) {
      const l: Record<string, unknown> = { type: 'silk', side: s.name.startsWith('B.') ? 'B' : 'F' }
      if (s.color) l.color = s.color
      silkColor ??= s.color
      layers.push(l)
    } else if (/solder paste/.test(t)) layers.push({ type: 'paste', side: s.name.startsWith('B.') ? 'B' : 'F' })
  }
  const out: Record<string, unknown> = { layers }
  if (board.finish && board.finish !== 'None') {
    const f = FINISH[board.finish]
    if (f) out.finish = f
    else notes.push(`copper finish ${JSON.stringify(board.finish)} has no pcbjs name: left out of the stackup`)
  }
  if (maskColor) out.maskColor = maskColor
  if (silkColor) out.silkColor = silkColor
  const sum = layers.reduce((s, l) => s + (typeof l.thickness === 'number' ? l.thickness : 0), 0)
  if (board.thickness && Math.abs(sum - board.thickness) > 0.005 && Math.abs(sum - board.thickness) <= 0.1 * board.thickness) out.thickness = board.thickness
  return out
}

function rulesOf(board: KBoard, pro: KProject | null, notes: string[]): Record<string, unknown> {
  const r = pro?.rules ?? {}
  const def = pro?.classes.find(c => c.name === 'Default')
  const out: Record<string, unknown> = {}
  const set = (k: string, v: number | undefined) => { if (v !== undefined && Number.isFinite(v)) out[k] = nm(v) }
  set('clearance', Math.max(r.min_clearance ?? 0, def?.clearance ?? 0) || undefined)
  set('minTrackWidth', r.min_track_width)
  set('edgeClearance', r.min_copper_edge_clearance)
  set('holeClearance', r.min_hole_clearance)
  set('minViaDrill', r.min_through_hole_diameter)
  set('minDrill', r.min_through_hole_diameter)
  set('minViaDiameter', r.min_via_diameter)
  set('minAnnularRing', r.min_via_annular_width)
  // KiCad's annular width check covers plated pads as well as vias
  set('minPadAnnularRing', r.min_via_annular_width)
  set('minHoleToHole', r.min_hole_to_hole)
  // KiCad checks the thickness of silk text only; pcbjs checks every silk stroke, so its minimum is also the thinnest silk line drawn
  const silk = [...board.graphics, ...board.footprints.flatMap(f => f.graphics)].filter(g => /SilkS$/.test(g.layer) && g.width > 0 && !g.fill).map(g => g.width)
  const thinnest = silk.length ? Math.min(...silk) : undefined
  const silkMin = Math.min(r.min_text_thickness ?? Infinity, thinnest ?? Infinity)
  if (Number.isFinite(silkMin)) set('silkMinWidth', silkMin)
  set('maskExpansion', board.padToMask ?? 0)
  if (board.padToPaste !== undefined && board.padToPaste < 0) set('pasteShrink', -board.padToPaste)
  else set('pasteShrink', 0)
  // the zones' most common thermal relief
  const tz = board.zones.filter(z => !z.keepout && z.thermalGap !== undefined)
  if (!tz.length && r.min_resolved_spokes !== undefined) out.thermal = { minSpokes: r.min_resolved_spokes }
  if (tz.length) {
    const count = new Map<string, number>()
    for (const z of tz) { const k = `${z.thermalGap}|${z.thermalWidth ?? 0.5}`; count.set(k, (count.get(k) ?? 0) + 1) }
    const [best] = [...count].sort((a, b) => b[1] - a[1])
    const [gap, spokeWidth] = best[0].split('|').map(Number)
    out.thermal = { gap, spokeWidth, ...(r.min_resolved_spokes !== undefined ? { minSpokes: r.min_resolved_spokes } : {}) }
    if (count.size > 1) notes.push(`zones use ${count.size} thermal relief settings: the rules take gap ${gap} and spoke width ${spokeWidth}, the most common`)
  }
  if (!pro) notes.push('no .kicad_pro beside the board: the rules come from the board setup alone')
  return out
}

function classTable(pro: KProject | null, classOf: Map<string, string>, dru?: DruMapping): Record<string, unknown> | null {
  const used = new Set(classOf.values())
  const out: Record<string, unknown> = {}
  for (const c of pro?.classes ?? []) {
    if (!used.has(c.name)) continue
    const e: Record<string, unknown> = {}
    if (c.trackWidth) e.width = c.trackWidth
    if (c.clearance) e.clearance = c.clearance
    const over = dru?.classes.get(c.name)
    // kinds the override leaves out keep the class's own clearance
    if (typeof over === 'number') e.clearance = over
    else if (over) {
      const base = typeof e.clearance === 'number' ? e.clearance : 0, k: Record<string, number | PadTypeMM> = {}
      for (const kind of ['track', 'via', 'zone', 'text'] as const) { const v = Math.max(base, over[kind] ?? 0); if (v) k[kind] = v }
      const pad = base ? maxPad(base, over.pad) : over.pad
      if (pad) k.pad = typeof pad === 'object' && pad.tht === pad.smd && pad.tht !== undefined ? pad.tht : pad
      e.clearance = k
    }
    if (c.viaDrill && c.viaDiameter) e.via = { drill: c.viaDrill, size: c.viaDiameter }
    if (c.diffPairGap) e.gap = c.diffPairGap
    out[c.name] = e
  }
  for (const g of dru?.netGroups ?? []) out[g.name] = { clearance: g.clearance }
  return Object.keys(out).length ? out : null
}

export { existsSync, join }
