import { env, exists, isAbsolute, isDir, join, readDir, readText, relative, resolve, sha1, windows } from './host.js'
import { keepout } from '@pcbjs/core'
import { anchorModel, h } from '@pcbjs/core/jsx-runtime'
import { defineFootprint } from '@pcbjs/core/internal/footprint'
import { SchematicError } from '@pcbjs/core/internal/nets'
import { callerSite } from '@pcbjs/core/internal/provenance'
import { realm } from '@pcbjs/core/internal/realm'
import type { FootprintFactory, FootprintProps, ModelSpec, PcbNode } from '@pcbjs/core/internal/types'
import { footprintSpecs, KICAD_SILK_MODES, padPins, readKicadMod, type ElementSpec, type KFootprint, type KicadSilkMode, type KModel } from './footprint.js'

/** The `kicad` section of pcb.config.ts. */
export interface KicadConfig {
  /** folders of footprints: a `.pretty` folder, or a folder holding `.pretty` folders; relative to the project root */
  footprints?: string[]
  /** the folder KiCad's model variables point to, default the installed 3dmodels folder */
  models?: string
}

/** Called by the cli for every project it loads. */
export function setKicadConfig(root: string, config: KicadConfig | undefined): void {
  realm().kicad = { root, config: config ?? {} }
}
/** No project before the cli registers one: only the installed libraries and absolute paths. */
function registered(): { root: string | null; config: KicadConfig } {
  return realm().kicad ?? { root: null, config: {} }
}

/** The installed KiCad share folders, newest version first. */
export function kicadShareDirs(): string[] {
  const out: string[] = []
  const add = (d: string) => {
    if (exists(d) && !out.includes(d)) out.push(d)
  }
  add('/Applications/KiCad/KiCad.app/Contents/SharedSupport')
  add('/usr/share/kicad')
  add('/usr/local/share/kicad')
  add('/opt/homebrew/share/kicad')
  const pf = env('ProgramFiles')
  if (pf && exists(join(pf, 'KiCad'))) {
    const vers = readDir(join(pf, 'KiCad')).sort((a, b) => parseFloat(b) - parseFloat(a))
    for (const v of vers) add(join(pf, 'KiCad', v, 'share', 'kicad'))
  }
  return out
}

const FOOTPRINT_VARS = ['KICAD10_FOOTPRINT_DIR', 'KICAD9_FOOTPRINT_DIR', 'KICAD8_FOOTPRINT_DIR', 'KICAD7_FOOTPRINT_DIR', 'KICAD6_FOOTPRINT_DIR']
const MODEL_VARS = ['KICAD10_3DMODEL_DIR', 'KICAD9_3DMODEL_DIR', 'KICAD8_3DMODEL_DIR', 'KICAD7_3DMODEL_DIR', 'KICAD6_3DMODEL_DIR', 'KISYS3DMOD']

export function installedFootprints(): string | null {
  for (const v of FOOTPRINT_VARS) if (env(v) && exists(env(v)!)) return env(v)!
  for (const d of kicadShareDirs()) if (exists(join(d, 'footprints'))) return join(d, 'footprints')
  return null
}
export function installedModels(): string | null {
  const cfg = registered().config.models
  const root = registered().root
  if (cfg && (root || isAbsolute(cfg))) return resolve(root ?? '/', cfg)
  for (const v of MODEL_VARS) if (env(v) && exists(env(v)!)) return env(v)!
  for (const d of kicadShareDirs()) if (exists(join(d, '3dmodels'))) return join(d, '3dmodels')
  return null
}

const splitList = (s: string | undefined) => (s ?? '').split(windows() ? ';' : ':').filter(Boolean)

/** The library roots in search order: the project, pcb.config.ts, KICAD_FOOTPRINTS, the installed library. */
export function footprintRoots(o: { root?: string; footprints?: string[] } = {}): string[] {
  const reg = registered()
  const root = o.root ?? reg.root
  const out: string[] = []
  const add = (d: string) => {
    if (!root && !isAbsolute(d)) return
    const a = resolve(root ?? '/', d)
    if (exists(a) && !out.includes(a)) out.push(a)
  }
  for (const d of root ? ['.', 'lib', 'footprints', 'lib/footprints'] : []) {
    const dir = resolve(root!, d)
    if (!exists(dir)) continue
    for (const f of readDir(dir)) if (f.endsWith('.pretty')) add(join(dir, f))
  }
  for (const d of o.footprints ?? reg.config.footprints ?? []) add(d)
  for (const d of splitList(env('KICAD_FOOTPRINTS'))) add(d)
  const installed = installedFootprints()
  if (installed) add(installed)
  return out
}

function prettyDirs(root: string): string[] {
  if (root.endsWith('.pretty')) return [root]
  try {
    return readDir(root)
      .filter(f => f.endsWith('.pretty'))
      .map(f => join(root, f))
  } catch {
    return []
  }
}

/** The `.kicad_mod` file of a `Lib:Name`, a bare `Name` searched in every library, or a path. */
export function findFootprint(ref: string, o: { root?: string; footprints?: string[] } = {}): string | null {
  if (ref.endsWith('.kicad_mod')) {
    const base = o.root ?? registered().root
    if (!base && !isAbsolute(ref)) return null
    const f = resolve(base ?? '/', ref)
    return exists(f) ? f : null
  }
  const colon = ref.indexOf(':')
  const lib = colon >= 0 ? ref.slice(0, colon) : null,
    name = colon >= 0 ? ref.slice(colon + 1) : ref
  for (const r of footprintRoots(o)) {
    for (const p of prettyDirs(r)) {
      if (lib !== null && !p.endsWith(`/${lib}.pretty`) && !p.endsWith(`\\${lib}.pretty`)) continue
      const f = join(p, `${name}.kicad_mod`)
      if (exists(f)) return f
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
  return !!installed && resolve(file).startsWith(resolve(installed) + (windows() ? '\\' : '/'))
}

/** A KiCad model path with its variables resolved; a missing `.wrl` falls back to the `.step` beside it and the other way round. */
export function kicadModel(path: string, projectDir?: string): string {
  let out = path.replace(/\$\{([A-Za-z0-9_]+)\}|\$\(([A-Za-z0-9_]+)\)/g, (m, a, b) => {
    const v = a ?? b
    if (MODEL_VARS.includes(v)) return env(v) && exists(env(v)!) ? env(v)! : (installedModels() ?? m)
    if (v === 'KIPRJMOD') return projectDir ?? registered().root ?? m
    return env(v) ?? m
  })
  if (!exists(out)) {
    for (const [a, b] of [
      [/\.wrl$/i, '.step'],
      [/\.step$/i, '.wrl'],
      [/\.stp$/i, '.step'],
    ] as const) {
      const alt = out.replace(a, b)
      if (alt !== out && exists(alt)) {
        out = alt
        break
      }
    }
  }
  return out
}

const MODEL_VAR = /^\$\{(KICAD\d*_3DMODEL_DIR|KISYS3DMOD)\}\//

/** `${KICAD10_3DMODEL_DIR}/Lib.3dshapes/Name.wrl` as `kicad:Lib.3dshapes/Name.step`; another path as KiCad wrote it. */
export const kicadSource = (path: string): string => (MODEL_VAR.test(path) ? `kicad:${path.replace(MODEL_VAR, '').replace(/\.(wrl|stp)$/i, '.step')}` : path)

/** A ${KIPRJMOD} or relative model path made relative to `fromDir`, there or not; null for a library model. */
export function projectModelPath(path: string, kicadProject: string, fromDir: string): string | null {
  if (/\$\{(?!KIPRJMOD\})[A-Za-z0-9_]+\}/.test(path)) return null
  const abs = kicadModel(/^\$\{KIPRJMOD\}/.test(path) || isAbsolute(path) ? path : join('${KIPRJMOD}', path), kicadProject)
  const rel = relative(fromDir, abs).split('\\').join('/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

/** The first shown model of a footprint; `${KIPRJMOD}` and relative paths are under `projectDir`, never the library folder. */
export function modelSpec(fp: KFootprint, projectDir?: string): ModelSpec | undefined {
  const m: KModel | undefined = fp.models.find(x => !x.hidden && x.path)
  if (!m) return undefined
  const file = kicadModel(m.path, projectDir)
  // a library model not installed here is fetched by its kicad: name
  const spec: Record<string, unknown> = { file: /^\$\{/.test(file) ? kicadSource(m.path) : isAbsolute(file) ? file : resolve(projectDir ?? registered().root ?? '/', file) }
  if (m.offset.some(v => v !== 0)) spec.offset = m.offset
  if (m.scale.some(v => v !== 1)) spec.scale = m.scale
  if (m.rotate.some(v => v !== 0)) spec.rotate = m.rotate
  return spec as ModelSpec
}

const PREFIX: [RegExp, string][] = [
  [/^(R|Resistor)[_-]|^R_Array|Resistor/i, 'R'],
  [/^(C|CP|Capacitor)[_-]|Capacitor/i, 'C'],
  [/^(L|Inductor)[_-]|Inductor/i, 'L'],
  [/^LED|^D_|Diode/i, 'D'],
  [/Crystal|Oscillator|^Resonator/i, 'Y'],
  [/^Fuse/i, 'F'],
  [/^(SW|Button|Switch)/i, 'SW'],
  [/MountingHole|^Hole/i, 'H'],
  [/Fiducial/i, 'FID'],
  [/TestPoint|^TP/i, 'TP'],
  [/Jumper|SolderJumper/i, 'JP'],
  [/^(Connector|Conn|USB|PinHeader|PinSocket|JST|Molex|IDC|Terminal|BarrelJack|FFC|FPC|Header)/i, 'J'],
  [/^(Transistor|Package_TO_SOT|SOT-23$|SOT-323$|TO-)/i, 'Q'],
  [/^Relay/i, 'K'],
  [/^Buzzer|^Speaker/i, 'LS'],
  [/^Battery/i, 'BT'],
]

export function prefixOf(lib: string | undefined, name: string): string {
  for (const [re, p] of PREFIX) if (re.test(name)) return p
  for (const [re, p] of PREFIX) if (lib && re.test(lib)) return p
  return 'U'
}

/** A list renames the pins in pad order, a record maps a pad number to a name; pads named NC are no pin. */
export type KicadPinNames = readonly string[] | Readonly<Record<string, string>>

/** `withPins(kicadFootprint(id), names)` of @pcbjs/lib renames the pins. */
export interface KicadFootprintOptions {
  prefix?: string
  /** default the footprint name */
  value?: string
  /** the 3D model, over the one the footprint names; `{ kind: 'none' }` for none */
  model?: ModelSpec
  /** 'full' and 'open' as drawn, 'none' without any; default 'full' */
  silk?: KicadSilkMode
}

export function specNodes(specs: ElementSpec[], names?: Map<string, string>): PcbNode[] {
  return specs.map(s => {
    const { d, ...props } = s.props
    if (s.type === 'keepout') return keepout(String(d), props)
    if (d !== undefined) props.d = d
    if (s.type === 'pad' && names?.has(String(props.num))) props.name = names.get(String(props.num))
    return h(s.type, props, ...(s.children ?? []))
  })
}

export function renamePins(name: string, pins: string[], pinNames: KicadPinNames | undefined): { names: Map<string, string>; pins: string[]; nc: string[] } {
  const names = new Map<string, string>()
  if (pinNames !== undefined) {
    if (pinNames === null || typeof pinNames !== 'object')
      throw new TypeError(`${name}: pinNames must be a list of names in pad order or an object keyed by pad number, got ${JSON.stringify(pinNames)}`)
    if (Array.isArray(pinNames)) {
      if (pinNames.length > pins.length) throw new SchematicError(`${name}: ${pinNames.length} pin names for ${pins.length} pads`)
      pinNames.forEach((n, i) => {
        if (n) names.set(pins[i], String(n))
      })
    } else
      for (const [k, v] of Object.entries(pinNames)) {
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

// withPins of @pcbjs/lib renames a factory that carries this
const RENAME = Symbol.for('pcbjs.footprint.rename')

/** A footprint factory from a read footprint; its pins are the pad numbers in pad order, renamed by `pinNames`. */
export function footprintFactory(fp: KFootprint, o: KicadFootprintOptions = {}, pinNames?: KicadPinNames): FootprintFactory<string, FootprintProps> {
  if (o.silk !== undefined && !KICAD_SILK_MODES.includes(o.silk))
    throw new TypeError(`${fp.name}: silk must be ${KICAD_SILK_MODES.map(m => `'${m}'`).join(', ')}, got ${JSON.stringify(o.silk)}`)
  // without its silk it is another footprint, as KiCad's NoSilkScreen variants are
  const id = `${fp.lib ?? libraryOf(fp.file ?? '') ?? 'kicad'}:${fp.name}${o.silk === 'none' ? '_NoSilkScreen' : ''}`
  const { names, pins, nc } = renamePins(fp.name, padPins(fp), pinNames)
  const kids = specNodes(footprintSpecs(fp, ['F.Cu', 'B.Cu'], { silk: o.silk }), names)
  const model = o.model ?? modelSpec(fp)
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
  const f = defineFootprint<string, FootprintProps>(render, {
    pins,
    nc,
    prefix: o.prefix ?? prefixOf(fp.lib, fp.name),
  })
  Object.defineProperty(f, RENAME, { value: (names: KicadPinNames, more: KicadFootprintOptions) => footprintFactory(fp, { ...o, ...more }, names) })
  return f
}

const CACHE = Symbol.for('pcbjs.kicad.cache')
function cache(): Map<string, { hash: string; fp: KFootprint }> {
  return ((globalThis as any)[CACHE] ??= new Map())
}

/** Read a `.kicad_mod` through a cache keyed by path and content. */
export function loadFootprint(file: string): KFootprint {
  const text = readText(file)
  const hash = sha1(text)
  const hit = cache().get(file)
  if (hit && hit.hash === hash) return hit.fp
  const fp = readKicadMod(text)
  fp.file = file
  if (!fp.lib) {
    const lib = libraryOf(file)
    if (lib) fp.lib = lib
  }
  cache().set(file, { hash, fp })
  return fp
}

/** A KiCad library footprint as a factory: `kicadFootprint('Package_SO:SOIC-8_3.9x4.9mm_P1.27mm')`. */
export function kicadFootprint(ref: string, o: KicadFootprintOptions = {}): FootprintFactory<string, FootprintProps> {
  if (typeof ref !== 'string' || !ref) throw new TypeError(`kicadFootprint needs a footprint such as 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm', got ${JSON.stringify(ref)}`)
  for (const k of ['pinNames', 'footprints'])
    if (k in o)
      throw new TypeError(
        k === 'pinNames'
          ? 'kicadFootprint: rename pins with withPins(kicadFootprint(id), names) of @pcbjs/lib'
          : 'kicadFootprint: library folders go in kicad.footprints of pcb.config.ts',
      )
  const file = findFootprint(ref)
  if (!file) {
    const roots = footprintRoots()
    throw new SchematicError(
      `kicadFootprint: no footprint ${JSON.stringify(ref)} in ${roots.length ? roots.join(', ') : 'any library: install KiCad, set KICAD_FOOTPRINTS or list folders in kicad.footprints of pcb.config.ts'}`,
    )
  }
  let fp = loadFootprint(file)
  const colon = ref.indexOf(':')
  if (colon >= 0 && !fp.lib) fp = { ...fp, lib: ref.slice(0, colon) }
  // a relative model file is relative to the caller, as every model literal is
  const model = o.model ? anchorModel(o.model, callerSite()?.file) : o.model
  return footprintFactory(fp, model === o.model ? o : { ...o, model })
}

export { isDir }
