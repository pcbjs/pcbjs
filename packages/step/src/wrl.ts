// VRML 2 IndexedFaceSet shapes, as KiCad's packages3D writes them, to meshes; a gzipped .wrz is unzipped first.
import { gunzipSync } from 'node:zlib'
import { DEFAULT_COLOR, type StepMesh, type StepModel } from './mesh.js'
import { creaseMesh, groupByColor, linear } from './tri.js'

/** Millimetres per VRML unit in a KiCad model: a tenth of an inch. */
export const WRL_UNIT_MM = 2.54

type Tok = string
interface VNode {
  type: string
  fields: Record<string, unknown>
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  const re = /\s+|,|#[^\n]*|"((?:[^"\\]|\\.)*)"|([{}[\]])|([^\s,{}[\]"#]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) out.push('"' + m[1])
    else if (m[2] !== undefined) out.push(m[2])
    else if (m[3] !== undefined) out.push(m[3])
  }
  return out
}

const isScalar = (t: Tok | undefined) => t !== undefined && (t[0] === '"' || /^[-+.\d]/.test(t) || t === 'TRUE' || t === 'FALSE')

function parse(toks: Tok[]): VNode[] {
  let i = 0
  const defs = new Map<string, VNode>()
  const skipBlock = () => {
    let depth = 0
    do {
      const t = toks[i++]
      if (t === '{' || t === '[') depth++
      else if (t === '}' || t === ']') depth--
    } while (depth > 0 && i < toks.length)
  }
  const node = (): VNode | null => {
    let t = toks[i++]
    if (t === 'NULL') return null
    if (t === 'USE') return defs.get(toks[i++]) ?? null
    let def: string | undefined
    if (t === 'DEF') {
      def = toks[i++]
      t = toks[i++]
    }
    if (toks[i] !== '{') throw new Error(`VRML: expected { after ${t}`)
    i++
    const n: VNode = { type: t, fields: {} }
    if (def) defs.set(def, n)
    while (i < toks.length && toks[i] !== '}') {
      const f = toks[i++]
      if (f === 'ROUTE') {
        i += 3
        continue
      }
      if (f === 'PROTO' || f === 'EXTERNPROTO') {
        i++
        skipBlock()
        if (toks[i] === '{') skipBlock()
        continue
      }
      n.fields[f] = value()
    }
    i++
    return n
  }
  const value = (): unknown => {
    const t = toks[i]
    if (t === '[') {
      i++
      const items: unknown[] = []
      while (i < toks.length && toks[i] !== ']') {
        if (isScalar(toks[i])) items.push(scalar(toks[i++]))
        else items.push(node())
      }
      i++
      return items
    }
    if (isScalar(t)) {
      const vals: unknown[] = []
      while (isScalar(toks[i])) vals.push(scalar(toks[i++]))
      return vals.length === 1 ? vals[0] : vals
    }
    return node()
  }
  const scalar = (t: Tok) => (t[0] === '"' ? t.slice(1) : t === 'TRUE' ? true : t === 'FALSE' ? false : Number(t))
  const top: VNode[] = []
  while (i < toks.length) {
    const t = toks[i]
    if (t === 'ROUTE') {
      i += 4
      continue
    }
    if (t === 'PROTO' || t === 'EXTERNPROTO') {
      i += 2
      skipBlock()
      if (toks[i] === '{') skipBlock()
      continue
    }
    const n = node()
    if (n) top.push(n)
  }
  return top
}

type Mat = number[]
function mul(a: Mat, b: Mat): Mat {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
      o[c * 4 + r] = s
    }
  return o
}
const translation = (v: number[]): Mat => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1]
const scaling = (v: number[]): Mat => [v[0], 0, 0, 0, 0, v[1], 0, 0, 0, 0, v[2], 0, 0, 0, 0, 1]
/** VRML's axis and angle in radians as a column-major matrix. */
function axisAngle(r: number[]): Mat {
  const l = Math.hypot(r[0], r[1], r[2]) || 1,
    x = r[0] / l,
    y = r[1] / l,
    z = r[2] / l,
    c = Math.cos(r[3]),
    s = Math.sin(r[3]),
    t = 1 - c
  return [
    t * x * x + c,
    t * x * y + s * z,
    t * x * z - s * y,
    0,
    t * x * y - s * z,
    t * y * y + c,
    t * y * z + s * x,
    0,
    t * x * z + s * y,
    t * y * z - s * x,
    t * z * z + c,
    0,
    0,
    0,
    0,
    1,
  ]
}
const nums = (v: unknown, n: number, d: number[]): number[] => (Array.isArray(v) && v.length >= n && v.every(x => typeof x === 'number') ? (v as number[]) : d)
const neg = (v: number[]) => v.map(x => -x)

/** Read a VRML 2 file's content into meshes in millimetres. Throws on VRML 1 and on a file with no faces. */
export function wrlToMesh(content: Uint8Array): StepModel {
  const raw = content[0] === 0x1f && content[1] === 0x8b ? new Uint8Array(gunzipSync(content)) : content
  const src = new TextDecoder().decode(raw)
  if (/^#VRML V1/.test(src)) throw new Error('VRML 1 is not read; export the model as VRML 2 (VRML97), STEP or glTF')
  const out: StepMesh[] = []
  const walk = (n: VNode | null, m: Mat, depth: number) => {
    if (!n || depth > 64) return
    const f = n.fields
    if (n.type === 'Transform') {
      const t = nums(f.translation, 3, [0, 0, 0]),
        c = nums(f.center, 3, [0, 0, 0]),
        r = nums(f.rotation, 4, [0, 0, 1, 0]),
        s = nums(f.scale, 3, [1, 1, 1]),
        so = nums(f.scaleOrientation, 4, [0, 0, 1, 0])
      m = [m, translation(t), translation(c), axisAngle(r), axisAngle(so), scaling(s), axisAngle([so[0], so[1], so[2], -so[3]]), translation(neg(c))].reduce(mul)
    }
    if (n.type === 'Shape') {
      shape(n, m)
      return
    }
    const kids = f.children ?? f.level ?? f.choice
    if (Array.isArray(kids)) for (const k of kids) if (k && typeof k === 'object') walk(k as VNode, m, depth + 1)
  }
  const shape = (n: VNode, m: Mat) => {
    const g = n.fields.geometry as VNode | null
    if (!g || g.type !== 'IndexedFaceSet') return
    const coord = g.fields.coord as VNode | null
    const pts = coord?.fields.point
    const ci = g.fields.coordIndex
    if (!Array.isArray(pts) || !Array.isArray(ci)) return
    const mat = ((n.fields.appearance as VNode | null)?.fields.material as VNode | null)?.fields
    const d = mat ? nums(mat.diffuseColor, 3, [0.8, 0.8, 0.8]) : null
    const color: [number, number, number] = d ? [linear(d[0]), linear(d[1]), linear(d[2])] : DEFAULT_COLOR
    const p = pts as number[],
      nv = Math.floor(p.length / 3)
    const positions = new Float32Array(nv * 3)
    for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) positions[i * 3 + k] = (m[k] * p[i * 3] + m[4 + k] * p[i * 3 + 1] + m[8 + k] * p[i * 3 + 2] + m[12 + k]) * WRL_UNIT_MM
    const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2])
    const flip = (g.fields.ccw === false) !== det < 0
    const ix: number[] = []
    let face: number[] = []
    const close = () => {
      for (let k = 2; k < face.length; k++)
        if (face[0] < nv && face[k - 1] < nv && face[k] < nv) ix.push(...(flip ? [face[0], face[k], face[k - 1]] : [face[0], face[k - 1], face[k]]))
      face = []
    }
    for (const v of ci as number[]) {
      if (v < 0) close()
      else face.push(v)
    }
    close()
    if (!ix.length) return
    const crease = typeof g.fields.creaseAngle === 'number' ? Math.max(g.fields.creaseAngle, 0.5) : 0.5
    out.push({ ...creaseMesh(positions, ix, crease), color })
  }
  for (const n of parse(tokenize(src))) walk(n, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0)
  if (!out.length) throw new Error('VRML file has no IndexedFaceSet shapes')
  return { meshes: groupByColor(out) }
}
