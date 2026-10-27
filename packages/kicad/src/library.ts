import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { anchorModel, h } from '@pcbjs/core/jsx-runtime'
import { callerSite, defineFootprint, SchematicError } from '@pcbjs/core/schematic'
import type { FootprintFactory, FootprintProps, ModelSpec, PcbNode } from '@pcbjs/core/types'
import { footprintSpecs, KICAD_SILK_MODES, padPins, readKicadMod, type ElementSpec, type KFootprint, type KicadSilkMode, type KModel } from './footprint.js'

const REGISTRY = Symbol.for('pcbjs.kicad.config')

/** The `kicad` section of pcb.config.ts. */
export interface KicadConfig {
  /** folders of footprints: a `.pretty` folder, or a folder holding `.pretty` folders; relative to the project root */
  footprints?: string[]
  /** the folder KiCad's model variables point to, default the installed 3dmodels folder */
  models?: string
}

/** Called by the cli for every project it loads. */
export function setKicadConfig(root: string, config: KicadConfig | undefined): void {
  ;(globalThis as any)[REGISTRY] = { root, config: config ?? {} }
}
function registered(): { root: string; config: KicadConfig } {
  return (globalThis as any)[REGISTRY] ?? { root: process.cwd(), config: {} }
}

/** The installed KiCad share folders, newest version first. */
export function kicadShareDirs(): string[] {
  const out: string[] = []
  const add = (d: string) => { if (existsSync(d) && !out.includes(d)) out.push(d) }
  add('/Applications/KiCad/KiCad.app/Contents/SharedSupport')
  add('/usr/share/kicad')
  add('/usr/local/share/kicad')
  add('/opt/homebrew/share/kicad')
  const pf = process.env.ProgramFiles
  if (pf && existsSync(join(pf, 'KiCad'))) {
    const vers = readdirSync(join(pf, 'KiCad')).sort((a, b) => parseFloat(b) - parseFloat(a))
    for (const v of vers) add(join(pf, 'KiCad', v, 'share', 'kicad'))
  }
  return out
}

const FOOTPRINT_VARS = ['KICAD10_FOOTPRINT_DIR', 'KICAD9_FOOTPRINT_DIR', 'KICAD8_FOOTPRINT_DIR', 'KICAD7_FOOTPRINT_DIR', 'KICAD6_FOOTPRINT_DIR']
const MODEL_VARS = ['KICAD10_3DMODEL_DIR', 'KICAD9_3DMODEL_DIR', 'KICAD8_3DMODEL_DIR', 'KICAD7_3DMODEL_DIR', 'KICAD6_3DMODEL_DIR', 'KISYS3DMOD']

export function installedFootprints(): string | null {
  for (const v of FOOTPRINT_VARS) if (process.env[v] && existsSync(process.env[v]!)) return process.env[v]!
  for (const d of kicadShareDirs()) if (existsSync(join(d, 'footprints'))) return join(d, 'footprints')
  return null
}
export function installedModels(): string | null {
  const cfg = registered().config.models
  if (cfg) return resolve(registered().root, cfg)
  for (const v of MODEL_VARS) if (process.env[v] && existsSync(process.env[v]!)) return process.env[v]!
  for (const d of kicadShareDirs()) if (existsSync(join(d, '3dmodels'))) return join(d, '3dmodels')
  return null
}

const splitList = (s: string | undefined) => (s ?? '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean)

/** The library roots in search order: the project, pcb.config.ts, KICAD_FOOTPRINTS, the installed library. */
export function footprintRoots(o: { root?: string; footprints?: string[] } = {}): string[] {
  const reg = registered()
  const root = o.root ?? reg.root
  const out: string[] = []
  const add = (d: string) => { const a = resolve(root, d); if (existsSync(a) && !out.includes(a)) out.push(a) }
  for (const d of ['.', 'lib', 'footprints', 'lib/footprints']) {
    const dir = resolve(root, d)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) if (f.endsWith('.pretty')) add(join(dir, f))
  }
  for (const d of o.footprints ?? reg.config.footprints ?? []) add(d)
  for (const d of splitList(process.env.KICAD_FOOTPRINTS)) add(d)
  const installed = installedFootprints()
  if (installed) add(installed)
  return out
}

function prettyDirs(root: string): string[] {
  if (root.endsWith('.pretty')) return [root]
  try { return readdirSync(root).filter(f => f.endsWith('.pretty')).map(f => join(root, f)) } catch { return [] }
}

/** The `.kicad_mod` file of a `Lib:Name`, a bare `Name` searched in every library, or a path. */
export function findFootprint(ref: string, o: { root?: string; footprints?: string[] } = {}): string | null {
  if (ref.endsWith('.kicad_mod')) { const f = resolve(o.root ?? registered().root, ref); return existsSync(f) ? f : null }
  const colon = ref.indexOf(':')
  const lib = colon >= 0 ? ref.slice(0, colon) : null, name = colon >= 0 ? ref.slice(colon + 1) : ref
  for (const r of footprintRoots(o)) {
    for (const p of prettyDirs(r)) {
      if (lib !== null && !p.endsWith(`/${lib}.pretty`) && !p.endsWith(`\\${lib}.pretty`)) continue
      const f = join(p, `${name}.kicad_mod`)
      if (existsSync(f)) return f
    }
  }
  return null
}

/** The library nickname of a footprint file's folder. */
export function libraryOf(file: string): string | null {
  const m = /([^/\\]+)\.pretty[/\\][^/\\]+\.kicad_mod$/.exec(file)
  return m ? m[1] : null
}

export function isInstalled(file: string): boolean {
  const installed = installedFootprints()
  return !!installed && resolve(file).startsWith(resolve(installed) + (process.platform === 'win32' ? '\\' : '/'))
}

/** A KiCad model path with its variables resolved; a missing `.wrl` falls back to the `.step` beside it and the other way round. */
export function kicadModel(path: string, projectDir?: string): string {
  let out = path.replace(/\$\{([A-Za-z0-9_]+)\}|\$\(([A-Za-z0-9_]+)\)/g, (m, a, b) => {
    const v = a ?? b
    if (MODEL_VARS.includes(v)) return process.env[v] && existsSync(process.env[v]!) ? process.env[v]! : installedModels() ?? m
    if (v === 'KIPRJMOD') return projectDir ?? registered().root
    return process.env[v] ?? m
  })
  if (!existsSync(out)) {
    for (const [a, b] of [[/\.wrl$/i, '.step'], [/\.step$/i, '.wrl'], [/\.stp$/i, '.step']] as const) {
      const alt = out.replace(a, b)
      if (alt !== out && existsSync(alt)) { out = alt; break }
    }
  }
  return out
}

/** A ${KIPRJMOD} or relative model path made relative to `fromDir`; null for a library model or a missing file. */
export function projectModelPath(path: string, kicadProject: string, fromDir: string): string | null {
  if (/\$\{(?!KIPRJMOD\})[A-Za-z0-9_]+\}/.test(path)) return null
  const abs = kicadModel(/^\$\{KIPRJMOD\}/.test(path) || isAbsolute(path) ? path : join('${KIPRJMOD}', path), kicadProject)
  if (!existsSync(abs)) return null
  const rel = relative(fromDir, abs).split('\\').join('/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

/** The first shown model of a footprint; `${KIPRJMOD}` and relative paths are under `projectDir`, never the library folder. */
export function modelSpec(fp: KFootprint, projectDir?: string): ModelSpec | undefined {
  const m: KModel | undefined = fp.models.find(x => !x.hidden && x.path)
  if (!m) return undefined
  const file = kicadModel(m.path, projectDir)
  const spec: Record<string, unknown> = { file: isAbsolute(file) || /^\$\{/.test(file) ? file : resolve(projectDir ?? registered().root, file) }
  if (m.offset.some(v => v !== 0)) spec.offset = m.offset
  if (m.scale.some(v => v !== 1)) spec.scale = m.scale
  if (m.rotate.some(v => v !== 0)) spec.rotate = m.rotate
  return spec as ModelSpec
}

const PREFIX: [RegExp, string][] = [
  [/^(R|Resistor)[_-]|^R_Array|Resistor/i, 'R'], [/^(C|CP|Capacitor)[_-]|Capacitor/i, 'C'], [/^(L|Inductor)[_-]|Inductor/i, 'L'],
  [/^LED|^D_|Diode/i, 'D'], [/Crystal|Oscillator|^Resonator/i, 'Y'], [/^Fuse/i, 'F'], [/^(SW|Button|Switch)/i, 'SW'],
  [/MountingHole|^Hole/i, 'H'], [/Fiducial/i, 'FID'], [/TestPoint|^TP/i, 'TP'], [/Jumper|SolderJumper/i, 'JP'],
  [/^(Connector|Conn|USB|PinHeader|PinSocket|JST|Molex|IDC|Terminal|BarrelJack|FFC|FPC|Header)/i, 'J'],
  [/^(Transistor|Package_TO_SOT|SOT-23$|SOT-323$|TO-)/i, 'Q'], [/^Relay/i, 'K'], [/^Buzzer|^Speaker/i, 'LS'], [/^Battery/i, 'BT'],
]

export function prefixOf(lib: string | undefined, name: string): string {
  for (const [re, p] of PREFIX) if (re.test(name)) return p
  for (const [re, p] of PREFIX) if (lib && re.test(lib)) return p
  return 'U'
}

/** A list renames the pins in pad order, a record maps a pad number to a name; pads named NC are no pin. */
export type KicadPinNames = readonly string[] | Readonly<Record<string, string>>

export interface KicadFootprintOptions {
  /** rename the pins, `['VIN', 'GND', 'EN', 'NC', 'VOUT']` or `{ 1: 'VIN', EP: 'GND' }` */
  pinNames?: KicadPinNames
  prefix?: string
  /** default the footprint name */
  value?: string
  /** the 3D model, over the one the footprint names; false for none */
  model?: ModelSpec | false
  /** extra library roots, searched first */
  footprints?: string[]
  /** 'full' and 'open' as drawn, 'none' without any; default 'full' */
  silk?: KicadSilkMode
}

export function specNodes(specs: ElementSpec[], names?: Map<string, string>): PcbNode[] {
  return specs.map(s => {
    const props = { ...s.props }
    if (s.type === 'pad' && names?.has(String(props.num))) props.name = names.get(String(props.num))
    return h(s.type, props, ...(s.children ?? []))
  })
}

export function renamePins(name: string, pins: string[], pinNames: KicadPinNames | undefined): { names: Map<string, string>; pins: string[]; nc: string[] } {
  const names = new Map<string, string>()
  if (pinNames !== undefined) {
    if (pinNames === null || typeof pinNames !== 'object') throw new TypeError(`${name}: pinNames must be a list of names in pad order or an object keyed by pad number, got ${JSON.stringify(pinNames)}`)
    if (Array.isArray(pinNames)) {
      if (pinNames.length > pins.length) throw new SchematicError(`${name}: ${pinNames.length} pin names for ${pins.length} pads`)
      pinNames.forEach((n, i) => { if (n) names.set(pins[i], String(n)) })
    } else for (const [k, v] of Object.entries(pinNames)) {
      if (!pins.includes(k)) throw new SchematicError(`${name}: pinNames names pad ${JSON.stringify(k)}, which it does not have; its pads are ${pins.join(', ')}`)
      names.set(k, String(v))
    }
  }
  const out: string[] = []
  const nc: string[] = []
  for (const p of pins) {
    const n = names.get(p) ?? p
    if (n === 'NC') nc.push(p)
    else if (!out.includes(n)) out.push(n)
  }
  return { names, pins: out, nc }
}

/** A footprint factory from a read footprint; its pins are the pad numbers in pad order, renamed by `pinNames`. */
export function footprintFactory(fp: KFootprint, o: KicadFootprintOptions = {}): FootprintFactory<string, FootprintProps> {
  if (o.silk !== undefined && !KICAD_SILK_MODES.includes(o.silk)) throw new TypeError(`${fp.name}: silk must be ${KICAD_SILK_MODES.map(m => `'${m}'`).join(', ')}, got ${JSON.stringify(o.silk)}`)
  // without its silk it is another footprint, as KiCad's NoSilkScreen variants are
  const id = `${fp.lib ?? libraryOf(fp.file ?? '') ?? 'kicad'}:${fp.name}${o.silk === 'none' ? '_NoSilkScreen' : ''}`
  const { names, pins, nc } = renamePins(fp.name, padPins(fp), o.pinNames)
  const kids = specNodes(footprintSpecs(fp, ['F.Cu', 'B.Cu'], { silk: o.silk }), names)
  const model = o.model === false ? undefined : o.model ?? modelSpec(fp)
  const base: Record<string, unknown> = { id, value: o.value ?? fp.name }
  if (model) base.model = model
  if (!fp.attrs.bom) base.bom = false
  if (!fp.attrs.pos) base.pos = false
  if (fp.descr) base.description = fp.descr
  if (fp.netTie) base.netTie = fp.netTie
  const render = function KicadFootprint(props: FootprintProps): PcbNode {
    const { children: more, ...rest } = props
    return h('footprint', { ...base, ...rest }, ...kids, more)
  }
  Object.defineProperty(render, 'name', { value: fp.name })
  return defineFootprint<string, FootprintProps>(render, { pins, nc, prefix: o.prefix ?? prefixOf(fp.lib, fp.name), id, name: fp.name, ...(fp.netTie ? { netTie: fp.netTie } : {}) })
}

const CACHE = Symbol.for('pcbjs.kicad.cache')
function cache(): Map<string, { hash: string; fp: KFootprint }> {
  return ((globalThis as any)[CACHE] ??= new Map())
}

/** Read a `.kicad_mod` through a cache keyed by path and content. */
export function loadFootprint(file: string): KFootprint {
  const text = readFileSync(file, 'utf8')
  const hash = createHash('sha1').update(text).digest('hex')
  const hit = cache().get(file)
  if (hit && hit.hash === hash) return hit.fp
  const fp = readKicadMod(text)
  fp.file = file
  if (!fp.lib) { const lib = libraryOf(file); if (lib) fp.lib = lib }
  cache().set(file, { hash, fp })
  return fp
}

/** A KiCad library footprint as a factory: `kicadFootprint('Package_SO:SOIC-8_3.9x4.9mm_P1.27mm')`. */
export function kicadFootprint(ref: string, o: KicadFootprintOptions = {}): FootprintFactory<string, FootprintProps> {
  if (typeof ref !== 'string' || !ref) throw new TypeError(`kicadFootprint needs a footprint such as 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm', got ${JSON.stringify(ref)}`)
  const file = findFootprint(ref, { footprints: o.footprints ? [...o.footprints, ...(registered().config.footprints ?? [])] : undefined })
  if (!file) {
    const roots = footprintRoots()
    throw new SchematicError(`kicadFootprint: no footprint ${JSON.stringify(ref)} in ${roots.length ? roots.join(', ') : 'any library: install KiCad, set KICAD_FOOTPRINTS or list folders in kicad.footprints of pcb.config.ts'}`)
  }
  let fp = loadFootprint(file)
  const colon = ref.indexOf(':')
  if (colon >= 0 && !fp.lib) fp = { ...fp, lib: ref.slice(0, colon) }
  // a relative model file is relative to the caller, as every model literal is
  const model = o.model ? anchorModel(o.model, callerSite(true)?.file) : o.model
  return footprintFactory(fp, model === o.model ? o : { ...o, model })
}

export const isDir = (p: string): boolean => { try { return statSync(p).isDirectory() } catch { return false } }
