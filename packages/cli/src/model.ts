import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import ts from 'typescript'
import type { Board, Footprint, Pad } from '@pcbjs/core/model'
import type { SiteFootprint } from '@pcbjs/core/site-data'
import { MODEL_LABEL, modelSource } from '@pcbjs/core/model-source'
import { meshKey } from '@pcbjs/step/key'
import { meshFromBinary } from '@pcbjs/step/binary'
import { bounds, type StepModel } from '@pcbjs/step/mesh'
import { modelFormat, MODEL_EXTENSIONS, type ModelFormat } from '@pcbjs/step/format'
import { alignModel, guessUnit, type AlignPad, type AlignResult } from '@pcbjs/step/align'
import type { StepTransform } from '@pcbjs/step/place'
import { resolveConfig, type ResolvedConfig } from './config.js'
import { pluginState } from './plugin.js'
import { compileServer, compileSlots, errorText } from './check.js'
import { courtyardRect, meshFor, modelsDir, toFootprint } from './models.js'
import { fetchedDir, lcscModel, noteSource, retryFetches } from './fetch-model.js'

export { lcscModel, noteSource }
import type { Compiled } from './project.js'

const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2)
const num = (v: number) => String(Math.round(v * 1000) / 1000)
const posix = (p: string) => p.split(sep).join('/')


const TERMS = /licen[cs]e|read ?me|copying|terms|eula|notice/i

export interface ZipFile { name: string; data: Uint8Array }

/** The first STEP, else WRL, GLB or glTF entry of a zip, with the licence or read-me files beside it. */
export function unzipModel(zip: Uint8Array): (ZipFile & { terms: ZipFile[] }) | null {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let eocd = -1 // the end of central directory record, searched from the end
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('not a zip archive: no central directory')
  const count = dv.getUint16(eocd + 10, true)
  let off = dv.getUint32(eocd + 16, true)
  const entries: { name: string; method: number; size: number; local: number }[] = []
  for (let k = 0; k < count && dv.getUint32(off, true) === 0x02014b50; k++) {
    const method = dv.getUint16(off + 10, true), size = dv.getUint32(off + 20, true)
    const nl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true), local = dv.getUint32(off + 42, true)
    entries.push({ name: new TextDecoder().decode(zip.subarray(off + 46, off + 46 + nl)), method, size, local })
    off += 46 + nl + el + cl
  }
  const rank = (n: string) => { const f = modelFormat(n); return f === 'step' ? 0 : f === 'wrl' ? 1 : f === 'glb' ? 2 : f === 'gltf' ? 3 : 9 }
  const files = entries.filter(e => !e.name.endsWith('/') && !/(^|\/)(__MACOSX|\.)/.test(e.name))
  const pick = files.filter(e => rank(e.name) < 9).sort((a, b) => rank(a.name) - rank(b.name))[0]
  if (!pick) return null
  const read = (e: typeof pick): ZipFile => {
    const lo = e.local, nl = dv.getUint16(lo + 26, true), el = dv.getUint16(lo + 28, true)
    const raw = zip.subarray(lo + 30 + nl + el, lo + 30 + nl + el + e.size)
    if (e.method === 0) return { name: basename(e.name), data: raw }
    if (e.method === 8) return { name: basename(e.name), data: new Uint8Array(inflateRawSync(raw)) }
    throw new Error(`zip entry ${e.name} uses compression method ${e.method}; unzip it and add the file`)
  }
  const terms = files.filter(e => rank(e.name) === 9 && TERMS.test(basename(e.name))).map(read)
  return { ...read(pick), terms }
}

// a URL's name is the one its response gives, else the last part of its path
async function fetchSource(source: string): Promise<{ data: Uint8Array; name: string; url: string | null }> {
  if (/^https?:\/\//i.test(source)) {
    const r = await fetch(source, { redirect: 'follow' })
    if (!r.ok) throw new Error(`${source}: HTTP ${r.status} ${r.statusText}`.trim())
    const data = new Uint8Array(await r.arrayBuffer())
    const cd = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(r.headers.get('content-disposition') ?? '')
    const name = cd ? decodeURIComponent(cd[1]) : decodeURIComponent(basename(new URL(r.url || source).pathname)) || 'model'
    return { data, name, url: source }
  }
  const file = resolve(source)
  if (!existsSync(file)) throw new Error(`no such file: ${source}`)
  return { data: new Uint8Array(readFileSync(file)), name: basename(file), url: null }
}


export interface Project { cfg: ResolvedConfig; compiled: Compiled[] }

/** The first target of each board; a compile error is an Error with the board's message. */
export async function compileProject(entries: string[], o: { config?: string; root?: string; verbose?: boolean }): Promise<Project> {
  process.env.NODE_ENV ??= 'production'
  const cfg = await resolveConfig(entries, 'build', o.config, o.root, () => {})
  const state = pluginState(cfg)
  const errors = new Map<(typeof state.slots)[number], unknown>()
  const server = await compileServer(cfg, state, { verbose: o.verbose })
  try { await compileSlots(server, cfg, state.slots, errors) } finally { await server.close() }
  const compiled: Compiled[] = []
  for (const s of state.slots) {
    if (!s.compiled) throw new Error(`${s.entry.rel}: ${errorText(errors.get(s), o.verbose, cfg.root).line}`)
    compiled.push(s.compiled[0])
  }
  return { cfg, compiled }
}

interface Found { c: Compiled; fp: Footprint; site: SiteFootprint }

// the file alone when `--entry` names one, else every entry, to pick the board by name after
function entryFile(root: string, entry?: string): string[] {
  return entry && /\.[cm]?[jt]sx?$/.test(entry) && existsSync(resolve(root, entry)) ? [entry] : []
}

/** By its name, its entry path relative to the root, the entry's file name or stem, or its folder. */
export function boardMatches(c: Pick<Compiled, 'board' | 'entry'>, name: string): boolean {
  const n = posix(name).replace(/^\.\//, '').replace(/\/$/, '').toLowerCase()
  const rel = posix(c.entry.rel).toLowerCase(), base = rel.split('/').pop()!
  return c.board.name.toLowerCase() === n || rel === n || base === n || base.replace(/\.[^.]+$/, '') === n || rel.replace(/\/[^/]+$/, '') === n
}

/** `SW1`, or `Sense/SW1` with the board first, named as `--entry` takes it. */
export function splitRef(ref: string): { board?: string; ref: string } {
  const i = ref.lastIndexOf('/')
  return i > 0 && i < ref.length - 1 ? { board: ref.slice(0, i), ref: ref.slice(i + 1) } : { ref }
}

/** A ref on several boards without its board is an error that lists them; `--footprint` takes the first board's. */
export function findFootprint(p: Pick<Project, 'compiled'>, ref?: string, footprint?: string, entry?: string): Found | null {
  let boards = p.compiled, want = ref
  const pick = (name: string) => {
    if (boards.length < 2 && p.compiled.length < 2) return
    const named = boards.filter(c => boardMatches(c, name))
    if (!named.length) throw new Error(`no board ${name}; the boards: ${p.compiled.map(c => `${c.board.name} (${posix(c.entry.rel)})`).join(', ')}`)
    boards = named
  }
  if (entry) pick(entry)
  if (ref && !boards.some(c => c.board.footprints.some(fp => fp.ref === ref))) {
    const s = splitRef(ref)
    if (s.board) { pick(s.board); want = s.ref }
  }
  const hits: Found[] = []
  for (const c of boards) {
    const fp = c.board.footprints.find(fp => want ? fp.ref === want : !!footprint && (fp.id === footprint || fp.id.split(':').pop()!.toLowerCase() === footprint.toLowerCase()))
    if (fp) hits.push({ c, fp, site: c.site.footprints.find(s => s.ref === fp.ref)! })
  }
  if (want && hits.length > 1) {
    const list = hits.map(h => `${h.c.board.name}/${want} in ${posix(h.c.entry.rel)}${h.fp.value ? `, ${h.fp.value}` : ''}`)
    throw new Error(`${want} is on ${hits.length} boards, ${list.slice(0, -1).join('; ')} and ${list[list.length - 1]}: name one with --entry <board> or --ref <board>/${want}`)
  }
  return hits[0] ?? null
}

const padsOf = (b: Board, fp: Footprint): Pad[] => fp.pads.map(id => b.items[id - 1]).filter((p): p is Pad => !!p && p.kind === 'pad')

/** The pads of a footprint in its own frame. */
export function alignPads(b: Board, fp: Footprint): AlignPad[] {
  return padsOf(b, fp).map(p => {
    const l = p.poly.map(q => toFootprint(fp, q))
    const xs = l.map(q => q[0]), ys = l.map(q => q[1]), c = toFootprint(fp, p.at)
    return { x: c[0], y: c[1], w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), ...(p.drill ? { drill: p.drill[0] } : {}) }
  })
}

async function meshOf(file: string, root: string): Promise<StepModel> {
  const hash = meshKey(new Uint8Array(readFileSync(file)))
  return meshFromBinary(await meshFor(hash, file, modelsDir(root)))
}


/** The `model` object literal of a file and transform, leaving out the defaults. */
export function modelSnippet(file: string, t?: StepTransform): string {
  const parts = [`file: '${file}'`]
  if (t) {
    if (t.offset.some(v => v)) parts.push(`offset: [${t.offset.map(num).join(', ')}]`)
    if (t.rotate.some(v => v)) parts.push(`rotate: [${t.rotate.map(num).join(', ')}]`)
    if (t.scale.some(v => Math.abs(v - 1) > 1e-9)) parts.push(`scale: [${t.scale.map(v => num(Math.round(v * 1e6) / 1e6)).join(', ')}]`)
  }
  return `{ ${parts.join(', ')} }`
}

// relative, starting with ./ or ../, with forward slashes
const relPath = (fromDir: string, file: string) => { const r = posix(relative(fromDir, file)); return r.startsWith('.') ? r : `./${r}` }

function offsetOf(code: string, line: number, col: number): number {
  let off = 0
  for (let l = 1; l < line; l++) { const n = code.indexOf('\n', off); if (n < 0) return code.length; off = n + 1 }
  return off + col - 1
}

/** Put `model: <snippet>` into the options of the part call at a position; `value` tells the value argument from a shape argument. Null without a part call there. */
export function writePartModel(code: string, file: string, line: number, col: number, snippet: string, value?: string): string | null {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const at = offsetOf(code, line, col)
  let call: ts.CallExpression | null = null
  const visit = (n: ts.Node) => {
    if (at < n.getStart(sf) || at >= n.getEnd()) return
    if (ts.isCallExpression(n)) call = n
    n.forEachChild(visit)
  }
  visit(sf)
  if (!call) return null
  // climb while the call is itself called, `QFN(48)('KSZ')`, and step down off part methods such as .connect()
  let c: ts.CallExpression = call
  while (ts.isPropertyAccessExpression(c.expression) && ts.isCallExpression(c.expression.expression)) c = c.expression.expression
  while (c.parent && ts.isCallExpression(c.parent) && c.parent.expression === c) c = c.parent
  const args = c.arguments
  const edit = (start: number, end: number, text: string) => code.slice(0, start) + text + code.slice(end)
  const into = (obj: ts.ObjectLiteralExpression) => {
    const prop = obj.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'model') as ts.PropertyAssignment | undefined
    if (prop) return edit(prop.initializer.getStart(sf), prop.initializer.getEnd(), snippet)
    if (!obj.properties.length) return edit(obj.getStart(sf), obj.getEnd(), `{ model: ${snippet} }`)
    const last = obj.properties[obj.properties.length - 1]
    return edit(last.getEnd(), last.getEnd(), `, model: ${snippet}`)
  }
  if (!args.length) return edit(c.getEnd() - 1, c.getEnd() - 1, `{ model: ${snippet} }`)
  // without a value known, a leading string is the value
  const lit = (a: ts.Expression) => (ts.isStringLiteralLike(a) || ts.isNumericLiteral(a) ? a.text : undefined)
  let vi = -1
  if (value !== undefined) { for (let i = args.length - 1; i >= 0; i--) if (lit(args[i]) === value) { vi = i; break } }
  else if (ts.isStringLiteralLike(args[0]) && args.length <= 2) vi = 0
  if (vi >= 0) {
    // F(value, sourcing): the sourcing spec moves under source
    const next = args[vi + 1] && ts.isObjectLiteralExpression(args[vi + 1]) ? args[vi + 1] : undefined
    const source = next ? `, source: ${next.getText(sf)}` : ''
    return edit(args[vi].getStart(sf), (next ?? args[vi]).getEnd(), `{ value: ${args[vi].getText(sf)}${source}, model: ${snippet} }`)
  }
  const objects = args.filter(ts.isObjectLiteralExpression)
  if (objects.length) return into(objects[objects.length - 1])
  // F(v) holds the value in a variable; else shape arguments only, USBC('power6') or PinHeader(4)
  if (args.length === 1 && !lit(args[0])) return edit(args[0].getStart(sf), args[0].getEnd(), `{ value: ${args[0].getText(sf)}, model: ${snippet} }`)
  const last = args[args.length - 1]
  return edit(last.getEnd(), last.getEnd(), `, { model: ${snippet} }`)
}

/** Put `model={<snippet>}` on the `<footprint>` element at a position, replacing one it has. Null when there is none there. */
export function writeElementModel(code: string, file: string, line: number, col: number, snippet: string): string | null {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const at = offsetOf(code, line, col)
  let el: ts.JsxOpeningElement | ts.JsxSelfClosingElement | null = null
  const visit = (n: ts.Node) => {
    if (at < n.getStart(sf) || at >= n.getEnd()) return
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.getStart(sf) === at) el = n
    n.forEachChild(visit)
  }
  visit(sf)
  if (!el) return null
  const e = el as ts.JsxOpeningElement | ts.JsxSelfClosingElement
  if (e.tagName.getText(sf) !== 'footprint') return null
  const attr = e.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(sf) === 'model') as ts.JsxAttribute | undefined
  if (attr?.initializer) return code.slice(0, attr.initializer.getStart(sf)) + `{${snippet}}` + code.slice(attr.initializer.getEnd())
  const after = e.tagName.getEnd()
  return code.slice(0, after) + ` model={${snippet}}` + code.slice(after)
}

/** The source files an entry reaches through relative imports, itself first. */
export function projectSources(entry: string): string[] {
  const seen = new Set<string>(), queue = [entry]
  const EXT = ['', '.tsx', '.ts', '.mts', '.jsx', '.js', '.mjs', '/index.tsx', '/index.ts', '/index.js']
  while (queue.length) {
    const f = queue.shift()!
    if (seen.has(f)) continue
    seen.add(f)
    let code: string
    try { code = readFileSync(f, 'utf8') } catch { continue }
    for (const m of code.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const base = resolve(dirname(f), m[1]), stem = base.replace(/\.(m?js|jsx)$/, '')
      const hit = [...EXT.map(e => base + e), ...(stem !== base ? EXT.slice(1, 4).map(e => stem + e) : [])].find(c => /\.(m?[jt]sx?)$/.test(c) && existsSync(c))
      if (hit) queue.push(hit)
    }
  }
  return [...seen]
}

export function findFootprintElement(files: string[], id: string): { file: string; line: number; col: number } | null {
  for (const file of files) {
    let code: string
    try { code = readFileSync(file, 'utf8') } catch { continue }
    if (!code.includes('<footprint') || !code.includes(id)) continue
    const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let hit: number | null = null
    const visit = (n: ts.Node) => {
      if (hit !== null) return
      if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(sf) === 'footprint') {
        const a = n.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(sf) === 'id') as ts.JsxAttribute | undefined
        const v = a?.initializer && ts.isStringLiteral(a.initializer) ? a.initializer.text : a?.initializer && ts.isJsxExpression(a.initializer) && a.initializer.expression && ts.isStringLiteralLike(a.initializer.expression) ? a.initializer.expression.text : undefined
        if (v === id) { hit = n.getStart(sf); return }
      }
      n.forEachChild(visit)
    }
    visit(sf)
    if (hit !== null) { const lc = sf.getLineAndCharacterOfPosition(hit); return { file, line: lc.line + 1, col: lc.character + 1 } }
  }
  return null
}

function footprintAt(file: string, line: number, col: number): boolean {
  try { const code = readFileSync(file, 'utf8'); return code.startsWith('<footprint', offsetOf(code, line, col)) } catch { return false }
}

// with `--ref` the part call, with `--footprint` the `<footprint>` element, from its call sites or else by its id
function modelSite(found: Found, root: string, byFootprint: boolean): { kind: 'part' | 'element'; file: string; line: number; col: number } | null {
  const abs = (f: string) => (isAbsolute(f) ? f : resolve(root, f))
  if (!byFootprint) {
    const part = found.c.board.schematic.parts.find(p => p.ref === found.fp.ref)
    if (part?.src) return { kind: 'part', file: abs(part.src.file), line: part.src.line, col: part.src.col }
    return null
  }
  for (const s of [...(found.fp.chain ?? [])].reverse()) {
    if (s?.file && s.endLine && footprintAt(abs(s.file), s.line, s.col)) return { kind: 'element', file: abs(s.file), line: s.line, col: s.col }
  }
  const el = found.fp.id ? findFootprintElement(projectSources(found.c.entry.file), found.fp.id) : null
  return el ? { kind: 'element', ...el } : null
}


function confidenceWord(c: number) { return c >= 0.8 ? 'high' : c >= 0.5 ? 'medium' : 'low' }

function alignLines(ref: string, fileShown: string, model: StepModel, r: AlignResult, snippet: string, current?: StepTransform): string[] {
  const b = bounds(model)
  const ext = [0, 1, 2].map(k => b.max[k] - b.min[k])
  const pins = r.pins ? `pins ${r.pins}, ${r.matched} on ${r.pads} pads${r.matched ? `, mean error ${f2(r.error)} mm` : ''}` : `no pins seen from below, placed by its box on the ${r.pads} pads`
  const how = r.kept === 'current' ? 'the transform it has' : r.kept === 'file' ? "the file's own frame" : `${r.up} up, turned ${r.turn}`
  const out = [
    `${ref}  ${fileShown}  ${ext.map(f2).join(' x ')} mm as read, units ${r.unit.name}${r.unit.scale !== 1 ? `, scale ${num(r.unit.scale)}` : ''}`,
    `fit  ${how}  ${pins}  confidence ${f2(r.confidence)} ${confidenceWord(r.confidence)}`,
  ]
  if (r.note) out.push(`note  ${r.note}`)
  if (current) {
    const same = [0, 1, 2].every(k => Math.abs(current.offset[k] - r.transform.offset[k]) < 0.05 && Math.abs(current.rotate[k] - r.transform.rotate[k]) < 0.5 && Math.abs(current.scale[k] - r.transform.scale[k]) < 1e-6)
    out.push(`now  offset [${current.offset.map(num).join(', ')}] rotate [${current.rotate.map(num).join(', ')}]${current.scale.some(v => v !== 1) ? ` scale [${current.scale.map(num).join(', ')}]` : ''}${same ? ', already the fit' : ''}`)
  }
  out.push(`model: ${snippet}`)
  return out
}

// undefined for a model other than STEP
function transformOf(m: Footprint['model']): StepTransform | undefined {
  if (m?.kind !== 'step') return undefined
  return { offset: m.offset ?? [0, 0, 0], rotate: m.rotate ?? [0, 0, 0], scale: m.scale ?? [1, 1, 1] }
}

const alignTarget = (f: Found) => ({ pads: alignPads(f.c.board, f.fp), courtyard: courtyardRect(f.c.board, f.fp) ?? undefined, height: f.fp.height })

const KICAD_LIBRARY = /kicad-packages3D|\.3dshapes\//

export interface ModelAddOptions { source?: string; ref?: string; entry?: string; footprint?: string; as?: string; write?: boolean; force?: boolean; config?: string; root?: string; verbose?: boolean }

export async function modelAdd(o: ModelAddOptions): Promise<number> {
  const root = resolve(o.root ?? process.cwd())
  let project: Project | null = null
  const compiled = async () => (project ??= await compileProject(entryFile(root, o.entry), o))
  const lookup = async () => {
    const f = findFootprint(await compiled(), o.ref, o.footprint, o.entry)
    if (!f) throw new Error(o.ref ? `no footprint ${o.ref} on the ${o.entry ? `board ${o.entry}` : 'boards'}` : `no footprint named ${o.footprint} on the ${o.entry ? `board ${o.entry}` : 'boards'}`)
    return f
  }
  // without a source, the part's MPN:LCSC number
  let source = o.source
  if (!source) {
    if (!o.ref) throw new Error('give a file, a URL or lcsc:<C-number>, or --ref of a part that has an MPN:LCSC number')
    const f = await lookup()
    const lc = f.fp.fields['MPN:LCSC']
    if (!lc) throw new Error(`${o.ref} has no MPN:LCSC number; give a file, a URL or lcsc:<C-number>`)
    source = `lcsc:${lc}`
    console.log(`${o.ref} is LCSC ${lc}`)
  }
  let data: Uint8Array, name: string, url: string | null, note: string | null = null, terms: ZipFile[] = []
  const lcsc = /^lcsc:(.+)$/i.exec(source)
  if (lcsc) ({ data, name, url, note } = await lcscModel(lcsc[1].trim()))
  else ({ data, name, url } = await fetchSource(source))
  if (data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 3 && data[3] === 4) {
    const inner = unzipModel(data)
    if (!inner) throw new Error(`${source}: the zip has no .step, .stp, .wrl, .glb or .gltf file`)
    console.log(`unzipped ${inner.name} from ${name}`)
    ;({ data, name, terms } = inner)
  }
  const format = modelFormat(name, data)
  if (!format) throw new Error(`${source}: not a model file this reads; use STEP or STP, glTF or GLB, or WRL`)
  if (o.as) name = o.as
  if (!MODEL_EXTENSIONS[format].includes(extname(name).toLowerCase())) name += MODEL_EXTENSIONS[format][0]
  name = name.replace(/[^\w.+-]+/g, '_')
  const dir = join(root, 'models'), dest = join(dir, name), shown = posix(relative(root, dest))
  mkdirSync(dir, { recursive: true })
  const had = existsSync(dest) ? new Uint8Array(readFileSync(dest)) : null
  const same = !!had && Buffer.compare(Buffer.from(had), Buffer.from(data)) === 0
  if (had && !same && !o.force) throw new Error(`${shown} exists with other content; pass --as <name> or --force`)
  if (!same) writeFileSync(dest, data)
  const stem = name.slice(0, name.length - extname(name).length)
  const kept = terms.map(t => {
    const file = `${stem}-${t.name.replace(/[^\w.+-]+/g, '_')}`
    writeFileSync(join(dir, file), t.data)
    console.log(`licence  ${t.name} came in the zip, saved as ${posix(relative(root, join(dir, file)))}; read it before you share the model`)
    return `the zip's ${t.name} is ${file}`
  })
  // a glTF's buffers in files beside it come along
  if (format === 'gltf' && !url) {
    try {
      for (const b of JSON.parse(new TextDecoder().decode(data)).buffers ?? []) {
        if (typeof b.uri !== 'string' || b.uri.startsWith('data:')) continue
        const from = resolve(dirname(resolve(source)), decodeURIComponent(b.uri)), to = resolve(dir, decodeURIComponent(b.uri))
        if (to.startsWith(dir + sep) && existsSync(from)) { mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, readFileSync(from)) }
      }
    } catch { /* the reader below says what is wrong */ }
  }
  let model: StepModel
  try { model = await meshOf(dest, root) } catch (e: any) {
    if (!had) rmSync(dest, { force: true })
    console.error(`${shown}: ${String(e?.message ?? e)}`)
    return 1
  }
  const b = bounds(model)
  const ext = [0, 1, 2].map(k => b.max[k] - b.min[k])
  const tris = model.meshes.reduce((a, m) => a + m.indices.length / 3, 0)
  console.log(`${same ? 'have' : 'added'} ${shown}  ${format.toUpperCase()}, ${model.meshes.length} colour${model.meshes.length === 1 ? '' : 's'}, ${tris} triangles`)
  console.log(`box  x ${f2(b.min[0])} to ${f2(b.max[0])}, y ${f2(b.min[1])} to ${f2(b.max[1])}, z ${f2(b.min[2])} to ${f2(b.max[2])}: ${ext.map(f2).join(' x ')} mm`)
  if (!o.ref && !o.footprint) {
    const u = guessUnit(Math.max(...ext))
    console.log(`units  ${u.name}${u.scale !== 1 ? `? scale ${num(u.scale)} would make it ${f2(Math.max(...ext) * u.scale)} mm` : ', from its size'}`)
  }
  const mdFile = join(dir, 'LICENSES.md')
  // adding a file from models/ itself is no new source
  if (same && existsSync(mdFile) && readFileSync(mdFile, 'utf8').includes(`\`${name}\`: `)) console.log(`source already in ${posix(relative(root, mdFile))}`)
  else {
    const from = url ? (note ? `${note}, ${url}` : url) : `local file ${resolve(source)}`
    console.log(`noted in ${posix(relative(root, noteSource(dir, name, [from, ...kept].join('; '))))}`)
  }
  if (!o.ref && !o.footprint) {
    console.log(`next: pcbjs model add ${shown} --ref <REF> to fit it to a placed part and print the model option`)
    return 0
  }
  const found = await lookup()
  // the part's own transform stays when it already has this file and it fits
  const now = found.fp.model?.kind === 'step' && found.fp.model.path === dest ? transformOf(found.fp.model) : undefined
  const r = alignModel(model, alignTarget(found), { keep: now ? [now] : [] })
  const site = modelSite(found, root, !o.ref)
  // relative to the file it is written in, as any import is
  const snippet = modelSnippet(relPath(site ? dirname(site.file) : root, dest), r.transform)
  for (const l of alignLines(found.fp.ref, shown, model, r, snippet).slice(1)) console.log(l)
  if (r.kept === 'file' && url && KICAD_LIBRARY.test(url)) console.log("note  a KiCad library model: it fits in KiCad's own frame, no transform")
  if (o.write) {
    if (!site || !existsSync(site.file)) throw new Error(o.ref ? `cannot find the code that declares ${found.fp.ref}; paste the model option yourself` : `no <footprint id="${found.fp.id}"> element among the project's files; a standard library footprint takes its model per part, with --ref`)
    const code = readFileSync(site.file, 'utf8')
    const next = site.kind === 'part' ? writePartModel(code, site.file, site.line, site.col, snippet, found.fp.value) : writeElementModel(code, site.file, site.line, site.col, snippet)
    if (next === null) throw new Error(`no ${site.kind === 'part' ? 'part call' : '<footprint> element'} at ${posix(relative(root, site.file))}:${site.line}:${site.col}; paste the model option yourself`)
    writeFileSync(site.file, next)
    console.log(`wrote ${posix(relative(root, site.file))}:${site.line}`)
  } else if (site) console.log(`paste it into ${site.kind === 'part' ? `the options of ${found.fp.ref}` : `the <footprint> element`} at ${posix(relative(root, site.file))}:${site.line}, or run again with --write`)
  // one model on the project's own <footprint> serves every part on it
  if (o.ref) {
    const others = found.c.board.footprints.filter(f => f !== found.fp && f.id === found.fp.id && !(f.model?.kind === 'step' && f.model.path === dest)).map(f => f.ref)
    if (others.length && modelSite(found, root, true)) console.log(`note  ${others.join(', ')} use${others.length === 1 ? 's' : ''} the same footprint: pcbjs model add ${shown} --footprint ${found.fp.id} --write puts the model on the <footprint> once for all of them`)
  }
  console.log(`look: pcbjs shot --view 3d --select ${found.fp.ref}`)
  return 0
}

export interface ModelAlignOptions { entry?: string; ref: string; file?: string; config?: string; root?: string; verbose?: boolean }

export async function modelAlign(o: ModelAlignOptions): Promise<number> {
  const p = await compileProject(entryFile(resolve(o.root ?? process.cwd()), o.entry), o)
  const root = p.cfg.root
  let found: Found | null
  try { found = findFootprint(p, o.ref, undefined, o.entry) } catch (e: any) { console.error(`pcbjs: ${e?.message ?? e}`); return 1 }
  if (!found) { console.error(`pcbjs: no footprint ${o.ref}; refs: ${p.compiled.flatMap(c => c.board.footprints.map(f => p.compiled.length > 1 ? `${c.board.name}/${f.ref}` : f.ref)).join(' ')}`); return 1 }
  const m = found.fp.model
  const file = o.file ? resolve(o.file) : m?.kind === 'step' ? m.path : undefined
  if (!file) { console.error(`pcbjs: ${o.ref} has a generated model; give a file with --file, or add one with pcbjs model add <file> --ref ${o.ref}`); return 1 }
  if (!existsSync(file)) { console.error(`pcbjs: ${o.ref}: ${posix(relative(root, file))} is missing`); return 1 }
  const model = await meshOf(file, root)
  const current = !o.file ? transformOf(m) : undefined
  const r = alignModel(model, alignTarget(found), { keep: current ? [current] : [] })
  const site = modelSite(found, root, false)
  const shown = relPath(site ? dirname(site.file) : root, file)
  for (const l of alignLines(found.fp.ref, posix(relative(root, file)), model, r, modelSnippet(shown, r.transform), current)) console.log(l)
  console.log(`look: pcbjs shot --view 3d --select ${found.fp.ref}`)
  return 0
}

export interface ModelCheckOptions { entries: string[]; config?: string; root?: string; verbose?: boolean }

export interface ModelRow { board: string; ref: string; source: string; status: 'ok' | 'missing' | 'unread' | 'off'; issue?: string }

export function modelRows(c: Compiled): ModelRow[] {
  return c.site.footprints.map(sf => {
    const s = sf.step
    if (!s) {
      const box = sf.model?.kind === 'box' ? sf.model : null
      if (box?.fetch) return { board: c.board.name, ref: sf.ref, source: `not fetched ${box.fetch}`, status: 'missing' as const, issue: 'the model did not download' }
      if (box?.reason) return { board: c.board.name, ref: sf.ref, source: 'no model', status: 'ok' as const, issue: box.reason }
      const from = modelSource(sf.model, sf.height)
      return { board: c.board.name, ref: sf.ref, source: from === 'generated' ? `generated ${sf.model!.kind}` : MODEL_LABEL[from], status: 'ok' as const }
    }
    const status = !s.mesh ? 'missing' : s.issue?.startsWith('the file did not read') ? 'unread' : s.issue ? 'off' : 'ok'
    const issue = status === 'missing' ? 'the file is missing' : s.issue
    return { board: c.board.name, ref: sf.ref, source: `file ${s.file}`, status, ...(issue ? { issue } : {}) }
  })
}

export async function modelCheck(o: ModelCheckOptions): Promise<number> {
  const p = await compileProject(o.entries, o)
  const many = p.compiled.length > 1
  let flagged = 0, files = 0, total = 0, generated = 0, missing = 0
  for (const c of p.compiled) {
    const rows = modelRows(c).sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))
    const entry = posix(relative(p.cfg.root, c.entry.file))
    console.log(`${c.board.name}  ${entry}`)
    const w = Math.max(...rows.map(r => r.ref.length), 3), ws = Math.max(...rows.map(r => r.source.length), 6)
    for (const r of rows) {
      total++
      if (r.source.startsWith('file')) files++
      else if (r.source.startsWith('generated')) generated++
      else if (r.source === 'no model') missing++
      console.log(`  ${r.ref.padEnd(w)}  ${r.source.padEnd(ws)}  ${r.status}${r.issue ? `: ${r.issue}` : ''}`)
      if (r.status !== 'ok') {
        flagged++
        const ref = many ? `${c.board.name}/${r.ref}` : r.ref
        console.log(`  ${' '.repeat(w)}  fix: ${r.source.startsWith('not fetched') ? 'pcbjs model fetch' : r.status === 'missing' ? `pcbjs model add <file-or-url> --ref ${ref} --write` : r.status === 'unread' ? `pcbjs model add <file-or-url> --ref ${ref} --write --force, a STEP, glTF or WRL file` : `pcbjs model align ${many ? `${entry} ` : ''}${r.ref}`}`)
      }
    }
  }
  console.log(`${total} footprints, ${files} with a model file, ${generated} generated, ${missing} with no model, ${flagged} flagged`)
  console.log(stdlibLine(p.compiled))
  return flagged ? 1 : 0
}

/** How the standard library's parts got their bodies, and those still to fetch. */
export function stdlibLine(compiled: Compiled[]): string {
  let n = 0, fetched = 0, generated = 0, bare = 0, waiting = 0, outline = 0
  for (const c of compiled) for (const sf of c.site.footprints) {
    if (!sf.id.startsWith('pcbjs:')) continue
    n++
    const m = sf.model
    if (sf.step?.mesh) fetched++
    else if (m?.kind === 'box' && m.fetch) waiting++
    else if (m?.kind === 'box') outline++
    else if (modelSource(m, sf.height) === 'generated') generated++
    else bare++
  }
  const parts = [`${fetched} with fetched models`, `${generated} generated`, `${bare} with no body`]
  if (waiting) parts.push(`${waiting} not fetched yet, pcbjs model fetch`)
  if (outline) parts.push(`${outline} with no model`)
  return `standard library: ${n} part${n === 1 ? '' : 's'}, ${parts.join(', ')}`
}

export interface ModelFetchOptions { entries: string[]; config?: string; root?: string; verbose?: boolean }

// compiling downloads every model a part names and the cache lacks
export async function modelFetch(o: ModelFetchOptions): Promise<number> {
  retryFetches()
  const p = await compileProject(o.entries, o)
  const waiting = p.compiled.flatMap(c => c.site.footprints.flatMap(sf => (sf.model?.kind === 'box' && sf.model.fetch ? [`${sf.ref} ${sf.model.fetch}`] : [])))
  console.log(stdlibLine(p.compiled))
  const shown = posix(relative(p.cfg.root, fetchedDir(p.cfg.root)))
  if (!waiting.length) { console.log(`every fetched model is in ${shown}, its sources in ${shown}/LICENSES.md`); return 0 }
  for (const w of waiting) console.log(`  not fetched  ${w}`)
  return 1
}
