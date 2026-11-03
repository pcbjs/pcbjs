import { basename } from './host.js'
import { fmt } from './geom.js'
import { footprintSpecs, padPins, type ElementSpec, type KFootprint } from './footprint.js'
import { isInstalled, kicadSource, libraryOf, prefixOf, projectModelPath } from './library.js'

/** Code printed as it is, not as a literal. */
export class Code {
  constructor(readonly code: string) {}
}
export const code = (s: string) => new Code(s)

const IDENT = /^[A-Za-z_$][\w$]*$/
const RESERVED = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'let',
  'static',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
  'await',
  'NaN',
  'Infinity',
  'undefined',
])

export function str(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}'`
}
export function key(k: string): string {
  return (IDENT.test(k) && !RESERVED.has(k)) || /^(0|[1-9]\d*)$/.test(k) ? k : str(k)
}

export function lit(v: unknown): string {
  if (v instanceof Code) return v.code
  if (typeof v === 'number') return fmt(v)
  if (typeof v === 'string') return str(v)
  if (typeof v === 'boolean') return String(v)
  if (v === null || v === undefined) return String(v)
  if (Array.isArray(v)) return `[${v.map(lit).join(', ')}]`
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined)
  return entries.length ? `{ ${entries.map(([k, x]) => `${key(k)}: ${lit(x)}`).join(', ')} }` : '{}'
}

function attr(k: string, v: unknown): string {
  if (v === true) return k
  if (typeof v === 'string' && !/["{}\n\\]/.test(v)) return `${k}="${v}"`
  return `${k}={${lit(v)}}`
}

/** `at` as pcbjs writes it: "x y" or "x y 90deg". */
export function atString(v: unknown): unknown {
  if (Array.isArray(v) && v.every(x => typeof x === 'number')) return v.length >= 3 && v[2] ? `${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])}deg` : `${fmt(v[0])} ${fmt(v[1])}`
  return v
}

export function jsx(e: ElementSpec | { type: string; props: Record<string, unknown>; children?: (string | number | Code)[] }): string {
  if (e.type === 'keepout') return `{${keepoutCall(e.props)}}`
  const props = Object.entries(e.props)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => attr(k, k === 'at' ? atString(v) : v))
  const open = `<${e.type}${props.length ? ' ' + props.join(' ') : ''}`
  if (!e.children?.length) return `${open} />`
  const inner = e.children.map(c => (c instanceof Code ? `{${c.code}}` : typeof c === 'string' && !/[{}<>\n]/.test(c) && c.trim() === c && c !== '' ? c : `{${lit(c)}}`)).join('')
  return `${open}>${inner}</${e.type}>`
}

/** A `keepout` spec as the call: the area, then the options. */
export function keepoutCall(props: Record<string, unknown>): string {
  const { d, ...opts } = props
  return `keepout(${str(String(d))}${Object.keys(opts).length ? `, ${lit(opts)}` : ''})`
}

/** An identifier from any name: KiCad footprint names such as SOIC-8_3.9x4.9mm_P1.27mm become SOIC_8_3_9x4_9mm_P1_27mm. */
export function ident(name: string, fallback = 'X'): string {
  let s = name
    .replace(/[^A-Za-z0-9_$]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/__+/g, '_')
  if (!s) s = fallback
  if (/^\d/.test(s)) s = '_' + s
  if (RESERVED.has(s)) s += '_'
  return s
}

const KICAD_LICENCE = 'KiCad library footprint, CC-BY-SA 4.0 with the exception that designs using it may be licensed freely, see https://www.kicad.org/libraries/license/'

export function sourceComment(fp: KFootprint, given: string): string[] {
  const lib = fp.lib ?? libraryOf(fp.file ?? '')
  const out = [`// ${fp.name}: imported from ${given}${fp.file && fp.file !== given ? `, ${fp.file}` : ''} by pcbjs import.`]
  if (fp.file && isInstalled(fp.file)) out.push(`// Licence: ${KICAD_LICENCE}.`)
  else out.push(`// Licence: that of ${lib ? `the ${lib} library` : 'its source'}; check it before you share the board.`)
  if (fp.descr) out.push(`// ${fp.descr.replace(/\s+/g, ' ')}`)
  return out
}

export interface FootprintFileOptions {
  /** the name of the exported factory, default from the footprint name */
  exportName?: string
  /** the id written on the footprint, default Lib:Name */
  id?: string
  /** where the footprint came from, for the header */
  source?: string
  /** pin names by pad number, written as pad names */
  pinNames?: Map<string, string>
  prefix?: string
  /** the copper layers a keepout of `layers: 'all'` spans */
  copper?: string[]
  /** a model path written as is, relative to the file, instead of the KiCad reference */
  modelFile?: string
  /** the folder ${KIPRJMOD} stands for, and the module's folder: a project model there is written relative to the module */
  kicadProject?: string
  fileDir?: string
  /** false leaves KiCad's exclude_from_bom and exclude_from_pos_files off the footprint, for the placement to carry; default true */
  attrs?: boolean
}

/** The model prop as code: a KiCad library model as `kicad:<Lib>.3dshapes/<Name>.step`, else `file` or the path KiCad wrote. */
export function modelCode(fp: KFootprint, file?: string): Code | null {
  const m = fp.models.find(x => !x.hidden && x.path)
  if (!m) return null
  const parts = [`file: ${str(file ?? kicadSource(m.path))}`]
  if (m.offset.some(v => v !== 0)) parts.push(`offset: ${lit(m.offset)}`)
  if (m.scale.some(v => v !== 1)) parts.push(`scale: ${lit(m.scale)}`)
  if (m.rotate.some(v => v !== 0)) parts.push(`rotate: ${lit(m.rotate)}`)
  return new Code(`{ ${parts.join(', ')} }`)
}

/** The `defineFootprint` module of one footprint, for `pcbjs import footprint`. */
export function footprintModule(fp: KFootprint, o: FootprintFileOptions = {}): { code: string; exportName: string; pins: string[] } {
  const name = o.exportName ?? ident(fp.name)
  const lib = fp.lib ?? libraryOf(fp.file ?? '')
  const id = o.id ?? `${lib ?? 'kicad'}:${fp.name}`
  const pins = padPins(fp)
  const specs = footprintSpecs(fp, o.copper ?? ['F.Cu', 'B.Cu'])
  if (o.pinNames)
    for (const s of specs) if (s.type === 'pad' && o.pinNames.has(String(s.props.num))) s.props = { num: s.props.num, name: o.pinNames.get(String(s.props.num)), ...s.props }
  let modelFile = o.modelFile
  const shown = fp.models.find(x => !x.hidden && x.path)
  // a project model missing here is still written where it would be, for `pcbjs model add` or a copy to fill
  if (!modelFile && shown && o.kicadProject && o.fileDir) modelFile = projectModelPath(shown.path, o.kicadProject, o.fileDir) ?? undefined
  const model = modelCode(fp, modelFile)
  const head: string[] = [...sourceComment(fp, o.source ?? fp.file ?? fp.name)]
  const core = specs.some(s => s.type === 'keepout') ? 'defineFootprint, keepout' : 'defineFootprint'
  head.push(`import { ${core}, type FootprintProps } from '@pcbjs/core'`)
  const fpProps: Record<string, unknown> = {
    id,
    value: fp.properties.Value && !/\$\{/.test(fp.properties.Value) && fp.properties.Value !== fp.name ? fp.properties.Value : fp.name,
  }
  if (fp.descr) fpProps.description = fp.descr.replace(/\s+/g, ' ')
  if (o.attrs !== false && !fp.attrs.bom) fpProps.bom = false
  if (o.attrs !== false && !fp.attrs.pos) fpProps.pos = false
  if (model) fpProps.model = model
  if (fp.netTie) fpProps.netTie = fp.netTie
  const lines = [
    ...head,
    '',
    `export const ${name} = defineFootprint(function ${ident(fp.name)}(props: FootprintProps) {`,
    '  const { children, ...rest } = props',
    '  return (',
    `    ${jsx({ type: 'footprint', props: fpProps }).replace(/ \/>$/, ' {...rest}>')}`,
    ...specs.map(s => `      ${jsx(s)}`),
    '      {children}',
    '    </footprint>',
    '  )',
  ]
  const named = o.pinNames ? [...new Set(pins.map(p => o.pinNames!.get(p) ?? p))] : pins
  lines.push(`}, ${lit({ pins: named, prefix: o.prefix ?? prefixOf(lib ?? undefined, fp.name) })})`)
  return { code: lines.join('\n') + '\n', exportName: name, pins: named }
}

export const footprintFileName = (fp: KFootprint): string => `${ident(fp.name)}.tsx`

export { basename }
