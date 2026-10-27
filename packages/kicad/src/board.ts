import { existsSync, readFileSync } from 'node:fs'
import { atom, atoms, child, children, flag, head, isList, num, nums, parseSExpr, type SList } from './sexpr.js'
import { fontFace, readFootprintList, readGraphic, readZone, type KFootprint, type KGraphic, type KText, type KZone } from './footprint.js'
import type { Pt } from './geom.js'

export interface KTrack { start: Pt; end: Pt; mid?: Pt; width: number; layer: string; net?: string; locked: boolean }
export interface KVia { at: Pt; size: number; drill: number; layers: [string, string]; net?: string; kind: 'through' | 'blind' | 'micro' }
export interface KStackupLayer { name: string; type: string; thickness?: number; material?: string; er?: number; lossTangent?: number; color?: string }

export interface KBoard {
  version: number
  /** copper layers in KiCad's order, F.Cu first, B.Cu last */
  copper: string[]
  thickness?: number
  stackup: KStackupLayer[]
  finish?: string
  padToMask?: number
  padToPaste?: number
  footprints: KFootprint[]
  graphics: KGraphic[]
  texts: KText[]
  tracks: KTrack[]
  vias: KVia[]
  zones: KZone[]
  /** items the importer does not carry, by kind */
  skipped: Record<string, number>
  title?: string
  revision?: string
}

const pt = (l: SList | undefined): Pt => [num(l, 1, 0), num(l, 2, 0)]

function readBoardText(l: SList): KText {
  const at = nums(l, 'at')
  const effects = child(l, 'effects')
  const font = child(effects, 'font')
  const size = nums(font, 'size')
  return {
    kind: 'user', text: atom(l, 1) ?? '', at: [at[0] ?? 0, at[1] ?? 0], rot: at[2] ?? 0, layer: atom(child(l, 'layer')) ?? '',
    size: [size[0] ?? 1, size[1] ?? size[0] ?? 1], thickness: num(child(font, 'thickness'), 1, 0.15), hidden: flag(l, 'hide') || flag(effects, 'hide'),
    justify: atoms(child(effects, 'justify')), ...fontFace(font),
  }
}

/** Read a `.kicad_pcb`, its text or a path. */
export function readKicadPcb(source: string): KBoard {
  const text = source.trimStart().startsWith('(') ? source : readFileSync(source, 'utf8')
  const l = parseSExpr(text)
  if (head(l) !== 'kicad_pcb') throw new Error(`not a KiCad board: it starts with (${head(l)} …)`)
  const netNames = new Map<string, string>()
  for (const n of children(l, 'net')) netNames.set(atom(n, 1) ?? '', atom(n, 2) ?? '')
  const netOf = (e: SList): string | undefined => {
    const n = child(e, 'net')
    if (!n) return undefined
    const a = atom(n, 1) ?? '', b = atom(n, 2)
    // KiCad 10 writes the name, older versions the number with the name in the table
    const name = b !== undefined ? b : netNames.has(a) && /^\d+$/.test(a) ? netNames.get(a)! : a
    return name || undefined
  }
  const b: KBoard = { version: num(child(l, 'version')), copper: [], stackup: [], footprints: [], graphics: [], texts: [], tracks: [], vias: [], zones: [], skipped: {} }
  const skip = (k: string) => { b.skipped[k] = (b.skipped[k] ?? 0) + 1 }
  const cu: { ord: number; name: string }[] = []
  for (const e of child(l, 'layers') ?? []) {
    if (!isList(e)) continue
    const name = atom(e, 1) ?? ''
    if (/\.Cu$/.test(name)) cu.push({ ord: num(e, 0), name })
  }
  b.copper = ['F.Cu', ...cu.map(c => c.name).filter(n => /^In\d+\.Cu$/.test(n)).sort((p, q) => parseInt(p.slice(2)) - parseInt(q.slice(2))), 'B.Cu']
  const gen = child(l, 'general')
  const th = child(gen, 'thickness'); if (th) b.thickness = num(th)
  const tb = child(l, 'title_block')
  if (tb) { const t = atom(child(tb, 'title')); if (t) b.title = t; const r = atom(child(tb, 'rev')); if (r) b.revision = r }
  const setup = child(l, 'setup')
  const stackup = child(setup, 'stackup')
  for (const ly of children(stackup, 'layer')) {
    const s: KStackupLayer = { name: atom(ly, 1) ?? '', type: atom(child(ly, 'type')) ?? '' }
    const t = child(ly, 'thickness'); if (t) s.thickness = num(t)
    const m = atom(child(ly, 'material')); if (m) s.material = m
    const er = child(ly, 'epsilon_r'); if (er) s.er = num(er)
    const lt = child(ly, 'loss_tangent'); if (lt) s.lossTangent = num(lt)
    const c = atom(child(ly, 'color')); if (c) s.color = c
    b.stackup.push(s)
  }
  const fin = atom(child(stackup, 'copper_finish')); if (fin) b.finish = fin
  const pm = child(setup, 'pad_to_mask_clearance'); if (pm) b.padToMask = num(pm)
  const pp = child(setup, 'pad_to_paste_clearance'); if (pp) b.padToPaste = num(pp)
  for (const e of l) {
    if (!isList(e)) continue
    const k = String(e[0])
    switch (k) {
      case 'footprint': case 'module': {
        const fp = readFootprintList(e, { board: true })
        // the pads' nets of a board read in the old format are numbers
        for (const p of fp.pads) if (p.net && netNames.has(p.net) && /^\d+$/.test(p.net)) p.net = netNames.get(p.net) || undefined
        b.footprints.push(fp)
        break
      }
      case 'gr_line': case 'gr_arc': case 'gr_circle': case 'gr_rect': case 'gr_poly': case 'gr_curve': {
        const g = readGraphic(e)
        if (g) b.graphics.push(g)
        break
      }
      case 'gr_text': b.texts.push(readBoardText(e)); break
      case 'segment': case 'arc': {
        const t: KTrack = { start: pt(child(e, 'start')), end: pt(child(e, 'end')), width: num(child(e, 'width'), 1, 0.25), layer: atom(child(e, 'layer')) ?? 'F.Cu', net: netOf(e), locked: flag(e, 'locked') }
        if (k === 'arc') t.mid = pt(child(e, 'mid'))
        b.tracks.push(t)
        break
      }
      case 'via': {
        const ls = atoms(child(e, 'layers'))
        const kind = e.includes('micro') ? 'micro' : e.includes('blind') || e.includes('buried') ? 'blind' : 'through'
        b.vias.push({ at: pt(child(e, 'at')), size: num(child(e, 'size'), 1, 0.6), drill: num(child(e, 'drill'), 1, 0.3), layers: [ls[0] ?? 'F.Cu', ls[1] ?? 'B.Cu'], net: netOf(e), kind })
        break
      }
      case 'zone': {
        const z = readZone(e)
        if (z.net && netNames.has(z.net) && /^\d+$/.test(z.net)) z.net = netNames.get(z.net) || undefined
        b.zones.push(z)
        break
      }
      case 'dimension': case 'gr_text_box': case 'image': case 'target': case 'table': case 'gr_bbox': case 'generated': case 'group': skip(k); break
    }
  }
  return b
}

export interface KProject {
  rules: Record<string, number>
  classes: { name: string; clearance?: number; trackWidth?: number; viaDiameter?: number; viaDrill?: number; diffPairWidth?: number; diffPairGap?: number }[]
  /** net class patterns, glob on net names */
  patterns: { netclass: string; pattern: string }[]
  /** explicit net to class assignments */
  assignments: Record<string, string>
}

export function readKicadPro(file: string): KProject | null {
  if (!existsSync(file)) return null
  let d: any
  try { d = JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
  const rules: Record<string, number> = {}
  for (const [k, v] of Object.entries(d?.board?.design_settings?.rules ?? {})) if (typeof v === 'number') rules[k] = v
  const ns = d?.net_settings ?? {}
  const classes = (ns.classes ?? []).map((c: any) => ({
    name: String(c.name), clearance: c.clearance, trackWidth: c.track_width, viaDiameter: c.via_diameter, viaDrill: c.via_drill, diffPairWidth: c.diff_pair_width, diffPairGap: c.diff_pair_gap,
  }))
  const patterns = (ns.netclass_patterns ?? []).map((p: any) => ({ netclass: String(p.netclass), pattern: String(p.pattern) }))
  const assignments: Record<string, string> = {}
  for (const [k, v] of Object.entries(ns.netclass_assignments ?? {})) assignments[k] = Array.isArray(v) ? String(v[0]) : String(v)
  return { rules, classes, patterns, assignments }
}

export interface KCustomRule { name: string; constraints: string[]; condition: string }

export function readKicadDru(file: string): KCustomRule[] {
  if (!existsSync(file)) return []
  const text = readFileSync(file, 'utf8').split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
  let l: SList
  try { l = parseSExpr(`(dru ${text})`) } catch { return [] }
  const show = (e: SList): string => e.map(x => (isList(x) ? `(${show(x)})` : x)).join(' ')
  return children(l, 'rule').map(r => ({
    name: atom(r, 1) ?? '',
    constraints: children(r, 'constraint').map(c => show(c.slice(1) as SList)),
    condition: atom(child(r, 'condition')) ?? '',
  }))
}
